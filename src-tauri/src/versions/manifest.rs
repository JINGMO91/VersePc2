// versions/manifest.rs — 远程版本清单与 JSON 抓取
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

use crate::storage;
use crate::utils;


/// 远程版本清单 URL
pub(crate) const MOJANG_MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

pub(crate) const BMCLAPI_MANIFEST_URL: &str = "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json";

/// 拉取远程版本清单（同步阻塞，但通过 spawn_blocking 在 Tauri 异步上下文里调用）
/// 按下载源选择优先顺序：china-first → BMCLAPI 优先；其他 → Mojang 优先
pub(crate) fn fetch_remote_manifest(refresh: bool) -> Option<Value> {
    let settings = storage::load_settings();
    let source = utils::get_str(&settings, "downloadSource");
    let cache_path = storage::resolve_data_dir().join("cache").join("version-manifest.json");

    // 非强制刷新时先读缓存（10 分钟内有效）
    if !refresh && cache_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&cache_path) {
            if let Ok(cached) = serde_json::from_str::<Value>(&content) {
                let timestamp = cached.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0);
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()?
                    .as_millis() as u64;
                // 10 分钟内有效
                if now - timestamp < 600_000 {
                    return cached.get("data").cloned();
                }
            }
        }
    }

    // 决定 URL 顺序
    let urls: Vec<&str> = if source == "china-first" {
        vec![BMCLAPI_MANIFEST_URL, MOJANG_MANIFEST_URL]
    } else if source == "mojang" {
        vec![MOJANG_MANIFEST_URL]
    } else {
        // auto / official-first
        vec![MOJANG_MANIFEST_URL, BMCLAPI_MANIFEST_URL]
    };

    // 多源竞速：同时请求所有源，先成功者胜出，避免慢源阻塞
    let manifest = fetch_json_racing(&urls, Duration::from_secs(6));

    // 写缓存
    if let Some(m) = &manifest {
        let _ = std::fs::create_dir_all(cache_path.parent().unwrap_or(Path::new(".")));
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let cache = json!({ "data": m, "timestamp": now });
        if let Ok(s) = serde_json::to_string_pretty(&cache) {
            let _ = std::fs::write(&cache_path, s);
        }
    }

    manifest
}

/// 阻塞方式拉取 JSON（用 reqwest blocking，避免弹出 cmd 窗口）
pub(crate) fn fetch_json_blocking(url: &str) -> Option<Value> {
    fetch_json_blocking_with_timeout(url, Duration::from_secs(15))
}

/// 阻塞方式拉取 JSON，带指定超时
pub(crate) fn fetch_json_blocking_with_timeout(url: &str, timeout: Duration) -> Option<Value> {
    eprintln!("[versions] fetch_json_blocking: {}", url);
    // 带超时，避免国内访问被墙的官方源时长时间挂起而无法回退到镜像
    let client = match reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[versions] fetch_json_blocking client error: {}", e);
            return None;
        }
    };
    let resp = match client.get(url).send() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[versions] fetch_json_blocking reqwest error: {}", e);
            return None;
        }
    };
    let body = match resp.text() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[versions] fetch_json_blocking text error: {}", e);
            return None;
        }
    };
    eprintln!("[versions] fetch_json_blocking OK, body len={}", body.len());
    let json = serde_json::from_str(&body).ok();
    if json.is_none() {
        eprintln!("[versions] fetch_json_blocking JSON parse failed");
    }
    json
}

/// 多源竞速：并发请求多个 URL，返回第一个成功解析为 JSON 的结果。
/// 同时请求多个源，先成功者胜出，失败/慢源不阻塞整体。
/// 每个源有独立的超时，避免慢源或不可达源长时间挂起。
pub(crate) fn fetch_json_racing(urls: &[&str], per_url_timeout: Duration) -> Option<Value> {
    if urls.is_empty() {
        return None;
    }
    let (tx, rx) = std::sync::mpsc::channel::<Option<Value>>();
    for url in urls {
        let url = url.to_string();
        let tx = tx.clone();
        std::thread::spawn(move || {
            let result = fetch_json_blocking_with_timeout(&url, per_url_timeout);
            let _ = tx.send(result);
        });
    }
    drop(tx);
    // rx.iter() 在所有发送端关闭后结束；返回第一个成功结果，其余线程各自超时收尾
    for received in rx.iter() {
        if let Some(v) = received {
            return Some(v);
        }
    }
    None
}
