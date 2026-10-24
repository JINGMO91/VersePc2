// 披风管理：本地披风库、选择/删除、官方披风拉取。
// 存储：DATA_DIR/capes/<accountId>/<ts>_<name>.png
// 选中状态存 accounts.json 的 capeFile 字段（空/缺失 = 未披）
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;

use crate::api::ApiResult;
use crate::storage;
use crate::utils;

use super::common::{base64_decode, is_png, png_response, write_skin_log};

/// 披风目录
fn capes_dir(account_id: &str) -> PathBuf {
    storage::resolve_data_dir().join("capes").join(account_id)
}

/// 文件名安全化：仅保留字母数字下划线连字符
fn sanitize_cape_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim_matches('_').to_string();
    let mut out: String = trimmed.chars().take(40).collect();
    if out.is_empty() {
        out = "cape".to_string();
    }
    out
}

/// 解析 PNG IHDR 尺寸（宽, 高）
fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || !bytes.starts_with(&[0x89u8, b'P', b'N', b'G']) {
        return None;
    }
    let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((w, h))
}

/// GET /api/capes/local - 列出账户本地披风
pub(super) fn handle_capes_local(params: &Option<Value>) -> ApiResult {
    let p = params.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&p, "accountId");
    if account_id.is_empty() {
        return ApiResult::err(400, "Missing accountId");
    }
    let dir = capes_dir(&account_id);
    let mut capes: Vec<Value> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let mut files: Vec<std::fs::DirEntry> = entries.filter_map(|e| e.ok()).collect();
        files.sort_by_key(|e| e.file_name());
        for e in files {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.to_lowercase().ends_with(".png") {
                continue;
            }
            let id = name.trim_end_matches(".png").to_string();
            capes.push(json!({ "id": id, "name": id, "file": name }));
        }
    }
    ApiResult::ok(json!({ "success": true, "capes": capes }))
}

/// GET /api/capes/file - 返回披风 PNG（参数 accountId, file）
pub(super) fn handle_capes_file(params: &Option<Value>) -> ApiResult {
    let p = params.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&p, "accountId");
    let file = utils::get_str(&p, "file");
    if account_id.is_empty() || file.is_empty() {
        return ApiResult::err(400, "Missing params");
    }
    if file.contains("..") || file.contains('/') || file.contains('\\') {
        return ApiResult::err(400, "Invalid file");
    }
    let path = capes_dir(&account_id).join(&file);
    match std::fs::read(&path) {
        Ok(bytes) if is_png(&bytes) => png_response(&bytes),
        _ => ApiResult::err(404, "Cape not found"),
    }
}

/// POST /api/capes/import - 导入披风 PNG {accountId, fileBase64, name}
pub(super) fn handle_capes_import(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&data, "accountId");
    let file_base64 = utils::get_str(&data, "fileBase64");
    let name = utils::get_str(&data, "name");
    if account_id.is_empty() || file_base64.is_empty() {
        return ApiResult::err(400, "Missing params");
    }
    let buf = match base64_decode(&file_base64) {
        Some(b) => b,
        None => return ApiResult::err(400, "Invalid base64"),
    };
    if !is_png(&buf) {
        return ApiResult::err(400, "File must be PNG");
    }
    if let Some((w, _h)) = png_dimensions(&buf)
        && w != 64 && w != 92 {
            return ApiResult::err(400, "不是有效的披风纹理（宽度需为 64 或 92）");
        }
    let dir = capes_dir(&account_id);
    let _ = std::fs::create_dir_all(&dir);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let safe = sanitize_cape_name(if name.is_empty() { "cape" } else { &name });
    let file_name = format!("{}_{}.png", ts, safe);
    if std::fs::write(dir.join(&file_name), &buf).is_err() {
        return ApiResult::err(500, "写入披风文件失败");
    }
    write_skin_log(&format!("导入披风成功 accountId={} file={} size={}", account_id, file_name, buf.len()));
    ApiResult::ok(json!({ "success": true, "fileName": file_name }))
}

/// POST /api/capes/select - 选中/卸下披风（capeId 传空串表示卸下）
pub(super) fn handle_capes_select(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&data, "accountId");
    let cape_id = utils::get_str(&data, "capeId");
    if account_id.is_empty() {
        return ApiResult::err(400, "Missing accountId");
    }
    let file = if cape_id.is_empty() {
        String::new()
    } else {
        format!("{}.png", cape_id)
    };
    if !file.is_empty() && !capes_dir(&account_id).join(&file).exists() {
        return ApiResult::err(404, "Cape not found");
    }
    let mut accounts = storage::load_accounts();
    let arr = match accounts.as_array_mut() {
        Some(a) => a,
        None => return ApiResult::err(500, "accounts.json 格式错误"),
    };
    let acc = match arr.iter_mut().find(|a| utils::get_str(a, "id") == account_id) {
        Some(a) => a,
        None => return ApiResult::err(404, "Account not found"),
    };
    if let Some(obj) = acc.as_object_mut() {
        if file.is_empty() {
            obj.remove("capeFile");
        } else {
            obj.insert("capeFile".to_string(), json!(file));
        }
    }
    storage::save_accounts(&accounts);
    write_skin_log(&format!("切换披风 accountId={} cape={}", account_id, if file.is_empty() { "<卸下>".to_string() } else { file.clone() }));
    ApiResult::ok(json!({ "success": true }))
}

/// POST /api/capes/delete - 删除本地披风 {accountId, capeId}
pub(super) fn handle_capes_delete(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&data, "accountId");
    let cape_id = utils::get_str(&data, "capeId");
    if account_id.is_empty() || cape_id.is_empty() {
        return ApiResult::err(400, "Missing params");
    }
    let file = format!("{}.png", cape_id);
    if file.contains("..") {
        return ApiResult::err(400, "Invalid file");
    }
    let _ = std::fs::remove_file(capes_dir(&account_id).join(&file));
    let mut accounts = storage::load_accounts();
    let mut changed = false;
    if let Some(arr) = accounts.as_array_mut()
        && let Some(acc) = arr.iter_mut().find(|a| utils::get_str(a, "id") == account_id)
            && utils::get_str(acc, "capeFile") == file {
                if let Some(obj) = acc.as_object_mut() {
                    obj.remove("capeFile");
                }
                changed = true;
            }
    if changed {
        storage::save_accounts(&accounts);
    }
    write_skin_log(&format!("删除披风 accountId={} cape={}", account_id, file));
    ApiResult::ok(json!({ "success": true }))
}

/// POST /api/capes/fetch-session - 拉取微软账户官方披风 {accountId}
/// 请求 sessionserver profile，解析 textures.CAPE.url 并下载到本地披风库
pub(super) async fn handle_capes_fetch_session(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&data, "accountId");
    if account_id.is_empty() {
        return ApiResult::err(400, "Missing accountId");
    }
    let accounts = storage::load_accounts();
    let acc = match accounts
        .as_array()
        .and_then(|a| a.iter().find(|a| utils::get_str(a, "id") == account_id))
    {
        Some(a) => a.clone(),
        None => return ApiResult::err(404, "Account not found"),
    };
    let uuid = utils::get_str(&acc, "uuid").replace('-', "");
    if uuid.len() != 32 || !uuid.chars().all(|c| c.is_ascii_hexdigit()) {
        return ApiResult::err(400, "账号缺少有效 UUID");
    }
    let dashed = format!(
        "{}-{}-{}-{}-{}",
        &uuid[0..8],
        &uuid[8..12],
        &uuid[12..16],
        &uuid[16..20],
        &uuid[20..32]
    );
    let url = format!(
        "https://sessionserver.mojang.com/session/minecraft/profile/{}",
        dashed
    );
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("VersePC-Tauri/1.0")
        .build()
    {
        Ok(c) => c,
        Err(_) => return ApiResult::err(500, "HTTP 初始化失败"),
    };
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return ApiResult::err(502, "访问 Mojang 会话服务器失败"),
    };
    if !resp.status().is_success() {
        return ApiResult::err(502, "会话服务器返回异常");
    }
    let v: Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return ApiResult::err(502, "会话数据解析失败"),
    };
    let cape_url = v
        .get("properties")
        .and_then(|p| p.as_array())
        .and_then(|arr| {
            arr.iter().find(|x| {
                x.get("name").and_then(|n| n.as_str()) == Some("textures")
            })
        })
        .and_then(|x| x.get("value"))
        .and_then(|s| s.as_str())
        .and_then(|b64| {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.decode(b64).ok()
        })
        .and_then(|dec| serde_json::from_slice::<Value>(&dec).ok())
        .and_then(|tv| {
            tv.get("textures")
                .and_then(|t| t.get("CAPE"))
                .and_then(|c| c.get("url"))
                .and_then(|u| u.as_str())
                .map(String::from)
        });
    let cape_url = match cape_url {
        Some(u) => u,
        None => {
            return ApiResult::ok(json!({ "success": false, "error": "no-cape" }));
        }
    };
    let png = match client.get(&cape_url).send().await {
        Ok(r) if r.status().is_success() => match r.bytes().await {
            Ok(b) => b.to_vec(),
            Err(_) => return ApiResult::err(502, "下载披风纹理失败"),
        },
        _ => return ApiResult::err(502, "下载披风纹理失败"),
    };
    if !is_png(&png) {
        return ApiResult::err(502, "披风纹理格式异常");
    }
    let dir = capes_dir(&account_id);
    let _ = std::fs::create_dir_all(&dir);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let file_name = format!("{}_official.png", ts);
    if std::fs::write(dir.join(&file_name), &png).is_err() {
        return ApiResult::err(500, "写入披风文件失败");
    }
    write_skin_log(&format!("拉取官方披风成功 accountId={} file={}", account_id, file_name));
    ApiResult::ok(json!({ "success": true, "fileName": file_name }))
}
