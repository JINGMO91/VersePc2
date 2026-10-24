// download.rs — 由 curseforge.rs 拆分
#![allow(unused_imports)]

// 文件信息、并发下载、镜像与校验
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::Semaphore;
use crate::modpack::curseforge_shared as cf_shared;
use super::{emit_progress, normalize_version_id, versions_dir};
use crate::modloaders::shared as ml_shared;
use crate::storage;
use super::*;

#[derive(Debug, Clone, Default)]
pub(crate) struct FileInfo {
    pub(crate) file_name: String,
    pub(crate) download_url: String,
    pub(crate) file_length: i64,
    pub(crate) sha1: String,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct DownloadResult {
    pub(crate) success: bool,
    pub(crate) project_id: i64,
    pub(crate) file_id: i64,
    pub(crate) file_name: String,
    pub(crate) download_url: Option<String>,
    pub(crate) file_length: i64,
    pub(crate) sha1: String,
    pub(crate) mod_id: Option<String>,
    pub(crate) file_info: Option<FileInfo>,
    pub(crate) error: String,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) enum ModStatus {
    Pending,
    Downloading,
    Completed,
    Failed,
}

#[allow(dead_code)]
pub(crate) struct ModFileState {
    pub(crate) name: String,
    pub(crate) status: ModStatus,
    pub(crate) progress: u32,
    pub(crate) project_id: i64,
    pub(crate) file_id: i64,
    pub(crate) dest_path: Option<PathBuf>,
    pub(crate) mod_id: Option<String>,
    pub(crate) file_info: Option<FileInfo>,
    pub(crate) error: Option<String>,
}

/// 逐个查询单个文件信息（批量接口失败时的兜底）
///
/// 调用 CurseForge `GET /mods/{projectID}/files/{fileID}`，
/// 返回 `(download_url, file_name, file_length, sha1)`。
pub(crate) async fn fetch_single_file_info(
    project_id: i64,
    file_id: i64,
    cf_api_key: &str,
) -> Option<(String, String, i64, String)> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .ok()?;
    // 镜像优先，失败则回退官方接口：镜像偶发不可用时仍能拿到文件信息
    for base in [CF_API_MIRROR, CF_API_OFFICIAL] {
        let url = format!("{}/mods/{}/files/{}", base, project_id, file_id);
        eprintln!("[CurseForge] 单个文件信息查询: {}", url);
        let res = match client
            .get(&url)
            .header("x-api-key", cf_api_key)
            .send()
            .await
        {
            Ok(res) => res,
            Err(e) => {
                eprintln!("[CurseForge] 单个文件查询异常: {} ({})", url, e);
                continue;
            }
        };
        if !res.status().is_success() {
            eprintln!(
                "[CurseForge] 单个文件查询失败 status={} ({})",
                res.status(),
                url
            );
            continue;
        }
        let Ok(data) = res.json::<CfFileResponse>().await else {
            continue;
        };
        let dl_url = data.download_url.clone().unwrap_or_default();
        let sha1 = data
            .hashes
            .as_ref()
            .and_then(|h| h.iter().find(|x| x.algo == 1))
            .map(|h| h.value.clone())
            .unwrap_or_default();
        return Some((dl_url, data.file_name, data.file_length.unwrap_or(0), sha1));
    }
    None
}

/// 下载单个模组文件
///
/// 流程：
/// 1. 确定目标文件名（优先从 URL 解码，其次用 API fileName）
/// 2. 已存在则校验大小+SHA1，通过则跳过
/// 3. 构造镜像 URL 列表（原 URL + mcimirror 镜像）
/// 4. 3 轮重试下载，每轮失败后延后重试
/// 5. 下载后 SHA1 校验
/// 6. 熔断保护：失败数 > max(20, 40% × 总数) 且 failRatio > 0.75 才取消
#[allow(clippy::too_many_arguments)]
pub(crate) async fn download_one_mod(
    project_id: i64,
    file_id: i64,
    download_url: Option<String>,
    file_name: String,
    file_size: i64,
    expected_sha1: String,
    mods_dir: Arc<PathBuf>,
    abort_flag: Arc<AtomicBool>,
    downloaded_count: Arc<AtomicUsize>,
    failed_count: Arc<AtomicUsize>,
    total_mods: usize,
    _cf_api_key: Arc<String>,
    file_info_map: Arc<HashMap<i64, CfFileResponse>>,
) -> DownloadResult {
    // 1. 确定文件名：优先从 URL basename 解码
    let final_name = download_url
        .as_ref()
        .and_then(|u| percent_decode_basename(u))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| sanitize_filename(&file_name));
    let dest = mods_dir.join(&final_name);

    let make_result = |success: bool, error: &str| DownloadResult {
        success,
        project_id,
        file_id,
        file_name: final_name.clone(),
        download_url: download_url.clone(),
        file_length: file_size,
        sha1: expected_sha1.clone(),
        mod_id: None,
        file_info: None,
        error: error.to_string(),
    };

    // 2. 已存在校验：大小 + SHA1
    if dest.exists() && cf_shared::is_jar_intact_deep(&dest) {
        let can_skip = if file_size > 0 {
            match std::fs::metadata(&dest) {
                Ok(meta) => {
                    if meta.len() as i64 != file_size {
                        eprintln!(
                            "[CurseForge] 已存在文件大小不匹配，重新下载: {} (期望={}, 实际={})",
                            final_name, file_size, meta.len()
                        );
                        false
                    } else if !expected_sha1.is_empty() {
                        match crate::download::single::compute_sha1(&dest).await {
                            Ok(actual) => {
                                if actual.to_lowercase() == expected_sha1.to_lowercase() {
                                    true
                                } else {
                                    eprintln!(
                                        "[CurseForge] 已存在文件 SHA1 不匹配，重新下载: {}",
                                        final_name
                                    );
                                    false
                                }
                            }
                            Err(e) => {
                                eprintln!(
                                    "[CurseForge] 校验已存在文件失败: {} - {}",
                                    final_name, e
                                );
                                false
                            }
                        }
                    } else {
                        true
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[CurseForge] 校验已存在文件失败: {} - {}",
                        final_name, e
                    );
                    false
                }
            }
        } else {
            true
        };

        if !can_skip {
            let _ = std::fs::remove_file(&dest);
        } else {
            // 跳过下载，直接返回成功
            let mod_id = cf_shared::read_jar_mod_id(&dest);
            let file_info = file_info_map.get(&file_id).map(|fi| FileInfo {
                file_name: final_name.clone(),
                download_url: fi.download_url.clone().unwrap_or_default(),
                file_length: fi.file_length.unwrap_or(0),
                sha1: fi
                    .hashes
                    .as_ref()
                    .and_then(|h| h.iter().find(|x| x.algo == 1))
                    .map(|h| h.value.clone())
                    .unwrap_or_default(),
            });
            downloaded_count.fetch_add(1, Ordering::SeqCst);
            return DownloadResult {
                success: true,
                project_id,
                file_id,
                file_name: final_name,
                download_url: download_url.clone(),
                file_length: file_size,
                sha1: expected_sha1,
                mod_id,
                file_info,
                error: String::new(),
            };
        }
    }

    // 3. URL 校验 + 兜底获取
    //   只要拿到了 fileName，即便 downloadUrl 为空，也要按 fileID 分段构造 edge.forgecdn.net CDN URL。
    //   CurseForge 部分文件 API 返回 downloadUrl 为 null，但 CDN 实际可访问。
    let mut resolved_url: Option<String> = download_url.clone();
    let mut resolved_name: String = file_name.clone();
    let mut resolved_size: i64 = file_size;
    let mut resolved_sha1: String = expected_sha1.clone();

    if resolved_url.as_deref().unwrap_or("").is_empty() {
        // 批量查询失败或结果中无 downloadUrl，走单个文件接口兜底
        if let Some((dl_url, name, size, sha1)) =
            fetch_single_file_info(project_id, file_id, _cf_api_key.as_str()).await
        {
            // 用单个接口返回的信息覆盖（更准确）
            if !name.is_empty() {
                resolved_name = sanitize_filename(&name);
            }
            if size > 0 {
                resolved_size = size;
            }
            if !sha1.is_empty() {
                resolved_sha1 = sha1;
            }
            if !dl_url.is_empty() {
                resolved_url = Some(dl_url);
            }
        }
    }

    // 关键兜底：resolved_url 仍为空，但有文件名 → 构造 CDN URL
    if resolved_url.as_deref().unwrap_or("").is_empty() && !resolved_name.is_empty() {
        let cdn = construct_cdn_url(file_id, &resolved_name);
        if !cdn.is_empty() {
            eprintln!(
                "[CurseForge] downloadUrl 为空，已构造 CDN URL: {}:{} -> {}",
                project_id, file_id, cdn
            );
            resolved_url = Some(cdn);
        }
    }

    let url = match resolved_url {
        Some(u) if !u.is_empty() => u,
        _ => {
            let err_msg = "CurseForge 未提供下载链接";
            failed_count.fetch_add(1, Ordering::SeqCst);
            check_circuit_breaker(&failed_count, &downloaded_count, total_mods, &abort_flag);
            // 用最新的 resolved_* 重新构造返回（避免文件名仍是占位符）
            return DownloadResult {
                success: false,
                project_id,
                file_id,
                file_name: resolved_name.clone(),
                download_url: None,
                file_length: resolved_size,
                sha1: resolved_sha1.clone(),
                mod_id: None,
                file_info: None,
                error: err_msg.to_string(),
            };
        }
    };

    // 兜底查询拿到了准确信息 → 重新计算 final_name / dest，再做一次存在性校验
    // （原先是基于占位符名算的，可能会误跳过或放到错误路径）
    let final_name = percent_decode_basename(&url)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| sanitize_filename(&resolved_name));
    let dest = mods_dir.join(&final_name);

    let make_result_late = |success: bool, error: &str| DownloadResult {
        success,
        project_id,
        file_id,
        file_name: final_name.clone(),
        download_url: Some(url.clone()),
        file_length: resolved_size,
        sha1: resolved_sha1.clone(),
        mod_id: None,
        file_info: None,
        error: error.to_string(),
    };

    // 基于准确文件名再做一次已存在校验（大小 + SHA1）
    if dest.exists() && cf_shared::is_jar_intact_deep(&dest) {
        let can_skip = if resolved_size > 0 {
            match std::fs::metadata(&dest) {
                Ok(meta) => {
                    if meta.len() as i64 != resolved_size {
                        false
                    } else if !resolved_sha1.is_empty() {
                        match crate::download::single::compute_sha1(&dest).await {
                            Ok(actual) => actual.to_lowercase() == resolved_sha1.to_lowercase(),
                            Err(_) => true,
                        }
                    } else {
                        true
                    }
                }
                Err(_) => false,
            }
        } else {
            true
        };
        if can_skip {
            let mod_id = cf_shared::read_jar_mod_id(&dest);
            let file_info = file_info_map.get(&file_id).map(|fi| FileInfo {
                file_name: final_name.clone(),
                download_url: fi.download_url.clone().unwrap_or_else(|| url.clone()),
                file_length: fi.file_length.unwrap_or(resolved_size),
                sha1: fi
                    .hashes
                    .as_ref()
                    .and_then(|h| h.iter().find(|x| x.algo == 1))
                    .map(|h| h.value.clone())
                    .unwrap_or_else(|| resolved_sha1.clone()),
            });
            downloaded_count.fetch_add(1, Ordering::SeqCst);
            return DownloadResult {
                success: true,
                project_id,
                file_id,
                file_name: final_name,
                download_url: Some(url.clone()),
                file_length: resolved_size,
                sha1: resolved_sha1,
                mod_id,
                file_info,
                error: String::new(),
            };
        } else {
            let _ = std::fs::remove_file(&dest);
        }
    }

    // 将后续闭包/下载逻辑中用到的变量统一替换为 resolved 版本
    // （为了最小化改动，此处用 shadowing 的方式覆盖）
    // resolved_sha1 被 make_result_late 借用，因此 clone 一份给后续校验用
    let expected_sha1 = resolved_sha1.clone();
    let file_size = resolved_size;
    let _make_result_old = make_result; // 屏蔽旧闭包，避免误用
    let make_result = make_result_late;

    // 4. 镜像 URL 列表
    let urls = get_mirror_urls(&url);
    let mut last_err = String::new();

    // 3 轮重试
    for round in 0..MAX_DOWNLOAD_ROUNDS {
        if abort_flag.load(Ordering::SeqCst) {
            break;
        }

        if round > 0 {
            // 延后重试
            tokio::time::sleep(Duration::from_millis(3000 + round as u64 * 2000)).await;
        }

        // 多镜像下载：一次性传入完整镜像列表
        let sha1_opt = if expected_sha1.is_empty() {
            None
        } else {
            Some(expected_sha1.as_str())
        };
        let size_opt = if file_size > 0 {
            Some(file_size as u64)
        } else {
            None
        };

        match crate::download::single::download_file_race(
            &urls,
            &dest,
            sha1_opt,
            size_opt,
            180,
            None,
        )
        .await
        {
            Ok(_) => {
                // 2.14 下载后 SHA1 校验
                if cf_shared::is_jar_intact(&dest) {
                    let sha1_ok = if !expected_sha1.is_empty() {
                        match crate::download::single::compute_sha1(&dest).await {
                            Ok(actual) => {
                                if actual.to_lowercase() == expected_sha1.to_lowercase() {
                                    true
                                } else {
                                    eprintln!(
                                        "[CurseForge] 下载后 SHA1 不匹配，重试: {} (期望={}, 实际={})",
                                        final_name,
                                        &expected_sha1[..8.min(expected_sha1.len())],
                                        &actual[..8.min(actual.len())]
                                    );
                                    let _ = std::fs::remove_file(&dest);
                                    false
                                }
                            }
                            Err(e) => {
                                eprintln!(
                                    "[CurseForge] SHA1 计算失败: {} - {}",
                                    final_name, e
                                );
                                true // SHA1 计算失败不阻塞下载
                            }
                        }
                    } else {
                        true
                    };

                    if sha1_ok {
                        let mod_id = cf_shared::read_jar_mod_id(&dest);
                        let file_info = file_info_map.get(&file_id).map(|fi| FileInfo {
                            file_name: final_name.clone(),
                            download_url: fi.download_url.clone().unwrap_or_default(),
                            file_length: fi.file_length.unwrap_or(0),
                            sha1: fi
                                .hashes
                                .as_ref()
                                .and_then(|h| h.iter().find(|x| x.algo == 1))
                                .map(|h| h.value.clone())
                                .unwrap_or_default(),
                        });
                        downloaded_count.fetch_add(1, Ordering::SeqCst);
                        return DownloadResult {
                            success: true,
                            project_id,
                            file_id,
                            file_name: final_name,
                            download_url: Some(url.clone()),
                            file_length: file_size,
                            sha1: expected_sha1,
                            mod_id,
                            file_info,
                            error: String::new(),
                        };
                    }
                } else {
                    let _ = std::fs::remove_file(&dest);
                }
            }
            Err(e) => {
                eprintln!(
                    "[CurseForge] {} 下载失败 (round {}/3): {}",
                    final_name,
                    round + 1,
                    &e[..100.min(e.len())]
                );
                last_err = e;
                let _ = std::fs::remove_file(&dest);
                let _ = std::fs::remove_file(dest.with_extension("downloading"));
            }
        }
    }

    // 下载失败
    let _ = std::fs::remove_file(dest.with_extension("downloading"));
    failed_count.fetch_add(1, Ordering::SeqCst);

    // 2.15 熔断保护
    check_circuit_breaker(&failed_count, &downloaded_count, total_mods, &abort_flag);

    let err = if abort_flag.load(Ordering::SeqCst) {
        "已取消"
    } else if last_err.is_empty() {
        "下载失败"
    } else {
        &last_err[..120.min(last_err.len())]
    };
    make_result(false, err)
}

/// 熔断保护：仅当失败率超过 40% 且失败数明显大于成功数时才取消
/// 失败数 > max(20, 40% × 总数) 且 failRatio > 0.75 才取消
pub(crate) fn check_circuit_breaker(
    failed_count: &Arc<AtomicUsize>,
    downloaded_count: &Arc<AtomicUsize>,
    total_mods: usize,
    abort_flag: &Arc<AtomicBool>,
) {
    let fail_n = failed_count.load(Ordering::SeqCst);
    let success_n = downloaded_count.load(Ordering::SeqCst);
    let total = fail_n + success_n;
    if total == 0 {
        return;
    }
    let fail_ratio = fail_n as f64 / total as f64;
    let threshold = (total_mods as f64 * 0.4).max(20.0) as usize;
    if fail_n > threshold && fail_ratio > 0.75 {
        eprintln!(
            "[CurseForge] 失败率过高({}/{}/{} = {:.1}%)，取消剩余下载",
            fail_n,
            success_n,
            total,
            fail_ratio * 100.0
        );
        abort_flag.store(true, Ordering::SeqCst);
    }
}

/// 构造 edge.forgecdn.net CDN URL
/// CurseForge 部分文件 API 返回 downloadUrl 为 null，但 CDN 实际可访问
/// URL 格式：https://edge.forgecdn.net/files/{fileID前4位}/{fileID剩余位}/{encodeURIComponent(fileName)}
pub(crate) fn construct_cdn_url(file_id: i64, file_name: &str) -> String {
    let id_str = file_id.to_string();
    if id_str.len() < 5 {
        return String::new();
    }
    let (part1, part2) = id_str.split_at(4);
    let encoded = urlencoding::encode(file_name);
    format!(
        "https://edge.forgecdn.net/files/{}/{}/{}",
        part1, part2, encoded
    )
}

/// 替换为镜像下载地址列表
/// 对齐资源下载的多个 CDN 域名变体 + mod.mcimirror.top 镜像。
/// 原始 CurseForge 下载地址可能为 -service.overwolf.wtf / edge / media / mediafilez 之一，
/// 生成这些变体可以提升不同网络环境下的下载命中率，避免单个 CDN 节点故障导致缺 mod。
pub(crate) fn get_mirror_urls(url: &str) -> Vec<String> {
    // 先规整到统一的 overload 域名再展开变体，避免误替换
    let normalized: String = if url.contains("-service.overwolf.wtf") {
        url.replace("-service.overwolf.wtf", ".forgecdn.net")
    } else if url.contains("edge.forgecdn.net")
        || url.contains("mediafilez.forgecdn.net")
        || url.contains("media.forgecdn.net")
    {
        url.to_string()
    } else {
        return vec![url.to_string()];
    };

    // 基础变体集合：original + edge + mediafilez + media
    let mut candidates = vec![normalized.clone()];
    let edge_url = normalized.replace("://mediafilez.", "://edge.").replace("://media.", "://edge.");
    let mut all: Vec<String> = Vec::new();
    // original 及 edge 变体直接收集
    all.push(normalized.clone());
    all.push(edge_url.clone());
    // mediafilez 变体
    let mediafilez_url = edge_url
        .replace("://edge.", "://mediafilez.")
        .replace("://media.", "://mediafilez.");
    all.push(mediafilez_url);
    // media 变体
    let media_url = edge_url.replace("://edge.", "://media.");
    all.push(media_url);
    // 去重
    for u in all {
        if !candidates.contains(&u) {
            candidates.push(u);
        }
    }

    // 每个变体追加 mod.mcimirror.top 镜像
    let mut urls = Vec::new();
    for c in candidates {
        if !urls.contains(&c) {
            urls.push(c.clone());
        }
        let mirror = c.replace("edge.forgecdn.net", "mod.mcimirror.top")
            .replace("mediafilez.forgecdn.net", "mod.mcimirror.top")
            .replace("media.forgecdn.net", "mod.mcimirror.top");
        if mirror != c && !urls.contains(&mirror) {
            urls.push(mirror);
        }
    }
    urls
}

/// 从 URL 提取 basename 并 percent-decode
pub(crate) fn percent_decode_basename(url: &str) -> Option<String> {
    let path = url.split('?').next().unwrap_or(url);
    let basename = path.rsplit('/').next()?;
    Some(urlencoding::decode(basename).ok()?.to_string())
}

/// 验证文件 SHA1
pub(crate) async fn verify_file_sha1(path: &Path, expected_sha1: &str) -> bool {
    match crate::download::single::compute_sha1(path).await {
        Ok(actual) => actual.to_lowercase() == expected_sha1.to_lowercase(),
        Err(_) => false,
    }
}

/// 过滤文件名中的非法字符
pub(crate) fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect()
}
