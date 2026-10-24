#![allow(unused_imports)]

// modpack/mrpack_native/import.rs — .mrpack 导入主流程
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Map, Value};
use tauri::AppHandle;
use tokio::sync::{Mutex, Semaphore};

use crate::modpack::curseforge_shared as cf_shared;
use super::{emit_progress, emit_progress_with_files, versions_dir};
use crate::storage;

use super::{MrpackManifest, MrpackDependencies, MrpackFile, MAX_DOWNLOAD_ROUNDS};

/// 主导入流程：overrides 解压 + mods 下载 + 验证 + 资源下载
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_import_main(
    app: &AppHandle,
    archive: &mut zip::ZipArchive<std::fs::File>,
    manifest: &MrpackManifest,
    version_id: &str,
    version_dir: &Path,
    pack_name: &str,
    mc_version: &str,
    forge_ver: &str,
    fabric_ver: &str,
    neoforge_ver: &str,
    loader_version_id: Option<&str>,
    file_path: &str,
    abort_flag: Option<&Arc<AtomicBool>>,
) -> Result<Value, String> {
    // 记录导入前原版版本目录是否已存在：若为本次流程新建，导入收尾时清理，避免遗留独立原版目录
    let base_vanilla_pre_existed = {
        if mc_version.is_empty() {
            false
        } else {
            versions_dir()
                .join(mc_version)
                .join(format!("{}.json", mc_version))
                .exists()
        }
    };

    // 3.7 overrides 解压（路径遍历保护 + 5 次重试 + 50 文件 yield + 实时进度）
    emit_progress(app, 40, "解压覆盖文件...", "extract");
    let _override_files = extract_overrides_with_progress(archive, version_dir, app)?;

    // 3.8 client_overrides 解压（如果存在，在 overrides 之后解压）
    extract_client_overrides(archive, version_dir, app)?;

    // 3.9 根目录图标提取（pack.png / icon.png / logo.png）
    extract_root_icon(archive, version_dir);

    // 3.10 资源包重定位 relocate_misplaced_resource_packs
    let relocated = cf_shared::relocate_misplaced_resource_packs(version_dir);
    if !relocated.relocated.is_empty() {
        eprintln!(
            "[Modpack] 检测到 {} 个资源包 zip 误放在 mods 目录，已自动移动到 resourcepacks: {}",
            relocated.relocated.len(),
            relocated.relocated.join(", ")
        );
    }

    // 3.11 版本隔离强制开启（version-settings.json: { isolation: 'on' }）
    let vs_path = version_dir.join("version-settings.json");
    let mut vs: Value = if vs_path.exists() {
        std::fs::read_to_string(&vs_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({}))
    } else {
        json!({})
    };
    if let Some(obj) = vs.as_object_mut() {
        obj.insert("isolation".to_string(), json!("on"));
    }
    let _ = std::fs::write(
        &vs_path,
        serde_json::to_string_pretty(&vs).unwrap_or_default(),
    );

    // 3.24 env 字段过滤（client === 'unsupported' 跳过）+ loaders 字段过滤
    let target_loaders: HashSet<String> = {
        let mut s = HashSet::new();
        if !fabric_ver.is_empty() {
            s.insert("fabric".to_string());
        }
        if !forge_ver.is_empty() {
            s.insert("forge".to_string());
        }
        if !neoforge_ver.is_empty() {
            s.insert("neoforge".to_string());
        }
        s
    };

    let mut skipped_by_loader = 0usize;
    let files_list: Vec<&MrpackFile> = manifest
        .files
        .iter()
        .filter(|f| {
            // env.client === 'unsupported' 跳过
            if let Some(ref env) = f.env
                && env.client.as_deref() == Some("unsupported") {
                    return false;
                }
            // loaders 字段过滤
            if !target_loaders.is_empty()
                && let Some(ref file_loaders) = f.loaders
                    && !file_loaders.is_empty() {
                        let compatible = file_loaders.iter().any(|l| {
                            let lower = l.to_lowercase();
                            target_loaders.contains(&lower)
                        });
                        if !compatible {
                            skipped_by_loader += 1;
                            return false;
                        }
                    }
            true
        })
        .collect();

    if skipped_by_loader > 0 {
        eprintln!("[mrpack] {} 个文件因加载器不匹配被跳过", skipped_by_loader);
    }

    let mods_dir = version_dir.join("mods");
    let _ = std::fs::create_dir_all(&mods_dir);

    // 清理上次导入失败留下的 .downloading 残留文件
    cf_shared::clean_downloading_residue(version_dir);

    let total_mods = files_list.len();

    // 构造 mod 文件状态列表
    let _mod_file_states: Vec<ModFileState> = files_list
        .iter()
        .map(|f| {
            let file_name = extract_file_name(f);
            ModFileState {
                name: file_name,
                status: ModStatus::Pending,
                progress: 0,
                size: f.file_size.unwrap_or(0),
                error: None,
            }
        })
        .collect();

    emit_progress(
        app,
        50,
        &format!("下载 Mod 文件 (共 {} 个)...", total_mods),
        "mods",
    );

    // Modrinth 官方 CDN 对高并发 IP 限流严重，且实测 32 并发最优：
    // 64 并发反而更慢（连接分摊单文件带宽变少，大文件长尾，且易触发 429 限速）。
    // 这里直接固定为 32，不再跟随全局 maxThreads（全局可能高达 64）。
    let parallel = 32;

    eprintln!(
        "[mrpack] 模组下载: 共 {} 个, 并发={}",
        total_mods, parallel
    );

    // 3.12-3.14 Mod 下载（多镜像回退 + 64 线程并发 + SHA1 校验 + 熔断保护）
    let downloaded_count = Arc::new(AtomicUsize::new(0));
    let failed_count = Arc::new(AtomicUsize::new(0));
    // 取消标志：优先复用外部传入的取消标志（支持前端"取消下载"），否则用内部标志
    let abort_flag: Arc<AtomicBool> = match abort_flag {
        Some(flag) => flag.clone(),
        None => Arc::new(AtomicBool::new(false)),
    };

    let semaphore = Arc::new(Semaphore::new(parallel));
    let mods_dir_arc = Arc::new(mods_dir.clone());
    let version_dir_arc = Arc::new(version_dir.to_path_buf());

    let mut tasks = tokio::task::JoinSet::new();

    // 并行模组下载进度通道：每个下载任务把 (idx, status, progress) 推给主循环，
    // 主循环收到后实时广播文件快照，让详情里的每个模组进度条实时更新
    let (progress_tx, mut progress_rx) =
        tokio::sync::mpsc::unbounded_channel::<(usize, &'static str, u32)>();

    // 文件状态快照：每个文件 (名称, 状态, 进度百分比)，供广播任务推给详情视图
    let files_state: Arc<Mutex<Vec<(String, String, u32)>>> = Arc::new(Mutex::new(
        files_list
            .iter()
            .map(|f| (extract_file_name(f), "pending".to_string(), 0))
            .collect(),
    ));

    // 进度广播任务：消费 progress_rx 的实时进度，更新文件快照并通过事件推给前端，
    // 这样详情视图里每个模组的进度条会随下载实时移动；所有下载任务结束后发送者
    // drop，progress_rx.recv() 返回 None，本任务自动结束
    let files_state_broadcast = files_state.clone();
    let app_broadcast = app.clone();
    let broadcast_task = tokio::spawn(async move {
        while let Some((idx, status, progress)) = progress_rx.recv().await {
            let (items, current, done, total) = {
                let mut st = files_state_broadcast.lock().await;
                if idx < st.len() {
                    st[idx].1 = status.to_string();
                    st[idx].2 = progress;
                }
                let items: Vec<Value> = st
                    .iter()
                    .map(|(name, s, p)| json!({ "name": name, "status": s, "progress": p }))
                    .collect();
                let current = st.get(idx).map(|v| v.0.clone()).unwrap_or_default();
                let done = st.iter().filter(|(_, s, _)| s == "completed").count();
                let total = st.len().max(1);
                (items, current, done, total)
            };
            // 总进度在 50→87 区间随已完成文件数实时移动
            let overall = 50 + (done * 37 / total);
            emit_progress_with_files(
                &app_broadcast,
                overall.min(87) as u32,
                &format!("下载 Mod ({}/{})...", done, total),
                "downloading",
                &items,
                &current,
            );
        }
    });

    for (idx, file_entry) in files_list.iter().enumerate() {
        if abort_flag.load(Ordering::SeqCst) {
            break;
        }

        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("获取信号量失败: {}", e))?;

        let file_name = extract_file_name(file_entry);
        // 防 zip-slip：manifest 的 path 可能是 ../ 或绝对路径，不安全时退回 mods 目录
        let dest_path = match file_entry
            .path
            .as_ref()
            .filter(|p| cf_shared::is_modpack_path_safe(p.as_str()))
        {
            Some(p) => version_dir_arc.join(p),
            None => mods_dir_arc.join(&file_name),
        };
        let downloads = file_entry.downloads.clone();
        let expected_sha1 = file_entry.hashes.sha1.clone().unwrap_or_default();
        let file_size = file_entry.file_size.unwrap_or(0);

        let downloaded_count = downloaded_count.clone();
        let failed_count = failed_count.clone();
        let abort_flag = abort_flag.clone();
        let version_dir_arc = version_dir_arc.clone();
        let progress_tx = progress_tx.clone();

        tasks.spawn(async move {
            let _permit = permit;
            let result = download_one_mod(
                &file_name,
                &dest_path,
                downloads,
                expected_sha1,
                file_size,
                &version_dir_arc,
                &abort_flag,
                &downloaded_count,
                &failed_count,
                total_mods,
                idx,
                progress_tx,
            )
            .await;
            drop(_permit);
            (idx, result)
        });
    }

    // 等待所有下载任务完成
    let mut mod_results: Vec<DownloadResult> = vec![DownloadResult::default(); files_list.len()];
    while let Some(r) = tasks.join_next().await {
        match r {
            Ok((idx, result)) => {
                if idx < mod_results.len() {
                    mod_results[idx] = result;
                }
            }
            Err(e) => {
                eprintln!("[mrpack] 下载任务异常: {}", e);
            }
        }
    }

    // 等待进度广播任务结束：显式 drop 主循环持有的发送端，否则广播任务收不到 None 永不结束
    drop(progress_tx);
    let _ = broadcast_task.await;

    if abort_flag.load(Ordering::SeqCst) {
        return Err("下载已取消".to_string());
    }

    let ok_count = downloaded_count.load(Ordering::SeqCst);
    let fail_count = failed_count.load(Ordering::SeqCst);
    eprintln!(
        "[mrpack] 模组下载完成: {}成功 {}失败",
        ok_count, fail_count
    );

    if fail_count > 0 {
        let failed_names: Vec<String> = mod_results
            .iter()
            .filter(|r| !r.success)
            .map(|r| r.file_name.clone())
            .collect();
        eprintln!("[mrpack] 失败的模组: {}", failed_names.join(", "));
    }

    // 3.16 损坏 JAR 修复 repair_corrupted_mod_jars
    emit_progress(app, 88, "正在修复损坏的模组文件...", "repair");
    let repair_result = cf_shared::repair_corrupted_mod_jars(version_dir);
    if repair_result.failed > 0 {
        eprintln!(
            "[mrpack] {} 个模组文件损坏且无法修复，游戏启动时可能报错",
            repair_result.failed
        );
    }

    // 3.15 模组清单保存 save_mod_manifest
    let mut manifest_mods: Vec<Value> = Vec::new();
    for (i, f) in files_list.iter().enumerate() {
        let file_name = extract_file_name(f);
        let mods_file_path = match f
            .path
            .as_ref()
            .filter(|p| cf_shared::is_modpack_path_safe(p.as_str()))
        {
            Some(p) => version_dir.join(p),
            None => mods_dir.join(&file_name),
        };
        // 只记录 mods 目录下实际存在的 .jar 文件
        if !file_name.to_lowercase().ends_with(".jar") {
            continue;
        }
        if !mods_file_path.exists() {
            continue;
        }
        let mod_id = cf_shared::read_jar_mod_id(&mods_file_path);
        let download_url = f.downloads.first().cloned().unwrap_or_default();
        manifest_mods.push(json!({
            "projectID": null,
            "fileID": null,
            "fileName": file_name,
            "downloadUrl": download_url,
            "fileLength": f.file_size.unwrap_or(0),
            "sha1": f.hashes.sha1.as_ref().cloned().unwrap_or_default(),
            "modId": mod_id,
        }));
        // 标记是否下载成功（用于后续 failed-mods.json）
        let _ = i;
    }
    cf_shared::save_mod_manifest(version_dir, &manifest_mods);
    eprintln!(
        "[mrpack] 已保存 mod-manifest.json: {} 个 mod",
        manifest_mods.len()
    );

    // 3.17 失败模组列表持久化（failed-mods.json）
    let mut failed_mods_list: Vec<Value> = Vec::new();
    for result in &mod_results {
        if !result.success {
            failed_mods_list.push(json!({
                "name": result.file_name,
                "error": result.error,
            }));
        }
    }
    if !failed_mods_list.is_empty() {
        let failed_path = version_dir.join("failed-mods.json");
        let failed_json = json!({
            "packName": pack_name,
            "mcVersion": mc_version,
            "totalMods": total_mods,
            "failedCount": fail_count,
            "downloadedCount": ok_count,
            "failedAt": cf_shared::now_iso(),
            "failedMods": failed_mods_list.clone(),
            "note": "这些模组在导入时下载失败，可重新导入整合包补下载，或手动从 Modrinth 下载后放入 mods 文件夹"
        });
        let _ = std::fs::write(
            &failed_path,
            serde_json::to_string_pretty(&failed_json).unwrap_or_default(),
        );
        eprintln!(
            "[mrpack] 已保存失败模组列表: {} ({}/{})",
            failed_path.display(),
            fail_count,
            total_mods
        );
    }

    // 3.18 加载器兼容性检查 ensure_loader_compat
    if let Some(_lv_id) = loader_version_id
        && !mc_version.is_empty() {
            let loader_type = if !fabric_ver.is_empty() {
                "fabric"
            } else if !forge_ver.is_empty() || !neoforge_ver.is_empty() {
                "forge"
            } else {
                ""
            };
            let current_ver = if !fabric_ver.is_empty() {
                fabric_ver
            } else if !forge_ver.is_empty() {
                forge_ver
            } else {
                neoforge_ver
            };
            if !loader_type.is_empty() && !current_ver.is_empty() {
                let _ = cf_shared::ensure_loader_compat(
                    version_id,
                    version_dir,
                    mc_version,
                    current_ver,
                    loader_type,
                )
                .await;
            }
        }

    // 3.19 库文件验证 verify_import_libs
    emit_progress(app, 90, "正在验证整合包完整性...", "verify");
    let (verify_ok, _checked, missing) = cf_shared::verify_import_libs(version_id).await;
    if !verify_ok {
        eprintln!("[mrpack] 库文件补全失败: {} 个文件缺失", missing);
        cf_shared::cleanup_version_chain(version_id);
        return Err(format!(
            "整合包库文件补全失败: {} 个文件缺失，请检查网络后重试",
            missing
        ));
    }

    // 3.20 资源索引下载（解析 assetIndex + 缺资源并发下载 64 线程）
    let settings = storage::load_settings();
    let merged_json = cf_shared::resolve_version_json(version_id);
    if let Some(ref merged) = merged_json
        && let Some(asset_index) = merged.get("assetIndex") {
            emit_progress(app, 93, "正在下载游戏资源...", "assets");
            if let Err(e) = download_assets(app, asset_index, &settings).await {
                eprintln!("[mrpack] 资源下载异常(非致命): {}", e);
            }
        }

    // 3.21 客户端 JAR 下载（3 次重试 + 失败非致命）
    // 目标主 jar：优先 jar/继承版本，自包含合并版本则用自身版本目录。
    // 自包含版本移除了 inheritsFrom，但合并时保留了 downloads.client，据此直接下载主 jar。
    if let Some(ref merged) = merged_json {
        let main_jar_id = merged
            .get("jar")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                merged
                    .get("inheritsFrom")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| version_id.to_string());
        let main_jar_path = versions_dir().join(&main_jar_id).join(format!("{}.jar", main_jar_id));
        if !main_jar_path.exists() {
            let jar_url = merged
                .get("downloads")
                .and_then(|d| d.get("client"))
                .and_then(|c| c.get("url"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    // 继承版本自身通常无 client，读基础版本 JSON 的 client url
                    if main_jar_id != version_id {
                        let base_json_path =
                            versions_dir().join(&main_jar_id).join(format!("{}.json", main_jar_id));
                        if let Ok(content) = std::fs::read_to_string(&base_json_path)
                            && let Ok(json) = serde_json::from_str::<Value>(&content) {
                                return json
                                    .get("downloads")
                                    .and_then(|d| d.get("client"))
                                    .and_then(|c| c.get("url"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                            }
                    }
                    None
                });
                if let Some(url) = jar_url {
                    emit_progress(app, 97, "正在下载客户端JAR...", "assets");
                    let mut jar_ok = false;
                    for attempt in 0..3u32 {
                        match crate::download::single::download_with_mirror(
                            &url,
                            &main_jar_path,
                            None,
                            None,
                            "china-first",
                            180,
                            None,
                        )
                        .await
                        {
                            Ok(_) => {
                                jar_ok = true;
                                break;
                            }
                            Err(e) => {
                                eprintln!(
                                    "[mrpack] 客户端JAR下载失败({}/3): {}",
                                    attempt + 1,
                                    e
                                );
                                let _ = std::fs::remove_file(&main_jar_path);
                                if attempt < 2 {
                                    tokio::time::sleep(Duration::from_secs(2)).await;
                                }
                            }
                        }
                    }
                    if !jar_ok {
                        eprintln!("[mrpack] 客户端JAR下载最终失败(非致命)，启动时会自动补全");
                    }
                }
            }
    }

    // 3.22 Forge 核心文件验证（forge-client.jar / client-srg.jar / client-extra.jar）
    if let Some(ref merged) = merged_json
        && !forge_ver.is_empty()
            && let Err(e) = check_forge_core_files(merged) {
                cf_shared::cleanup_version_chain(version_id);
                return Err(e);
            }

    // 3.23 pack-info.json 写入
    let pack_info = json!({
        "name": pack_name,
        "versionId": version_id,
        "mcVersion": mc_version,
        "packFormat": "mrpack",
        "fabricVersion": fabric_ver,
        "forgeVersion": forge_ver,
        "neoforgeVersion": neoforge_ver,
        "importedAt": cf_shared::now_iso(),
        "sourceFile": file_path,
        "targetVersion": "",
    });
    let _ = std::fs::write(
        version_dir.join("pack-info.json"),
        serde_json::to_string_pretty(&pack_info).unwrap_or_default(),
    );

    // 3.24 保存 mrpack-manifest.json（供启动前 mods 完整性检查使用）
    let manifest_for_check = build_mrpack_manifest_for_check(manifest, version_dir, pack_name);
    let _ = std::fs::write(
        version_dir.join("mrpack-manifest.json"),
        serde_json::to_string_pretty(&manifest_for_check).unwrap_or_default(),
    );

    // 完成
    // 原版依赖目录为流程本次新建、且整合包版本已自含（合并后独立）时，清理该临时原版目录，
    // 避免遗留独立的原版版本目录（与合并式安装行为一致）
    if !base_vanilla_pre_existed
        && !mc_version.is_empty()
        && mc_version != version_id
    {
        let vanilla_dir = versions_dir().join(mc_version);
        if vanilla_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&vanilla_dir) {
                eprintln!("[mrpack] 清理临时原版目录失败: {}", e);
            } else {
                eprintln!("[mrpack] 已清理本次新建的临时原版目录: {}", vanilla_dir.display());
            }
        }
    }

    emit_progress(
        app,
        100,
        &format!("整合包 \"{}\" 导入完成！", pack_name),
        "done",
    );

    // 失败阈值检查
    // failCount > 0 && failCount >= failThreshold → 返回失败
    // failCount > 0 && failCount < failThreshold → 返回成功+warning
    // failCount == 0 → 返回成功
    let fail_threshold = std::cmp::max(5usize, total_mods / 10);
    if fail_count > 0 && fail_count >= fail_threshold {
        let failed_mod_names: Vec<String> = mod_results
            .iter()
            .filter(|r| !r.success)
            .map(|r| r.file_name.clone())
            .collect();
        let error_msg = format!(
            "{}/{} 个Mod下载失败（阈值{}），整合包不完整无法正常运行。失败的Mod: {}。请检查网络后重试。",
            fail_count,
            total_mods,
            fail_threshold,
            failed_mod_names.join(", ")
        );
        eprintln!("[mrpack] 导入失败: {}", error_msg);
        cf_shared::cleanup_version_chain(version_id);
        let failed_mods_json: Vec<Value> = mod_results
            .iter()
            .filter(|r| !r.success)
            .map(|r| {
                json!({
                    "name": r.file_name,
                    "status": "failed",
                    "error": r.error,
                })
            })
            .collect();
        return Ok(json!({
            "success": false,
            "versionId": version_id,
            "error": error_msg,
            "failedMods": failed_mods_json,
        }));
    }

    if fail_count > 0 {
        let failed_mod_names: Vec<String> = mod_results
            .iter()
            .filter(|r| !r.success)
            .map(|r| r.file_name.clone())
            .collect();
        let warning_msg = format!(
            "{}/{} 个Mod下载失败: {}。请在内部浏览器中手动下载缺失的Mod，或检查网络后重试。",
            fail_count,
            total_mods,
            failed_mod_names.join(", ")
        );
        let failed_mods_json: Vec<Value> = mod_results
            .iter()
            .filter(|r| !r.success)
            .map(|r| {
                json!({
                    "name": r.file_name,
                    "status": "failed",
                    "error": r.error,
                })
            })
            .collect();
        return Ok(json!({
            "success": true,
            "name": pack_name,
            "versionId": version_id,
            "mcVersion": mc_version,
            "targetVersion": "",
            "warning": warning_msg,
            "failedMods": failed_mods_json,
            "loaderVersionId": loader_version_id,
        }));
    }

    Ok(json!({
        "success": true,
        "name": pack_name,
        "versionId": version_id,
        "mcVersion": mc_version,
        "targetVersion": "",
        "loaderVersionId": loader_version_id,
    }))
}

// ============== 加载器安装 ==============


// ============== 下载相关 ==============



#[allow(dead_code)]
pub(crate) struct ModFileState {
    name: String,
    status: ModStatus,
    progress: u32,
    size: i64,
    error: Option<String>,
}



// ============== 资源索引下载 ==============



// ============== Forge 核心文件验证 ==============


// ============== mrpack-manifest.json 构建 ==============






// ============== 根目录图标提取 ==============


// ============== 文件名提取 ==============


// ============== 镜像 URL 列表 ==============


// 子模块声明与公共导出
mod download;
pub(crate) use download::*;
mod assets;
pub(crate) use assets::*;
mod loader;
pub(crate) use loader::*;
mod manifest_check;
pub(crate) use manifest_check::*;
mod extract;
pub(crate) use extract::*;
