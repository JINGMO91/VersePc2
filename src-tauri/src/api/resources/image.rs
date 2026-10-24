// api/resources/image.rs — 资源图片代理
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha1::Digest;
use tauri::{AppHandle, Listener};
use tokio::sync::Mutex;

use crate::api::ApiResult;
use crate::download::{download_with_mirror, download_with_mirror_cancellable, resources_session};
use crate::modpack;
use crate::resource::{matcher, mcversion, wiki};
use crate::resource::matcher::SearchSource;
use crate::storage;

use super::{MODRINTH_API, MODRINTH_API_MIRROR, CURSEFORGE_API, CURSEFORGE_API_MIRROR, DEFAULT_CF_API_KEY, shared_client, cached_fetch_json, fetch_json_with_mirror};
use super::detail::to_modrinth_cdn_mirror;

/// 从图片 URL 中推断扩展名与 MIME（默认 png）
pub(crate) fn image_ext_and_mime(url: &str) -> (&'static str, &'static str) {
    let lower = url.to_lowercase();
    let without_query = lower.split(['?', '#']).next().unwrap_or("").to_string();
    let ext = without_query
        .rsplit('.')
        .next()
        .unwrap_or("")
        .trim_end_matches('/');
    match ext {
        "webp" => ("webp", "image/webp"),
        "jpg" | "jpeg" => ("jpg", "image/jpeg"),
        "gif" => ("gif", "image/gif"),
        "avif" => ("avif", "image/avif"),
        "svg" => ("svg", "image/svg+xml"),
        "ico" => ("ico", "image/x-icon"),
        "bmp" => ("bmp", "image/bmp"),
        _ => ("png", "image/png"),
    }
}

/// GET /api/resource-image — 下载并缓存图片，返回本地 base64 data URL
pub(crate) async fn handle_resource_image(params: &Option<Value>) -> ApiResult {
    let url = params
        .as_ref()
        .and_then(|p| p.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if url.is_empty() {
        return ApiResult::err(400, "Missing url");
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return ApiResult::err(400, "Invalid url");
    }

    let mut hasher = sha1::Sha1::new();
    hasher.update(url.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let (ext, mime) = image_ext_and_mime(url);

    let cache_dir = storage::resolve_data_dir().join("image-cache");
    let cache_path = cache_dir.join(format!("{}.{}", hash, ext));

    if cache_path.exists() {
        if let Ok(data) = std::fs::read(&cache_path) {
            return ApiResult::ok(json!({ "dataUrl": crate::utils::bytes_to_data_url(&data, mime) }));
        }
    }

    let client = shared_client();
    let resp = match client.get(url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return ApiResult::err(502, &format!("HTTP {}", r.status())),
        Err(e) => return ApiResult::err(502, &format!("请求失败: {}", e)),
    };
    let bytes = match resp.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return ApiResult::err(502, &format!("读取失败: {}", e)),
    };
    if bytes.is_empty() {
        return ApiResult::err(502, "空响应");
    }

    if std::fs::create_dir_all(&cache_dir).is_ok() {
        let _ = std::fs::write(&cache_path, &bytes);
    }

    ApiResult::ok(json!({ "dataUrl": crate::utils::bytes_to_data_url(&bytes, mime) }))
}
