// 皮肤 API 公共工具：操作日志、PNG 校验与响应、Base64 解码、远程拉取。
use serde_json::json;
use std::time::Duration;

use crate::api::ApiResult;
use crate::storage;
use crate::utils;

/// PNG 文件魔数（前 4 字节）
const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4E, 0x47];

// ============== 皮肤操作日志 ==============
// 追加写入 DATA_DIR/skin.log，记录上传/切换皮肤的关键操作，便于排查
pub(super) fn write_skin_log(msg: &str) {
    let dir = storage::resolve_data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let ts = utils::now_iso();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("skin.log"))
    {
        let _ = std::io::Write::write_all(&mut f, format!("[{}] {}\n", ts, msg).as_bytes());
    }
    println!("[skin] {}", msg);
}

/// 校验字节是否为 PNG（前 4 字节魔数）
pub(super) fn is_png(bytes: &[u8]) -> bool {
    bytes.len() > 8 && bytes.starts_with(PNG_MAGIC)
}

/// 远程拉取字节（带超时）
pub(super) async fn fetch_remote_bytes(url: &str) -> Option<Vec<u8>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("VersePC-Tauri/1.0")
        .build()
        .ok()?;

    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.bytes().await.ok().map(|b| b.to_vec())
}

/// base64 解码
pub(super) fn base64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::{engine::general_purpose, Engine as _};
    // 容忍 data URL 前缀
    let payload = if let Some(idx) = s.find("base64,") {
        &s[idx + 7..]
    } else {
        s
    };
    general_purpose::STANDARD.decode(payload).ok()
}

/// 返回 PNG 图片响应（status=200，body 为 base64 data URL）
/// 注意：Tauri 端不能用 HTTP 直接返回二进制，统一编码为 base64 data URL
/// 前端 preload 层会把 data URL 转回 Blob
pub(super) fn png_response(bytes: &[u8]) -> ApiResult {
    let data_url = utils::bytes_to_data_url(bytes, "image/png");
    ApiResult::ok(json!({
        "success": true,
        "dataUrl": data_url,
        "contentType": "image/png"
    }))
}

/// 返回 PNG 图片响应（带 skin model 头）
/// model 统一转小写返回，避免前端 accounts.js 检查 'slim' 时因大小写不匹配失败
///   （Mojang API 返回的 variant 是 "SLIM"/"CLASSIC"）
pub(super) fn png_response_with_model(bytes: &[u8], model: String) -> ApiResult {
    let data_url = utils::bytes_to_data_url(bytes, "image/png");
    let model_lower = model.to_lowercase();
    ApiResult::ok(json!({
        "success": true,
        "dataUrl": data_url,
        "contentType": "image/png",
        "skinModel": if model_lower.is_empty() { "default".to_string() } else { model_lower }
    }))
}
