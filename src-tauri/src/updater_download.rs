// updater_download.rs — 更新包下载、镜像回退与流式校验
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

use super::{build_download_sources, emit, hex_lower, log_download};

fn verify_file_blocking(path: &Path, expected_size: u64, expected_sha: Option<&str>) -> bool {
    use std::io::Read;
    if !path.exists() {
        return false;
    }
    if let Ok(md) = fs::metadata(path)
        && expected_size > 0 && md.len() != expected_size {
            return false;
        }
    if let Some(sha) = expected_sha {
        let Ok(mut f) = fs::File::open(path) else {
            return false;
        };
        let mut hasher = Sha256::new();
        // 1 MB 缓冲：减少 8 KB 小块读取带来的系统调用与磁盘寻道开销
        let mut buf = vec![0u8; 1024 * 1024];
        loop {
            match f.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => hasher.update(&buf[..n]),
                Err(_) => return false,
            }
        }
        if !hex_lower(&hasher.finalize()).eq_ignore_ascii_case(sha) {
            return false;
        }
    }
    true
}

/// 异步校验：把整文件哈希放到阻塞线程池，避免卡住 Tauri 异步运行时与 IPC
async fn verify_file(path: &Path, expected_size: u64, expected_sha: Option<&str>) -> bool {
    let path = path.to_path_buf();
    let sha = expected_sha.map(|s| s.to_string());
    tokio::task::spawn_blocking(move || verify_file_blocking(&path, expected_size, sha.as_deref()))
        .await
        .unwrap_or(false)
}

/// 清理更新目录里超过保留期的旧安装包/断点文件，避免长期占用磁盘。
/// 当前下载目标及其断点文件始终保留。
pub(super) fn clean_stale_updates(dir: &Path, keep_target: &Path) {
    const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
    let keep_part = keep_target.with_extension("part");
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() || path == keep_target || path == keep_part {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|age| age > MAX_AGE)
            .unwrap_or(false);
        if stale && fs::remove_file(&path).is_ok() {
            log_download(&format!("[clean] 已清理过期更新缓存 {}", path.display()));
        }
    }
}

// ============== 下载更新 ==============

/// 单次流式下载的结果：是否从 0 开始（可用流式哈希直接校验）与本轮数据哈希
struct StreamOutcome {
    fresh: bool,
    hash: String,
}

async fn stream_download(
    client: &Client,
    app: &AppHandle,
    url: &str,
    target: &Path,
    expected_size: u64,
) -> Result<StreamOutcome, String> {
    let tmp = target.with_extension("part");
    let mut resume = 0u64;
    if let Ok(md) = fs::metadata(&tmp) {
        resume = md.len();
    }
    if expected_size > 0 && resume >= expected_size {
        return Ok(StreamOutcome { fresh: false, hash: String::new() });
    }
    log_download(&format!(
        "[stream] 开始下载 {} resume={}B expected={}B",
        url, resume, expected_size
    ));

    let mut req = client.get(url);
    if resume > 0 {
        req = req.header("Range", format!("bytes={}-", resume));
    }
    let resp = tokio::time::timeout(Duration::from_secs(20), req.send())
        .await
        .map_err(|_| "TTFB 超时：服务器响应头迟迟未返回，切换镜像".to_string())?
        .map_err(|e| format!("连接失败: {}", e))?;
    let status_206 = resp.status().as_u16() == 206;
    if !resp.status().is_success() && !status_206 {
        return Err(format!("HTTP {}", resp.status()));
    }
    if resume > 0 && !status_206 {
        // 该源不支持 Range（返回 200 全量）：保留 .part 断点给下一个支持 Range 的镜像续传，
        // 并返回特殊错误让 fallback 直接切换镜像（同源重试无意义，只会再次全量重下导致进度回跳）
        log_download(&format!(
            "[stream] 服务器不支持 Range(HTTP {})，保留断点，切换镜像续传",
            resp.status().as_u16()
        ));
        return Err("NO_RANGE_SOURCE: 服务器不支持断点续传，切换镜像".to_string());
    }

    let total = if status_206 {
        resp.headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split('/').nth(1))
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
    } else {
        resp.content_length().unwrap_or(0)
    };
    let total = if total > 0 { total } else { expected_size };

    // 断点续传提示：拿到 total 后再发，与下载中的 percent 用同一基准，避免基准不同导致百分比跳动
    if resume > 0 {
        let pct = if total > 0 {
            ((resume as f64 / total as f64) * 100.0 * 10.0).round() / 10.0
        } else {
            0.0
        };
        log_download(&format!("[stream] 断点续传 resume={}B total={}B ({:.1}%)", resume, total, pct));
        emit(app, "download-progress", &json!({
            "percent": pct,
            "transferred": resume,
            "total": total.max(resume),
            "bytesPerSecond": 0,
            "resuming": true,
        }));
    } else {
        log_download(&format!("[stream] 全新下载 total={}B (content-length)", total));
    }

    let mut f = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&tmp)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut stream = resp.bytes_stream();
    let mut hasher = Sha256::new();
    let mut transferred = resume;
    let mut last_report = Instant::now();
    let mut last_bytes = resume;
    let mut last_log_pct = -1.0;
    // 距上次收到数据的时刻；仅当超过 IDLE_TIMEOUT 仍无任何字节时才判源失效，
    // 避免把 Gitee 高峰期"慢但仍在传"的连接误杀。
    let idle_timeout = Duration::from_secs(60);

    loop {
        let waited = tokio::time::timeout(idle_timeout, stream.next()).await;
        let chunk = match waited {
            Ok(Some(r)) => r.map_err(|e| format!("下载中断: {}", e))?,
            Ok(None) => break,
            Err(_) => {
                // 60 秒整未收到任何数据块：判定该源暂时失效（切换/续传）
                log_download(&format!("[stream] 60s 无数据，切换镜像 (transferred={}B)", transferred));
                return Err("下载长时间无数据，切换镜像".to_string());
            }
        };
        transferred += chunk.len() as u64;
        hasher.update(&chunk);
        f.write_all(&chunk).await.map_err(|e| format!("写入失败: {}", e))?;

        if last_report.elapsed().as_millis() >= 500 {
            let elapsed = last_report.elapsed().as_secs_f64().max(0.001);
            let pct = if total > 0 {
                (transferred as f64 / total as f64) * 100.0
            } else {
                0.0
            };
            emit(app, "download-progress", &json!({
                "percent": (pct * 10.0).round() / 10.0,
                "transferred": transferred,
                "total": total.max(transferred),
                "bytesPerSecond": ((transferred - last_bytes) as f64 / elapsed) as u64,
            }));
            // 诊断日志：按约 5% 采样记录，避免刷屏与频繁写盘
            if pct - last_log_pct >= 5.0 || transferred >= total {
                log_download(&format!(
                    "[progress] {:.1}% transferred={}B total={}B",
                    pct, transferred, total
                ));
                last_log_pct = pct;
            }
            last_report = Instant::now();
            last_bytes = transferred;
        }
    }

    f.flush().await.map_err(|e| e.to_string())?;
    drop(f);

    let final_size = fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
    log_download(&format!(
        "[stream] 流结束 final={}B expected={}B 完整={}",
        final_size,
        expected_size,
        final_size == expected_size
    ));
    if total > 0 {
        emit(app, "download-progress", &json!({
            "percent": 100.0,
            "transferred": total,
            "total": total,
            "bytesPerSecond": 0
        }));
    }
    Ok(StreamOutcome {
        fresh: resume == 0,
        hash: hex_lower(&hasher.finalize()),
    })
}

/// 连接建立/TTFB 阶段失败：源当前基本不通（被墙/宕机/节点失效），多耗重试只会拖慢换源；
/// 与"传输中途断流"（源能出数据，只是链路抖动，值得续传重试）区分开。
fn is_dead_source_error(e: &str) -> bool {
    e.contains("TTFB 超时") || e.contains("连接失败")
}

/// 全新下载的流式校验：尺寸一致且流式 SHA-256 与期望值匹配。
/// 断点续传或缺少期望哈希时返回 false，由调用方回退到整文件异步校验。
fn fresh_download_verified(
    part: &Path,
    expected_size: u64,
    expected_sha: Option<&str>,
    outcome: &StreamOutcome,
) -> bool {
    if !outcome.fresh {
        return false;
    }
    let Some(sha) = expected_sha else {
        return false;
    };
    let size_ok =
        expected_size == 0 || fs::metadata(part).map(|m| m.len()).unwrap_or(0) == expected_size;
    size_ok && outcome.hash.eq_ignore_ascii_case(sha)
}

pub(super) async fn download_with_fallback(
    app: &AppHandle,
    url: &str,
    target: &Path,
    expected_size: u64,
    expected_sha: Option<&str>,
) -> Result<(), String> {
    if verify_file(target, expected_size, expected_sha).await {
        if expected_size > 0 {
            emit(app, "download-progress", &json!({
                "percent": 100.0,
                "transferred": expected_size,
                "total": expected_size,
                "bytesPerSecond": 0
            }));
        }
        return Ok(());
    }
    let _ = fs::remove_file(target);
    let part = target.with_extension("part");

    // 复用同一个 HTTP 客户端：重试/换源时共享连接池，避免每次尝试重新 TLS 握手。
    // 注意：不能用 30 秒“总请求超时”，否则 74 MB 大包在慢速镜像上必被中途切断，
    // 触发大量续传重试；这里只限制连接建立，传输停滞由下方 60 秒无数据检测负责。
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(1800))
        .user_agent("VersePC")
        .build()
        .map_err(|e| format!("初始化下载客户端失败: {}", e))?;

    // 基准源波动多是瞬时性的（Gitee 高峰期偶发丢包），直接换源会丢掉续传进度且可能更慢。
    // 因此：同一源最多重试 MAX_RETRY_PER_SOURCE 次，每次都沿用 .part 断点续传；
    // 连接/TTFB 失败（源基本不通）只重试 MAX_RETRY_DEAD_SOURCE 次，快速换下一源；
    // 所有源第一轮仍全部失败时，断点已保留，再完整扫描一轮（断点续传继续），仍失败才放弃。
    const MAX_RETRY_PER_SOURCE: u32 = 3;
    const MAX_RETRY_DEAD_SOURCE: u32 = 1;

    let sources = build_download_sources(url);
    let mut last_err = String::new();
    for pass in 0..2 {
        if pass > 0 {
            log_download("[fallback] 所有下载源第一轮均失败，断点已保留，开始第二轮扫描");
        }
        for murl in &sources {
            log_download(&format!("[fallback] 尝试下载源: {}", murl));
            for attempt in 0..=MAX_RETRY_PER_SOURCE {
                if attempt > 0 {
                    // 短暂让出，给网络/服务器一点恢复时间，再以断点续传重试同一源
                    tokio::time::sleep(Duration::from_millis(600)).await;
                }
                log_download(&format!("[fallback]  源内第 {} 次尝试", attempt + 1));
                match stream_download(&client, app, murl, target, expected_size).await {
                    Ok(outcome) => {
                        // 从 0 开始的下载已在流式过程中算完哈希，无需再整文件读盘；
                        // 断点续传只覆盖了部分字节，仍需完整校验。
                        let verified = if outcome.fresh && expected_sha.is_some() {
                            fresh_download_verified(&part, expected_size, expected_sha, &outcome)
                        } else {
                            verify_file(&part, expected_size, expected_sha).await
                        };
                        if verified {
                            log_download(&format!("[fallback] 校验通过 size={}B，下载完成", expected_size));
                            let _ = fs::remove_file(target);
                            fs::rename(&part, target)
                                .map_err(|e| format!("下载完成但保存失败: {}", e))?;
                            return Ok(());
                        }
                        // 校验失败：区分"被截断"（保留断点续传）与"数据损坏"（清空重下）
                        let part_size = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
                        if expected_size > 0 && part_size == expected_size {
                            log_download(&format!(
                                "[fallback] 文件完整但校验不符 size={}B (可能是损坏)，清空断点从下一镜像重下",
                                part_size
                            ));
                            let _ = fs::remove_file(&part);
                        } else {
                            log_download(&format!(
                                "[fallback] 文件不完整 size={}B != expected={}B，保留断点，下一镜像续传",
                                part_size, expected_size
                            ));
                        }
                        last_err = "文件校验失败，已从下一镜像重试".to_string();
                        let _ = fs::remove_file(target);
                        break;
                    }
                    Err(e) => {
                        // 该源临时失败：保留 .part，稍后沿用续传继续尝试同一源
                        last_err = e;
                        log_download(&format!("[fallback] 源失败: {}", last_err));
                        // 源不支持 Range 时同源重试无意义（每次都全量重下导致进度回跳），
                        // 直接切换下一镜像，断点留给支持 Range 的镜像续传
                        if last_err.starts_with("NO_RANGE_SOURCE:") {
                            last_err = "下载源均不支持断点续传，下载中断，请稍后重试".to_string();
                            break;
                        }
                        // 死源快速换源：连接/TTFB 失败仅重试 2 次即换下一源；断流类失败（源能出数据）仍按原次数重试
                        if is_dead_source_error(&last_err) && attempt >= MAX_RETRY_DEAD_SOURCE {
                            break;
                        }
                    }
                }
            }
        }
    }
    if last_err.is_empty() {
        Err("所有下载源均失败，请稍后重试或手动下载".into())
    } else {
        Err(last_err)
    }
}

// ============== 测试 ==============

#[cfg(test)]
mod tests {
    use super::{clean_stale_updates, fresh_download_verified, hex_lower, verify_file_blocking, StreamOutcome};
    use sha2::{Digest, Sha256};
    use std::time::{Duration, SystemTime};

    fn sha_of(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hex_lower(&hasher.finalize())
    }

    #[test]
    fn verify_file_blocking_accepts_matching_hash_and_rejects_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pkg.exe");
        let data: Vec<u8> = (0..(3 * 1024 * 1024)).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &data).unwrap();
        let sha = sha_of(&data);

        assert!(verify_file_blocking(&path, data.len() as u64, Some(&sha)));
        assert!(!verify_file_blocking(&path, data.len() as u64 + 1, Some(&sha)));

        let mut broken = data.clone();
        broken[1024] ^= 0xFF;
        std::fs::write(&path, &broken).unwrap();
        assert!(!verify_file_blocking(&path, broken.len() as u64, Some(&sha)));
    }

    #[test]
    fn fresh_download_verification_uses_stream_hash() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("pkg.exe.part");
        let data = vec![1u8, 2, 3, 4];
        std::fs::write(&part, &data).unwrap();
        let sha = sha_of(&data);

        let fresh_ok = StreamOutcome { fresh: true, hash: sha.clone() };
        assert!(fresh_download_verified(&part, 4, Some(&sha), &fresh_ok));
        assert!(!fresh_download_verified(&part, 5, Some(&sha), &fresh_ok));

        let wrong_hash = StreamOutcome { fresh: true, hash: "00".repeat(32) };
        assert!(!fresh_download_verified(&part, 4, Some(&sha), &wrong_hash));

        let resumed = StreamOutcome { fresh: false, hash: sha.clone() };
        assert!(!fresh_download_verified(&part, 4, Some(&sha), &resumed));
    }

    #[test]
    fn clean_stale_updates_keeps_current_and_removes_expired_files() {
        let dir = tempfile::tempdir().unwrap();
        let keep = dir.path().join("VersePC2-9.9.9.exe");
        let keep_part = dir.path().join("VersePC2-9.9.9.part");
        let fresh = dir.path().join("fresh.exe");
        let expired = dir.path().join("old-1.0.0.exe");
        for p in [&keep, &keep_part, &fresh, &expired] {
            std::fs::write(p, b"x").unwrap();
        }
        let old = SystemTime::now() - Duration::from_secs(8 * 24 * 3600);
        let f = std::fs::OpenOptions::new().write(true).open(&expired).unwrap();
        f.set_modified(old).unwrap();

        clean_stale_updates(dir.path(), &keep);

        assert!(keep.exists());
        assert!(keep_part.exists());
        assert!(fresh.exists());
        assert!(!expired.exists());
    }
}
