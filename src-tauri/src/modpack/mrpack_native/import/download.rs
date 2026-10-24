// download.rs — 由 import.rs 拆分
#![allow(unused_imports)]

// 镜像回退、单文件下载、熔断与 SHA1 校验
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
use super::*;

/// 构造镜像 URL 列表（mod.mcimirror.top 镜像优先，官方源兜底）
/// cdn.modrinth.com / cdn-alt.modrinth.com → mod.mcimirror.top
/// 镜像在前，官方在后。
/// 官方 CDN 在国内 TTFB 极慢且对高并发 IP 限流，镜像优先可避免每 mod 都卡在官方源上。
pub(crate) fn get_mirror_urls(url: &str) -> Vec<String> {
    let mut urls = Vec::new();

    if url.contains("cdn.modrinth.com") {
        let mirror = url.replace("cdn.modrinth.com", "mod.mcimirror.top");
        if mirror != url {
            urls.push(mirror);
        }
    } else if url.contains("cdn-alt.modrinth.com") {
        let mirror = url.replace("cdn-alt.modrinth.com", "mod.mcimirror.top");
        if mirror != url {
            urls.push(mirror);
        }
    }

    // 官方源兜底（放最后）
    urls.push(url.to_string());
    urls
}

#[derive(Debug, Clone, Default)]
pub(crate) struct DownloadResult {
    pub(crate) success: bool,
    pub(crate) file_name: String,
    pub(crate) error: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ModStatus {
    Pending,
    #[allow(dead_code)]
    Downloading,
    #[allow(dead_code)]
    Completed,
    #[allow(dead_code)]
    Failed,
}

/// 下载单个模组文件
///
/// 流程：
/// 1. 已存在则校验大小+isJarIntact+SHA1，通过则跳过
/// 2. 构造镜像 URL 列表（原 downloads + mcimirror 镜像）
/// 3. 3 轮重试下载
/// 4. 下载后 isJarIntact + SHA1 校验
/// 5. 熔断保护：失败数 > max(5, 10% × 总数) 且 failCount > okCount 才取消
#[allow(clippy::too_many_arguments)]
pub(crate) async fn download_one_mod(
    file_name: &str,
    dest_path: &Path,
    downloads: Vec<String>,
    expected_sha1: String,
    file_size: i64,
    _version_dir: &Path,
    abort_flag: &Arc<AtomicBool>,
    downloaded_count: &Arc<AtomicUsize>,
    failed_count: &Arc<AtomicUsize>,
    total_mods: usize,
    idx: usize,
    progress_tx: tokio::sync::mpsc::UnboundedSender<(usize, &'static str, u32)>,
) -> DownloadResult {
    let make_result = |success: bool, error: &str| DownloadResult {
        success,
        file_name: file_name.to_string(),
        error: error.to_string(),
    };

    // 按文件大小计算单个模组下载超时（秒）：越大给越久，避免大文件在慢速/并发下超时丢失
    fn mod_download_timeout(size_bytes: i64) -> u64 {
        if size_bytes > 50 * 1024 * 1024 {
            600
        } else if size_bytes > 20 * 1024 * 1024 {
            300
        } else if size_bytes > 5 * 1024 * 1024 {
            180
        } else {
            120
        }
    }

    if downloads.is_empty() {
        eprintln!("[mrpack] 模组无下载链接，跳过: {}", file_name);
        failed_count.fetch_add(1, Ordering::SeqCst);
        check_circuit_breaker(failed_count, downloaded_count, total_mods, abort_flag);
        return make_result(false, "无可用下载链接");
    }

    // 确保目标目录存在
    if let Some(parent) = dest_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // 已存在校验：大小 + isJarIntact + SHA1
    if file_size > 0 && dest_path.exists() {
        let can_skip = match std::fs::metadata(dest_path) {
            Ok(stat) => {
                if stat.len() as i64 == file_size && cf_shared::is_jar_intact(dest_path) {
                    // 进一步用 SHA1 校验
                    if !expected_sha1.is_empty() {
                        match crate::download::single::compute_sha1(dest_path).await {
                            Ok(actual) => {
                                actual.to_lowercase() == expected_sha1.to_lowercase()
                            }
                            Err(_) => false,
                        }
                    } else {
                        true
                    }
                } else {
                    false
                }
            }
            Err(_) => false,
        };

        if can_skip {
            downloaded_count.fetch_add(1, Ordering::SeqCst);
            return make_result(true, "");
        }
    }

    // 构造所有镜像 URL（原 downloads + mcimirror 镜像）
    let mut all_urls: Vec<String> = Vec::new();
    for dl in &downloads {
        for mu in get_mirror_urls(dl) {
            if !all_urls.contains(&mu) {
                all_urls.push(mu);
            }
        }
    }

    let mut last_err = String::new();

    // 3 轮重试
    for round in 0..MAX_DOWNLOAD_ROUNDS {
        if abort_flag.load(Ordering::SeqCst) {
            break;
        }

        if round > 0 {
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

        // 逐文件下载进度上报：每个文件下载时，把当前百分比推给主循环，
        // 主循环据此实时广播文件快照（详情里每个模组的进度条才会动）
        let progress_tx_clone = progress_tx.clone();
        let on_progress: Option<crate::download::ProgressCb> = Some(Arc::new(
            move |p: &crate::download::DownloadProgress| {
                let pct = if p.total_bytes > 0 {
                    ((p.bytes_downloaded as f64 / p.total_bytes as f64) * 100.0) as u32
                } else {
                    0
                };
                let _ = progress_tx_clone.send((idx, "downloading", pct));
            },
        ));

        match crate::download::single::download_file_race(
            &all_urls,
            dest_path,
            sha1_opt,
            size_opt,
            mod_download_timeout(file_size),
            on_progress,
        )
        .await
        {
            Ok(_) => {
                // 下载后校验
                if cf_shared::is_jar_intact(dest_path) {
                    let sha1_ok = if !expected_sha1.is_empty() {
                        match crate::download::single::compute_sha1(dest_path).await {
                            Ok(actual) => {
                                if actual.to_lowercase() == expected_sha1.to_lowercase() {
                                    true
                                } else {
                                    eprintln!(
                                        "[mrpack] SHA1校验失败: {} (期望={}, 实际={})",
                                        file_name,
                                        &expected_sha1[..8.min(expected_sha1.len())],
                                        &actual[..8.min(actual.len())]
                                    );
                                    let _ = std::fs::remove_file(dest_path);
                                    false
                                }
                            }
                            Err(e) => {
                                eprintln!("[mrpack] SHA1计算失败: {} - {}", file_name, e);
                                true // SHA1 计算失败不阻塞下载
                            }
                        }
                    } else {
                        true
                    };

                    if sha1_ok {
                        downloaded_count.fetch_add(1, Ordering::SeqCst);
                        let _ = progress_tx.send((idx, "completed", 100));
                        return make_result(true, "");
                    }
                } else {
                    let _ = std::fs::remove_file(dest_path);
                }
            }
            Err(e) => {
                eprintln!(
                    "[mrpack] {} 下载失败 (round {}/3): {}",
                    file_name,
                    round + 1,
                    &e[..100.min(e.len())]
                );
                last_err = e;
                let _ = std::fs::remove_file(dest_path);
                let _ = std::fs::remove_file(dest_path.with_extension("downloading"));
            }
        }
    }

    // 清理 .downloading 残留
    let _ = std::fs::remove_file(dest_path.with_extension("downloading"));

    failed_count.fetch_add(1, Ordering::SeqCst);

    // 熔断保护
    check_circuit_breaker(failed_count, downloaded_count, total_mods, abort_flag);

    let err = if abort_flag.load(Ordering::SeqCst) {
        "已取消"
    } else if last_err.is_empty() {
        "下载失败"
    } else {
        &last_err[..120.min(last_err.len())]
    };
    let _ = progress_tx.send((idx, "failed", 100));
    make_result(false, err)
}

/// 熔断保护：失败数超过一定比例且失败占比过高时才取消剩余下载
/// 失败数需 > max(20, 10% × 总数×4) 且 失败占比 > 0.75 才取消，避免少量失败导致大量文件缺失
pub(crate) fn check_circuit_breaker(
    failed_count: &Arc<AtomicUsize>,
    downloaded_count: &Arc<AtomicUsize>,
    total_mods: usize,
    abort_flag: &Arc<AtomicBool>,
) {
    let fail_n = failed_count.load(Ordering::SeqCst);
    let ok_n = downloaded_count.load(Ordering::SeqCst);
    let total_attempts = fail_n + ok_n;
    let fail_ratio = if total_attempts > 0 {
        fail_n as f64 / total_attempts as f64
    } else {
        0.0
    };
    let threshold = std::cmp::max(20usize, (total_mods as f64 * 0.4) as usize);
    if fail_n > threshold && fail_ratio > 0.75 {
        eprintln!(
            "[mrpack] 失败数({})超过阈值({})且失败占比({:.2}%)，取消剩余下载",
            fail_n,
            threshold,
            fail_ratio * 100.0
        );
        abort_flag.store(true, Ordering::SeqCst);
    }
}

/// 验证文件 SHA1
pub(crate) async fn verify_file_sha1(path: &Path, expected_sha1: &str) -> bool {
    match crate::download::single::compute_sha1(path).await {
        Ok(actual) => actual.to_lowercase() == expected_sha1.to_lowercase(),
        Err(_) => false,
    }
}
