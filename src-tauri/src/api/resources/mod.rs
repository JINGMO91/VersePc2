// api/resources/mod.rs — 资源搜索/下载路由
// 职责：Modrinth 资源（模组/整合包/资源包/光影/数据包）搜索、详情、版本列表、下载
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::api::ApiResult;

mod detail;
mod download;
mod image;
mod search;

pub(crate) use detail::*;
pub(crate) use download::*;
pub(crate) use image::*;
pub(crate) use search::*;

/// Modrinth API 官方地址
pub(crate) const MODRINTH_API: &str = "https://api.modrinth.com/v2";

/// Modrinth API 镜像地址（国内访问更快）
pub(crate) const MODRINTH_API_MIRROR: &str = "https://mod.mcimirror.top/modrinth/v2";

/// CurseForge API 官方地址
pub(crate) const CURSEFORGE_API: &str = "https://api.curseforge.com/v1";

/// CurseForge API 镜像地址
pub(crate) const CURSEFORGE_API_MIRROR: &str = "https://mod.mcimirror.top/curseforge/v1";

/// CurseForge 默认 API Key
pub(crate) const DEFAULT_CF_API_KEY: &str = "$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm";

/// 全局复用 reqwest::Client，避免每次请求都做 TLS 握手
/// 连接池保持，keep-alive 复用 TCP 连接
pub(crate) fn shared_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent("VersePC/2.0")
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(8)
            .tcp_keepalive(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// API 响应缓存项
pub(crate) struct CacheEntry {
    data: Value,
    ts: Instant,
}

/// 全局 API 缓存（URL → CacheEntry）
/// 60 秒 TTL 机制
pub(crate) fn api_cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 读取缓存；命中且在 TTL 内返回数据
pub(crate) async fn cache_get(url: &str, ttl_ms: u64) -> Option<Value> {
    let cache = api_cache().lock().await;
    if let Some(entry) = cache.get(url)
        && entry.ts.elapsed().as_millis() < ttl_ms as u128 {
            return Some(entry.data.clone());
        }
    None
}

/// 写入缓存；超过 2000 项时清理过期项
pub(crate) async fn cache_set(url: String, data: Value, ttl_ms: u64) {
    let mut cache = api_cache().lock().await;
    cache.insert(url, CacheEntry { data, ts: Instant::now() });
    if cache.len() > 2000 {
        let now = Instant::now();
        cache.retain(|_, v| now.duration_since(v.ts).as_millis() < (ttl_ms * 2) as u128);
    }
}

/// 带镜像回退的 JSON 请求，多步策略：
///   镜像 8s → 官方 10s → 官方完整超时(20s)；不走镜像时官方 10s → 官方完整超时。
/// 关键点：
///   - 镜像连续失败后走熔断（_isMirrorAvailable），熔断期间只用官方，避免拖慢列表
///   - 官方 API（尤其 CurseForge）国内访问较慢，需给足 20s 完整超时
///   - 镜像的 403/404 不阻断，继续尝试官方；官方 403/404 才直接失败
pub(crate) async fn fetch_json_with_mirror(url: &str, headers: Option<&reqwest::header::HeaderMap>) -> Result<Value, String> {
    let client = shared_client();
    use crate::download::mirror;
    let mirror_url = if url.starts_with(MODRINTH_API) {
        Some(url.replace(MODRINTH_API, MODRINTH_API_MIRROR))
    } else if url.starts_with(CURSEFORGE_API) {
        Some(url.replace(CURSEFORGE_API, CURSEFORGE_API_MIRROR))
    } else {
        None
    };

    let use_mirror = mirror_url.is_some() && mirror::is_mirror_available();
    let steps: Vec<(&str, u64, bool)> = if use_mirror {
        let murl = mirror_url.as_deref().unwrap_or("");
        vec![
            (murl, 8000, true),
            (url, 10000, false),
            (url, 20000, false),
        ]
    } else {
        vec![
            (url, 10000, false),
            (url, 20000, false),
        ]
    };

    let mut last_err = String::new();
    for (step_url, timeout_ms, is_mirror) in steps {
        let mut req = client.get(step_url).timeout(Duration::from_millis(timeout_ms));
        if let Some(h) = headers {
            req = req.headers(h.clone());
        }
        match req.send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    if is_mirror {
                        mirror::mirror_success();
                    }
                    match resp.json::<Value>().await {
                        Ok(v) => return Ok(v),
                        Err(e) => last_err = format!("JSON解析失败: {}", e),
                    }
                } else {
                    last_err = format!("HTTP {}", status);
                    // 镜像的 403/404 不阻断，继续尝试官方；官方 403/404 才直接失败
                    if (status == 403 || status == 404) && !is_mirror {
                        return Err(last_err);
                    }
                    if is_mirror {
                        mirror::mirror_failed();
                    }
                }
            }
            Err(e) => {
                last_err = format!("{}", e);
                if is_mirror {
                    mirror::mirror_failed();
                }
            }
        }
    }
    Err(last_err)
}

/// 带缓存的 JSON 请求：命中缓存直接返回，否则 fetch 后写缓存
pub(crate) async fn cached_fetch_json(url: String, ttl_ms: u64, headers: Option<&reqwest::header::HeaderMap>) -> Result<Value, String> {
    if let Some(cached) = cache_get(&url, ttl_ms).await {
        return Ok(cached);
    }
    let data = fetch_json_with_mirror(&url, headers).await?;
    cache_set(url, data.clone(), ttl_ms).await;
    Ok(data)
}

/// 处理资源路由
pub async fn handle(
    app: &AppHandle,
    method: &str,
    path: &str,
    params: &Option<Value>,
    body: &Option<Value>,
) -> Option<ApiResult> {
    let key = format!("{} {}", method.to_uppercase(), path);

    match key.as_str() {
        "GET /api/resources/search" => Some(handle_search(params).await),
        "GET /api/resources/detail" => Some(handle_detail(params).await),
        "GET /api/resources/versions" => Some(handle_versions(params).await),
        "POST /api/resources/download" => Some(handle_download(app, body).await),
        "GET /api/resources/download-status" => Some(handle_download_status(params)),
        "POST /api/resources/download-cancel" => Some(handle_download_cancel(body)),
        "GET /api/resource-image" => Some(handle_resource_image(params).await),
        _ => None,
    }
}
