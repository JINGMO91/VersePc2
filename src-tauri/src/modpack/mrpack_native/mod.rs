// modpack/mrpack_native/mod.rs — Modrinth (.mrpack) 整合包导入
//
// 解析 modrinth.index.json，安装基础版本与模组加载器，下载 mods 与 overrides。

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::curseforge_shared as cf_shared;
use super::{emit_progress, emit_progress_with_files, normalize_version_id, versions_dir};
use crate::modloaders::shared as ml_shared;

mod import;
mod json;
mod loader;

pub(crate) use import::*;
pub(crate) use json::*;
pub(crate) use loader::*;

// 单文件下载最大重试轮数
pub(crate) const MAX_DOWNLOAD_ROUNDS: u32 = 3;

/// 取消标志清理守卫：作用域结束时自动 unregister 注册的取消标志
/// 确保导入无论是成功、失败还是被取消，都不会在注册表中残留 token
pub(crate) struct CleanupAbort(Option<String>);

impl Drop for CleanupAbort {
    fn drop(&mut self) {
        if let Some(token) = &self.0 {
            super::unregister_modpack_abort(token);
        }
    }
}

// ============== 数据结构 ==============

// modrinth.index.json schema
#[derive(Deserialize)]
#[allow(dead_code)]
pub(crate) struct MrpackManifest {
    #[serde(default)]
    format_version: Option<i64>,
    #[serde(default)]
    game: Option<String>,
    #[serde(default)]
    version_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    files: Vec<MrpackFile>,
    #[serde(default)]
    dependencies: MrpackDependencies,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(crate) struct MrpackDependencies {
    minecraft: Option<String>,
    forge: Option<String>,
    neoforge: Option<String>,
    #[serde(rename = "fabric-loader")]
    fabric_loader: Option<String>,
    #[serde(rename = "quilt-loader")]
    quilt_loader: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct MrpackFile {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    hashes: MrpackHashes,
    #[serde(default)]
    downloads: Vec<String>,
    #[serde(default)]
    file_size: Option<i64>,
    #[serde(default)]
    env: Option<MrpackEnv>,
    #[serde(default)]
    loaders: Option<Vec<String>>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(crate) struct MrpackHashes {
    sha1: Option<String>,
    #[allow(dead_code)]
    sha512: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct MrpackEnv {
    #[serde(default)]
    client: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    server: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub(crate) enum LoaderKind {
    Forge,
    NeoForge,
    Fabric,
    None,
}

// ============== 主入口 ==============

/// 导入 Modrinth (.mrpack) 整合包
///
/// 全部功能点：
/// 1. modrinth.index.json 解析（formatVersion/game/versionId/name/summary/files/dependencies）
/// 2. 版本目录去重 dedupe_version_id
/// 3. 基础版本安装 ensure_base_version_installed
/// 4. Forge/NeoForge/Fabric 安装（已存在则校验 libs 完整性，损坏则删除重装；Quilt 显式报错）
/// 5. 版本 JSON 创建（mergeVersionJson 合并 + 复制主 jar + 删除加载器目录）
/// 6. mods 目录备份（已存在版本目录时备份到 *.backup_<timestamp>）
/// 7. overrides 解压（路径遍历保护 + 5 次重试 + 50 文件 yield + 实时进度）
/// 8. client_overrides 解压（overrides 之后解压，路径遍历保护）
/// 9. 根目录图标提取（pack.png / icon.png / logo.png）
/// 10. 资源包重定位 relocate_misplaced_resource_packs
/// 11. 版本隔离强制开启（version-settings.json: { isolation: 'on' }）
/// 12. env 字段过滤（client === 'unsupported' 跳过）+ loaders 字段过滤
/// 13. Modrinth 文件下载（多镜像回退 + 64 线程并发 + SHA1 校验）
/// 14. 熔断保护（失败数 > max(5, 10% × 总数) 且 failCount > okCount 才取消）
/// 15. 失败模组列表持久化（failed-mods.json）
/// 16. 模组清单保存 save_mod_manifest
/// 17. 损坏 JAR 修复 repair_corrupted_mod_jars
/// 18. 加载器兼容性检查 ensure_loader_compat
/// 19. 库文件验证 verify_import_libs
/// 20. 资源索引下载（解析 assetIndex + 缺资源并发下载 64 线程）
/// 21. 客户端 JAR 下载（3 次重试 + 失败非致命）
/// 22. Forge 核心文件验证（forge-client.jar / client-srg.jar / client-extra.jar）
/// 23. pack-info.json 写入
/// 24. mrpack-manifest.json 保存（供启动前 mods 完整性检查使用）
/// 25. 失败回滚（恢复备份的 mods 目录 + cleanupVersionChain）
pub async fn import_mrpack(
    app: &AppHandle,
    file_path: &str,
    custom_version_name: &str,
    update_version_id: Option<&str>,
    cancel_token: Option<&str>,
) -> Value {
    eprintln!("[mrpack] 开始导入: {}", file_path);

    // 支持取消：注册取消标志（若提供了 cancel_token），供 /api/modpack/cancel 触发中断
    let abort_flag = if let Some(token) = cancel_token {
        if token.is_empty() {
            None
        } else {
            Some(super::register_modpack_abort(token))
        }
    } else {
        None
    };
    // 导入结束（成功或失败）统一清理注册的取消标志
    let _cleanup = CleanupAbort(cancel_token.map(str::to_string));

    // 1. 打开 zip 找 modrinth.index.json
    let file = match std::fs::File::open(file_path) {
        Ok(f) => f,
        Err(e) => return json!({ "success": false, "error": format!("无法打开文件: {}", e) }),
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => return json!({ "success": false, "error": format!("无法读取 ZIP: {}", e) }),
    };

    // 找到 modrinth.index.json
    let manifest_idx = {
        let mut found: Option<usize> = None;
        for i in 0..archive.len() {
            if let Ok(entry) = archive.by_index(i)
                && entry.name().to_lowercase() == "modrinth.index.json" {
                    found = Some(i);
                    break;
                }
        }
        found
    };
    let manifest_idx = match manifest_idx {
        Some(i) => i,
        None => {
            return json!({
                "success": false,
                "error": "Modrinth 整合包缺少 modrinth.index.json"
            })
        }
    };

    // 3.1 modrinth.index.json 解析
    let manifest_str = {
        let mut entry = match archive.by_index(manifest_idx) {
            Ok(e) => e,
            Err(e) => {
                return json!({
                    "success": false,
                    "error": format!("读取 modrinth.index.json 失败: {}", e)
                })
            }
        };
        let mut buf = String::new();
        if let Err(e) = entry.read_to_string(&mut buf) {
            return json!({
                "success": false,
                "error": format!("解析 modrinth.index.json 失败: {}", e)
            });
        }
        buf
    };

    let manifest: MrpackManifest = match serde_json::from_str(&manifest_str) {
        Ok(m) => m,
        Err(e) => {
            return json!({
                "success": false,
                "error": format!("解析 modrinth.index.json 失败: {}", e)
            })
        }
    };

    // 3.1 game 字段校验（必须是 minecraft）
    if let Some(ref game) = manifest.game
        && game != "minecraft" {
            return json!({
                "success": false,
                "error": format!("不支持的 game 类型: {}（仅支持 minecraft）", game)
            });
        }

    // 3.1 提取 packName（过滤非法字符）
    let pack_name_raw = manifest
        .name
        .as_ref()
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| {
            Path::new(file_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Modpack")
                .to_string()
        });
    let pack_name: String = pack_name_raw
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect();

    // 3.1 dependencies 解析（minecraft、forge、neoforge、fabric-loader、quilt-loader）
    // mcVersion 提取：必须非空、不等于 'minecraft'、以数字开头
    let mc_version = manifest
        .dependencies
        .minecraft
        .as_ref()
        .filter(|v| {
            !v.is_empty()
                && v.as_str() != "minecraft"
                && v.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
        })
        .cloned()
        .unwrap_or_default();

    // 如果 mcVersion 与 versionId 相同则置空
    let mc_version = if !mc_version.is_empty() {
        if let Some(ref vid) = manifest.version_id {
            if vid.as_str() == mc_version {
                String::new()
            } else {
                mc_version
            }
        } else {
            mc_version
        }
    } else {
        mc_version
    };

    let fabric_ver = manifest.dependencies.fabric_loader.clone().unwrap_or_default();
    let mut forge_ver = manifest.dependencies.forge.clone().unwrap_or_default();
    let neoforge_ver = manifest.dependencies.neoforge.clone().unwrap_or_default();
    let quilt_ver = manifest.dependencies.quilt_loader.clone().unwrap_or_default();

    // forge 版本号去掉 mcVersion 前缀（如 "1.20.1-47.4.20" → "47.4.20"）
    if !forge_ver.is_empty() && !mc_version.is_empty() {
        let prefix = format!("{}-", mc_version);
        if forge_ver.starts_with(&prefix) {
            forge_ver = forge_ver[prefix.len()..].to_string();
        }
    }

    // 3.4 Quilt 如果不支持要显式报错
    if !quilt_ver.is_empty() {
        return json!({
            "success": false,
            "error": format!(
                "整合包要求 Quilt Loader {}，但当前版本暂不支持 Quilt，请使用 Fabric 版本的整合包",
                quilt_ver
            )
        });
    }

    emit_progress(
        app,
        8,
        &format!("整合包: {}  MC: {}", pack_name, mc_version),
        "prepare",
    );

// 3.2 版本目录去重 dedupe_version_id
    // 更新整合包时（update_version_id 非空）复用指定版本目录，不新建版本
    let base_version_id = if !custom_version_name.is_empty() {
        normalize_version_id(custom_version_name)
    } else {
        normalize_version_id(&pack_name)
    };
    let version_id = if let Some(uv) = update_version_id {
        if uv.is_empty() {
            cf_shared::dedupe_version_id(&base_version_id)
        } else {
            normalize_version_id(uv)
        }
    } else {
        cf_shared::dedupe_version_id(&base_version_id)
    };
    let version_dir = versions_dir().join(&version_id);

    // 创建版本目录
    if let Err(e) = std::fs::create_dir_all(&version_dir) {
        return json!({
            "success": false,
            "error": format!("无法创建版本目录: {}", e)
        });
    }

    let is_new_version_dir = !version_dir.join(format!("{}.json", version_id)).exists();

    // loaderVersionId 计算
    let loader_version_id: Option<String> = if !forge_ver.is_empty() {
        Some(format!("{}-forge-{}", mc_version, forge_ver))
    } else if !neoforge_ver.is_empty() {
        Some(format!("{}-neoforge-{}", mc_version, neoforge_ver))
    } else if !fabric_ver.is_empty() {
        Some(format!("fabric-loader-{}-{}", fabric_ver, mc_version))
    } else {
        None
    };

    // 3.3-3.5 基础版本安装 + 加载器安装 + 版本 JSON 创建
    if is_new_version_dir {
        // 3.3 基础版本安装
        emit_progress(app, 5, "正在准备基础版本...", "base");
        let app_owned = app.clone();
        let on_progress = Some(Box::new(move |pct: u32, msg: String| {
            // 基础版本安装的 0-100 映射到整合包整体的 5-20 区间
            let mapped = 5 + (pct as u64 * 15 / 100).min(15) as u32;
            emit_progress(&app_owned, mapped, &msg, "base")
        }) as ml_shared::BaseVersionProgress);
        if let Err(e) = ml_shared::ensure_base_version_installed(&mc_version, on_progress).await {
            let _ = std::fs::remove_dir_all(&version_dir);
            return json!({
                "success": false,
                "versionId": version_id,
                "error": e
            });
        }

        // 3.4 Forge/NeoForge/Fabric 安装
        if !forge_ver.is_empty() || !neoforge_ver.is_empty() || !fabric_ver.is_empty() {
            emit_progress(app, 20, "正在安装模组加载器...", "loader-install");
            match install_loader(
                &forge_ver,
                &neoforge_ver,
                &fabric_ver,
                &mc_version,
                app,
            )
            .await
            {
                Ok(_lv_id) => {
                    // lv_id 已经和 loader_version_id 一致
                }
                Err(e) => {
                    eprintln!("[mrpack] 模组加载器安装失败: {}", e);
                    let _ = std::fs::remove_dir_all(&version_dir);
                    return json!({
                        "success": false,
                        "versionId": version_id,
                        "error": e
                    });
                }
            }
        }

        // 3.5 版本 JSON 创建（mergeVersionJson 合并）
        emit_progress(app, 35, "正在创建版本配置...", "version-config");
        create_version_json_with_merge(
            &version_id,
            &version_dir,
            &mc_version,
            loader_version_id.as_deref(),
        );

        emit_progress(app, 40, "模组加载器就绪", "loader");
    }

    // re-merge 逻辑：如果现有版本 JSON 仍有 inheritsFrom，则重新合并
    // 整合包重装/重导入时检测现有版本JSON是否已合并加载器内容
    {
        let version_json_path = version_dir.join(format!("{}.json", version_id));
        let existing_json: Option<Value> = if version_json_path.exists() {
            std::fs::read_to_string(&version_json_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
        } else {
            None
        };

        if let Some(ref existing) = existing_json
            && existing.get("inheritsFrom").and_then(|v| v.as_str()).is_some()
                && let Some(ref lv_id) = loader_version_id {
                    emit_progress(
                        app,
                        5,
                        &format!("正在同步加载器到 {}...", lv_id),
                        "base-fix",
                    );

                    // 确保基础版本存在
                    if !mc_version.is_empty() {
                        let app_owned = app.clone();
                        let on_progress = Some(Box::new(move |pct: u32, msg: String| {
                            // 基础版本安装的 0-100 映射到整合包整体的 5-20 区间
                            let mapped = 5 + (pct as u64 * 15 / 100).min(15) as u32;
                            emit_progress(&app_owned, mapped, &msg, "base")
                        }) as ml_shared::BaseVersionProgress);
                        if let Err(e) = ml_shared::ensure_base_version_installed(&mc_version, on_progress).await {
                            eprintln!("[mrpack] 基础版本 {} 安装失败: {}", mc_version, e);
                            let _ = std::fs::remove_dir_all(&version_dir);
                            return json!({
                                "success": false,
                                "versionId": version_id,
                                "error": format!("基础版本 {} 安装失败: {}", mc_version, e)
                            });
                        }
                    }

                    // 确保加载器已安装
                    let lv_json_path = versions_dir().join(lv_id).join(format!("{}.json", lv_id));
                    let need_install = if !lv_json_path.exists() {
                        true
                    } else if !cf_shared::verify_loader_libs(lv_id) {
                        let _ = std::fs::remove_dir_all(versions_dir().join(lv_id));
                        true
                    } else {
                        false
                    };
                    if need_install {
                        if lv_json_path.exists() && !cf_shared::verify_loader_libs(lv_id) {
                            let _ = std::fs::remove_dir_all(versions_dir().join(lv_id));
                        }
                        match install_loader(&forge_ver, &neoforge_ver, &fabric_ver, &mc_version, app).await {
                            Ok(_) => {}
                            Err(e) => {
                                eprintln!("[mrpack] 加载器 {} 安装失败: {}", lv_id, e);
                                let _ = std::fs::remove_dir_all(&version_dir);
                                return json!({
                                    "success": false,
                                    "versionId": version_id,
                                    "error": format!("整合包要求 {} 但安装失败: {}", lv_id, e)
                                });
                            }
                        }
                    }

                    // 重新合并版本 JSON
                    remerge_version_json(
                        &version_json_path,
                        &version_id,
                        &mc_version,
                        lv_id,
                    );

                    // 删除加载器目录
                    let loader_dir = versions_dir().join(lv_id);
                    if loader_dir.exists() && loader_dir != version_dir {
                        let _ = std::fs::remove_dir_all(&loader_dir);
                    }
                }
    }

    // fallback：如果 isNewVersionDir 但版本 JSON 仍不存在，创建 fallback
    if is_new_version_dir && !version_dir.join(format!("{}.json", version_id)).exists() {
        create_fallback_version_json(
            &version_id,
            &version_dir,
            &mc_version,
            loader_version_id.as_deref(),
        );
    }

    // 3.6 mods 目录备份（已存在版本目录时备份到 *.backup_<timestamp>）
    let backup_dir: Option<PathBuf> = if !is_new_version_dir {
        let existing_mods_dir = version_dir.join("mods");
        if existing_mods_dir.exists() {
            let bk_dir = version_dir
                .parent()
                .map(|p| {
                    p.join(format!(
                        "{}.backup_{}",
                        version_id,
                        cf_shared::now_timestamp()
                    ))
                })
                .unwrap_or_else(|| {
                    version_dir.with_file_name(format!(
                        "{}.backup_{}",
                        version_id,
                        cf_shared::now_timestamp()
                    ))
                });
            if let Err(e) = std::fs::create_dir_all(bk_dir.join("mods")) {
                eprintln!("[mrpack] 备份 mods 目录失败 (非致命): {}", e);
                None
            } else {
                let _ = cf_shared::copy_dir_recursive(&existing_mods_dir, &bk_dir.join("mods"));
                Some(bk_dir)
            }
        } else {
            None
        }
    } else {
        None
    };

    // 主流程（包含 overrides 解压、mods 下载、验证等）
    let result = match run_import_main(
        app,
        &mut archive,
        &manifest,
        &version_id,
        &version_dir,
        &pack_name,
        &mc_version,
        &forge_ver,
        &fabric_ver,
        &neoforge_ver,
        loader_version_id.as_deref(),
        file_path,
        abort_flag.as_ref(),
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            // 3.25 失败回滚：恢复备份的 mods 目录 + cleanupVersionChain
            eprintln!("[mrpack] 导入失败: {}", e);
            if let Some(ref bk_dir) = backup_dir {
                let restored_mods_dir = bk_dir.join("mods");
                if restored_mods_dir.exists() {
                    let current_mods_dir = version_dir.join("mods");
                    if current_mods_dir.exists() {
                        let _ = std::fs::remove_dir_all(&current_mods_dir);
                    }
                    let _ = cf_shared::copy_dir_recursive(&restored_mods_dir, &current_mods_dir);
                }
                let _ = std::fs::remove_dir_all(bk_dir);
            }
            cf_shared::cleanup_version_chain(&version_id);
            return json!({
                "success": false,
                "versionId": version_id,
                "error": e
            });
        }
    };

    // 清理备份
    if let Some(bk_dir) = backup_dir {
        let _ = std::fs::remove_dir_all(&bk_dir);
    }

    result
}

// ============== 主流程 ==============
