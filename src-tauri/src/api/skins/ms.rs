// 微软账号本地皮肤库：目录与 meta 管理、导入、应用到 Mojang、删除。
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;

use crate::api::ApiResult;
use crate::auth;
use crate::storage;
use crate::utils;

use super::common::{base64_decode, is_png, png_response, write_skin_log};

/// 获取微软皮肤库目录：DATA_DIR/ms-skins/<accountId>/
fn ms_skins_dir(account_id: &str) -> PathBuf {
    let dir = storage::resolve_data_dir().join("ms-skins").join(account_id);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// 读取皮肤库 meta.json
fn load_ms_skin_meta(account_id: &str) -> Value {
    let meta_file = ms_skins_dir(account_id).join("meta.json");
    if let Ok(content) = std::fs::read_to_string(&meta_file)
        && let Ok(v) = serde_json::from_str::<Value>(&content) {
            return v;
        }
    json!({ "skins": [] })
}

/// 保存皮肤库 meta.json
fn save_ms_skin_meta(account_id: &str, meta: &Value) -> bool {
    let meta_file = ms_skins_dir(account_id).join("meta.json");
    if let Ok(json) = serde_json::to_string_pretty(meta) {
        std::fs::write(&meta_file, json).is_ok()
    } else {
        false
    }
}

/// 校验账号存在且为微软账号，返回 Err(ApiResult) 表示失败
fn validate_ms_account(account_id: &str) -> Option<ApiResult> {
    let accounts = storage::load_accounts();
    let acc = accounts
        .as_array()
        .and_then(|arr| arr.iter().find(|a| utils::get_str(a, "id") == account_id))
        .cloned();

    match acc {
        None => Some(ApiResult::err(404, "Account not found")),
        Some(a) => {
            if utils::get_str(&a, "type") != "microsoft" {
                Some(ApiResult::err(400, "Only microsoft account supported"))
            } else {
                None
            }
        }
    }
}

/// GET /api/ms-skins/local — 获取本地皮肤库
/// 参数：accountId（必填）
pub(super) fn handle_ms_skins_local(params: &Option<Value>) -> ApiResult {
    let p = params.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&p, "accountId");

    if account_id.is_empty() {
        return ApiResult::err(400, "Missing accountId");
    }

    // 校验账号存在且为微软账号
    if let Some(err) = validate_ms_account(&account_id) {
        return err;
    }

    let meta = load_ms_skin_meta(&account_id);
    let skins = meta.get("skins").cloned().unwrap_or(json!([]));

    ApiResult::ok(json!({
        "success": true,
        "skins": skins
    }))
}

/// GET /api/ms-skins/file — 获取本地皮肤文件 PNG
/// 参数：accountId, skinId
pub(super) fn handle_ms_skins_file(params: &Option<Value>) -> ApiResult {
    let p = params.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&p, "accountId");
    let skin_id = utils::get_str(&p, "skinId");

    if account_id.is_empty() || skin_id.is_empty() {
        return ApiResult::err(400, "Missing params");
    }

    let meta = load_ms_skin_meta(&account_id);
    let skin = meta
        .get("skins")
        .and_then(|s| s.as_array())
        .and_then(|arr| arr.iter().find(|s| utils::get_str(s, "id") == skin_id))
        .cloned();

    let skin = match skin {
        Some(s) => s,
        None => return ApiResult::err(404, "Skin not found"),
    };

    let file = utils::get_str(&skin, "file");
    let file_path = ms_skins_dir(&account_id).join(&file);

    if let Ok(bytes) = std::fs::read(&file_path) {
        return png_response(&bytes);
    }

    ApiResult::err(404, "File not found")
}

/// POST /api/ms-skins/import — 导入皮肤到本地库
/// 参数：accountId, fileBase64, model, name
pub(super) async fn handle_ms_skins_import(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&data, "accountId");
    let file_base64 = utils::get_str(&data, "fileBase64");
    let model = utils::get_str(&data, "model");
    let name = utils::get_str(&data, "name");

    if account_id.is_empty() || file_base64.is_empty() {
        return ApiResult::err(400, "Missing accountId or fileBase64");
    }

    if let Some(err) = validate_ms_account(&account_id) {
        return err;
    }

    let skin_buf = match base64_decode(&file_base64) {
        Some(b) => b,
        None => return ApiResult::err(400, "Invalid base64"),
    };

    if !is_png(&skin_buf) {
        return ApiResult::err(400, "File must be PNG");
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let skin_id = format!("skin_{}", ts);
    let file_name = format!("{}.png", skin_id);
    let file_path = ms_skins_dir(&account_id).join(&file_name);

    if std::fs::write(&file_path, &skin_buf).is_err() {
        return ApiResult::err(500, "写入皮肤文件失败");
    }

    let mut meta = load_ms_skin_meta(&account_id);
    let skins = meta
        .get_mut("skins")
        .and_then(|s| s.as_array_mut())
        .ok_or(())
        .map(|arr| {
            let new_skin = json!({
                "id": skin_id,
                "name": if name.is_empty() {
                    format!("自定义皮肤 {}", arr.len() + 1)
                } else {
                    name.clone()
                },
                "file": file_name,
                "model": if model == "slim" { "slim" } else { "default" },
                "importedAt": utils::now_iso()
            });
            arr.push(new_skin.clone());
            new_skin
        });

    match skins {
        Ok(new_skin) => {
            save_ms_skin_meta(&account_id, &meta);
            ApiResult::ok(json!({
                "success": true,
                "skin": new_skin
            }))
        }
        Err(_) => ApiResult::err(500, "meta.json 格式错误"),
    }
}

/// POST /api/ms-skins/apply — 应用本地皮肤到 Mojang 官方
/// 参数：accountId, skinId
/// 流程：
///   1. 校验账号存在且为微软账号
///   2. 解密 accessToken
///   3. 读取本地皮肤文件
///   4. 构造 multipart/form-data，POST 到 https://api.minecraftservices.com/minecraft/profile/skins
///   5. 处理 200/401/429/其他状态码
pub(super) async fn handle_ms_skins_apply(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&data, "accountId");
    let skin_id = utils::get_str(&data, "skinId");

    if account_id.is_empty() || skin_id.is_empty() {
        return ApiResult::err(400, "Missing accountId or skinId");
    }

    if let Some(err) = validate_ms_account(&account_id) {
        return err;
    }

    // 加载账号，解密 accessToken
    let accounts = storage::load_accounts();
    let account = accounts
        .as_array()
        .and_then(|arr| arr.iter().find(|a| utils::get_str(a, "id") == account_id))
        .cloned();

    let account = match account {
        Some(a) => a,
        None => return ApiResult::err(404, "Account not found"),
    };

    let encrypted_token = utils::get_str(&account, "accessToken");
    if encrypted_token.is_empty() || encrypted_token == "0" {
        return ApiResult::err(401, "账户未登录，请重新登录微软账户");
    }

    let access_token = auth::token::decrypt_account_token(&encrypted_token);
    // 若解密失败（返回原值），说明 token 异常
    if access_token == encrypted_token && encrypted_token.starts_with("enc:") {
        return ApiResult::err(401, "Token 解密失败，请重新登录微软账户");
    }

    // 读取本地皮肤文件
    let meta = load_ms_skin_meta(&account_id);
    let skin = meta
        .get("skins")
        .and_then(|s| s.as_array())
        .and_then(|arr| arr.iter().find(|s| utils::get_str(s, "id") == skin_id))
        .cloned();

    let skin = match skin {
        Some(s) => s,
        None => return ApiResult::err(404, "Skin not found"),
    };

    let file = utils::get_str(&skin, "file");
    let file_path = ms_skins_dir(&account_id).join(&file);
    let skin_buf = match std::fs::read(&file_path) {
        Ok(b) => b,
        Err(_) => return ApiResult::err(404, "Skin file missing"),
    };

    let variant = if utils::get_str(&skin, "model") == "slim" {
        "slim"
    } else {
        "classic"
    };

    // 上传到 Mojang
    let upload = upload_skin_to_mojang(&access_token, &skin_buf, variant).await;

    match upload {
        UploadResult::Success(new_skin_url) => {
            // 更新账号 skinUrl / skinModel
            let mut accounts = storage::load_accounts();
            if let Some(arr) = accounts.as_array_mut()
                && let Some(acc) = arr
                    .iter_mut()
                    .find(|a| utils::get_str(a, "id") == account_id)
                    && let Some(obj) = acc.as_object_mut() {
                        if !new_skin_url.is_empty() {
                            obj.insert("skinUrl".to_string(), json!(new_skin_url));
                        }
                        obj.insert(
                            "skinModel".to_string(),
                            json!(if variant == "slim" { "slim" } else { "default" }),
                        );
                    }
            storage::save_accounts(&accounts);

            write_skin_log(&format!(
                "应用微软皮肤成功 accountId={} skinId={}",
                account_id, skin_id
            ));
            ApiResult::ok(json!({
                "success": true,
                "skinUrl": new_skin_url
            }))
        }
        UploadResult::Unauthorized => {
            write_skin_log(&format!(
                "应用微软皮肤失败 accountId={} skinId={} 原因=登录已过期",
                account_id, skin_id
            ));
            ApiResult::err(401, "登录已过期，请重新登录微软账户")
        }
        UploadResult::RateLimited(retry_after) => {
            write_skin_log(&format!(
                "应用微软皮肤限流 accountId={} skinId={} retryAfter={:?}",
                account_id, skin_id, retry_after
            ));
            let wait_seconds = retry_after.unwrap_or(60);
            let wait_minutes = wait_seconds.div_ceil(60);
            let msg = if wait_minutes > 1 {
                format!(
                    "操作过于频繁，Mojang 限制每分钟只能更换一次皮肤，请 {} 分钟后再试",
                    wait_minutes
                )
            } else {
                format!(
                    "操作过于频繁，Mojang 限制每分钟只能更换一次皮肤，请 {} 秒后再试",
                    wait_seconds
                )
            };
            ApiResult {
                status: 429,
                body: json!({
                    "success": false,
                    "error": msg,
                    "rateLimited": true,
                    "retryAfter": wait_seconds
                }),
            }
        }
        UploadResult::Failed(status, msg) => {
            write_skin_log(&format!(
                "应用微软皮肤失败 accountId={} skinId={} status={} msg={}",
                account_id, skin_id, status, msg
            ));
            ApiResult::err(status, &format!("上传失败: {}", msg))
        }
    }
}

/// POST /api/ms-skins/delete — 删除本地皮肤
/// 参数：accountId, skinId
pub(super) fn handle_ms_skins_delete(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&data, "accountId");
    let skin_id = utils::get_str(&data, "skinId");

    if account_id.is_empty() || skin_id.is_empty() {
        return ApiResult::err(400, "Missing accountId or skinId");
    }

    let mut meta = load_ms_skin_meta(&account_id);
    let skins = match meta.get_mut("skins").and_then(|s| s.as_array_mut()) {
        Some(arr) => arr,
        None => return ApiResult::err(500, "meta.json 格式错误"),
    };

    let idx = skins
        .iter()
        .position(|s| utils::get_str(s, "id") == skin_id);
    let idx = match idx {
        Some(i) => i,
        None => return ApiResult::err(404, "Skin not found"),
    };

    let file = utils::get_str(&skins[idx], "file");
    let file_path = ms_skins_dir(&account_id).join(&file);
    let _ = std::fs::remove_file(&file_path);

    skins.remove(idx);
    save_ms_skin_meta(&account_id, &meta);

    ApiResult::ok(json!({ "success": true }))
}

/// 上传皮肤到 Mojang 的结果
enum UploadResult {
    /// 成功，包含新的 skinUrl（可能为空）
    Success(String),
    /// 401 未授权
    Unauthorized,
    /// 429 速率限制，包含 Retry-After 秒数
    RateLimited(Option<u64>),
    /// 其他失败，包含 HTTP 状态码和错误消息
    Failed(u16, String),
}

/// 上传皮肤到 Mojang 官方
/// POST https://api.minecraftservices.com/minecraft/profile/skins
/// 格式：multipart/form-data，包含 variant 和 file 字段
async fn upload_skin_to_mojang(
    access_token: &str,
    skin_buf: &[u8],
    variant: &str,
) -> UploadResult {
    let boundary = format!("----VersePCSkinUpload{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0));

    let header_part = format!(
        "--{}\r\n\
         Content-Disposition: form-data; name=\"variant\"\r\n\r\n{}\r\n\
         --{}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"skin.png\"\r\n\
         Content-Type: image/png\r\n\r\n",
        boundary, variant, boundary
    );
    let end_part = format!("\r\n--{}--\r\n", boundary);

    let header_bytes = header_part.into_bytes();
    let end_bytes = end_part.into_bytes();

    // 拼接 multipart body
    let mut body_bytes = Vec::with_capacity(header_bytes.len() + skin_buf.len() + end_bytes.len());
    body_bytes.extend_from_slice(&header_bytes);
    body_bytes.extend_from_slice(skin_buf);
    body_bytes.extend_from_slice(&end_bytes);

    let url = "https://api.minecraftservices.com/minecraft/profile/skins";
    let content_type = format!("multipart/form-data; boundary={}", boundary);

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => return UploadResult::Failed(0, format!("构建 HTTP 客户端失败: {}", e)),
    };

    let resp = match client
        .post(url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", &content_type)
        .body(body_bytes)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return UploadResult::Failed(0, format!("上传请求失败: {}", e)),
    };

    let status = resp.status().as_u16();
    let retry_after = resp
        .headers()
        .get("Retry-After")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    let text = resp.text().await.unwrap_or_default();

    if status == 200 {
        // 解析响应取 ACTIVE 皮肤的 url
        let parsed: Value = serde_json::from_str(&text).unwrap_or(json!({}));
        let new_url = parsed
            .get("skins")
            .and_then(|s| s.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|s| s.get("state").and_then(|v| v.as_str()) == Some("ACTIVE"))
            })
            .and_then(|s| s.get("url").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string();
        UploadResult::Success(new_url)
    } else if status == 401 {
        UploadResult::Unauthorized
    } else if status == 429 {
        UploadResult::RateLimited(retry_after)
    } else {
        // 尝试从响应体提取 errorMessage
        let parsed: Value = serde_json::from_str(&text).unwrap_or(json!({}));
        let msg = parsed
            .get("errorMessage")
            .and_then(|v| v.as_str())
            .unwrap_or(&text)
            .to_string();
        UploadResult::Failed(status, msg)
    }
}
