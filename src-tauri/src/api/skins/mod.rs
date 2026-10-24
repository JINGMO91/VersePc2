// api/skins/mod.rs — 皮肤管理 API 路由
//
// 路由清单：
//   ===== 通用皮肤 =====
//   GET  /api/default-skins      列出内置默认皮肤（Steve/Alex/Zombie/Enderman/Creeper）
//   GET  /api/skin-head           获取皮肤头部 PNG（按 id 或 file 参数）
//   POST /api/set-account-skin    为账号设置默认皮肤
//   POST /api/upload-skin         上传自定义皮肤 PNG（multipart 或 base64）
//   GET  /api/skin-texture        获取整张皮肤图（含 model 头）
//   POST /api/save-avatar         保存头像文件（data URL → PNG/JPG）
//   GET  /api/clear-avatar        清除已保存的头像文件
//
//   ===== 微软账号本地皮肤库（ms.rs）=====
//   存储：DATA_DIR/ms-skins/<accountId>/meta.json + <accountId>/skin_xxx.png
//   GET  /api/ms-skins/local      列出账号本地皮肤库
//   GET  /api/ms-skins/file       获取本地皮肤文件 PNG
//   POST /api/ms-skins/import     导入皮肤到本地库（base64 → PNG）
//   POST /api/ms-skins/apply      应用本地皮肤到 Mojang 官方
//   POST /api/ms-skins/delete     删除本地皮肤
//
//   ===== 披风管理（capes.rs）=====
//   GET  /api/capes/local         列出账号本地披风
//   GET  /api/capes/file          获取披风 PNG
//   POST /api/capes/import        导入披风到本地库
//   POST /api/capes/select        选中/卸下披风
//   POST /api/capes/delete        删除本地披风
//   POST /api/capes/fetch-session 拉取微软账户官方披风
//
// PNG 校验：仅校验 PNG 魔数（89 50 4E 47），不做尺寸校验和缩放
//   理由：Minecraft 1.8+ 会自动适配非标准尺寸皮肤，sharp 引入过重

use serde_json::{json, Value};

use crate::api::ApiResult;
use crate::storage;
use crate::utils;

mod common;
mod capes;
mod ms;

use common::{base64_decode, fetch_remote_bytes, is_png, png_response, png_response_with_model, write_skin_log};

// ============== 内置皮肤资源 ==============
// 编译时嵌入到二进制，运行时永远可用（不依赖前端 dist 构建）
// 文件来源：src-tauri/resources/*.png

const STEVE_HEAD_PNG: &[u8] = include_bytes!("../../../resources/steve_head.png");
const STEVE_SKIN_PNG: &[u8] = include_bytes!("../../../resources/steve_skin.png");
const SKIN_ALEX_PNG: &[u8] = include_bytes!("../../../resources/skin_alex.png");
const SKIN_CREEPER_PNG: &[u8] = include_bytes!("../../../resources/skin_creeper.png");
const SKIN_ENDERMAN_PNG: &[u8] = include_bytes!("../../../resources/skin_enderman.png");
const SKIN_ZOMBIE_PNG: &[u8] = include_bytes!("../../../resources/skin_zombie.png");

/// 内置默认皮肤清单
fn builtin_default_skins() -> Vec<(&'static str, &'static str, &'static str, &'static str)> {
    // (id, name, file, model)
    vec![
        ("steve", "Steve", "steve_skin.png", "default"),
        ("alex", "Alex", "skin_alex.png", "slim"),
        ("zombie", "Zombie", "skin_zombie.png", "default"),
        ("enderman", "Enderman", "skin_enderman.png", "default"),
        ("creeper", "Creeper", "skin_creeper.png", "default"),
    ]
}

/// 按 file 名获取内置皮肤字节
fn get_builtin_skin_bytes(file: &str) -> Option<&'static [u8]> {
    match file {
        "steve_head.png" => Some(STEVE_HEAD_PNG),
        "steve_skin.png" => Some(STEVE_SKIN_PNG),
        "skin_alex.png" => Some(SKIN_ALEX_PNG),
        "skin_creeper.png" => Some(SKIN_CREEPER_PNG),
        "skin_enderman.png" => Some(SKIN_ENDERMAN_PNG),
        "skin_zombie.png" => Some(SKIN_ZOMBIE_PNG),
        _ => None,
    }
}

// ============== 路由分发 ==============

/// 处理皮肤相关路由
pub async fn handle(
    _app: &tauri::AppHandle,
    method: &str,
    path: &str,
    params: &Option<Value>,
    body: &Option<Value>,
) -> Option<ApiResult> {
    let key = format!("{} {}", method.to_uppercase(), path);

    match key.as_str() {
        // ===== 通用皮肤 =====
        "GET /api/default-skins" => Some(handle_default_skins()),
        "GET /api/skin-head" => Some(handle_skin_head(params)),
        "POST /api/set-account-skin" => Some(handle_set_account_skin(body)),
        "POST /api/upload-skin" => Some(handle_upload_skin(body).await),
        "GET /api/skin-texture" => Some(handle_skin_texture(params).await),
        "POST /api/save-avatar" => Some(handle_save_avatar(body)),
        "GET /api/clear-avatar" => Some(handle_clear_avatar()),

        // ===== 微软账号本地皮肤库 =====
        "GET /api/ms-skins/local" => Some(ms::handle_ms_skins_local(params)),
        "GET /api/ms-skins/file" => Some(ms::handle_ms_skins_file(params)),
        "POST /api/ms-skins/import" => Some(ms::handle_ms_skins_import(body).await),
        "POST /api/ms-skins/apply" => Some(ms::handle_ms_skins_apply(body).await),
        "POST /api/ms-skins/delete" => Some(ms::handle_ms_skins_delete(body)),

        // ===== 披风管理（账户详情披风切换） =====
        "GET /api/capes/local" => Some(capes::handle_capes_local(params)),
        "GET /api/capes/file" => Some(capes::handle_capes_file(params)),
        "POST /api/capes/import" => Some(capes::handle_capes_import(body)),
        "POST /api/capes/select" => Some(capes::handle_capes_select(body)),
        "POST /api/capes/delete" => Some(capes::handle_capes_delete(body)),
        "POST /api/capes/fetch-session" => Some(capes::handle_capes_fetch_session(body).await),

        _ => None,
    }
}

// ====================================================================
// 通用皮肤路由
// ====================================================================

/// GET /api/default-skins — 列出内置默认皮肤
fn handle_default_skins() -> ApiResult {
    let skins: Vec<Value> = builtin_default_skins()
        .iter()
        .map(|(id, name, file, model)| {
            json!({
                "id": id,
                "name": name,
                "file": file,
                "model": model
            })
        })
        .collect();

    ApiResult::ok(json!({
        "success": true,
        "skins": skins
    }))
}

/// GET /api/skin-head — 获取皮肤头部 PNG
/// 参数：id（steve/alex/zombie/enderman/creeper）或 file（自定义文件名）
fn handle_skin_head(params: &Option<Value>) -> ApiResult {
    let id = utils::get_str(&params.clone().unwrap_or(Value::Null), "id");
    let custom_file = utils::get_str(&params.clone().unwrap_or(Value::Null), "file");

    let file = if !custom_file.is_empty() {
        custom_file
    } else if !id.is_empty() {
        match id.as_str() {
            "steve" => "steve_skin.png",
            "alex" => "skin_alex.png",
            "zombie" => "skin_zombie.png",
            "enderman" => "skin_enderman.png",
            "creeper" => "skin_creeper.png",
            _ => "",
        }
        .to_string()
    } else {
        String::new()
    };

    if file.is_empty() {
        return ApiResult::err(400, "Missing id");
    }

    // 先找内置皮肤
    if let Some(bytes) = get_builtin_skin_bytes(&file) {
        return png_response(bytes);
    }

    // 再找用户自定义皮肤（DATA_DIR/img/<file>）
    let custom_path = storage::resolve_data_dir().join("img").join(&file);
    if let Ok(bytes) = std::fs::read(&custom_path)
        && is_png(&bytes) {
            return png_response(&bytes);
        }

    ApiResult::err(404, "Skin not found")
}

/// POST /api/set-account-skin — 为账号设置默认皮肤
/// 参数：accountId, skinId
fn handle_set_account_skin(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&data, "accountId");
    let skin_id = utils::get_str(&data, "skinId");

    if account_id.is_empty() || skin_id.is_empty() {
        return ApiResult::err(400, "Missing params");
    }

    let skin_map: &[(&str, &str, &str)] = &[
        ("steve", "steve_skin.png", "default"),
        ("alex", "skin_alex.png", "slim"),
        ("zombie", "skin_zombie.png", "default"),
        ("enderman", "skin_enderman.png", "default"),
        ("creeper", "skin_creeper.png", "default"),
    ];

    let skin_info = skin_map.iter().find(|(id, _, _)| *id == skin_id);
    let (file, model) = match skin_info {
        Some((_, f, m)) => (*f, *m),
        None => return ApiResult::err(400, "Invalid skin"),
    };

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
        obj.insert("skinFile".to_string(), json!(file));
        obj.insert("skinModel".to_string(), json!(model));
    }

    storage::save_accounts(&accounts);

    write_skin_log(&format!(
        "切换皮肤成功 accountId={} skinId={} file={} model={}",
        account_id, skin_id, file, model
    ));
    ApiResult::ok(json!({ "success": true }))
}

/// POST /api/upload-skin — 上传自定义皮肤
/// 参数（JSON 形式）：accountId, model, fileBase64
/// 或 multipart/form-data（暂不支持，统一走 JSON）
async fn handle_upload_skin(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let account_id = utils::get_str(&data, "accountId");
    let model = utils::get_str(&data, "model");
    let file_base64 = utils::get_str(&data, "fileBase64");

    if account_id.is_empty() || file_base64.is_empty() {
        return ApiResult::err(400, "Missing file or accountId");
    }

    // 解码 base64
    let skin_buf = match base64_decode(&file_base64) {
        Some(b) => b,
        None => return ApiResult::err(400, "Invalid base64"),
    };

    if !is_png(&skin_buf) {
        return ApiResult::err(400, "File must be PNG");
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

    // 保存皮肤文件到 DATA_DIR/img/custom_<accountId>_<ts>.png
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let file_name = format!("custom_{}_{}.png", account_id, ts);
    let img_dir = storage::resolve_data_dir().join("img");
    let _ = std::fs::create_dir_all(&img_dir);
    let file_path = img_dir.join(&file_name);

    if std::fs::write(&file_path, &skin_buf).is_err() {
        return ApiResult::err(500, "写入皮肤文件失败");
    }

    let final_model = if model == "slim" { "slim" } else { "default" };

    if let Some(obj) = acc.as_object_mut() {
        obj.insert("skinFile".to_string(), json!(file_name));
        obj.insert("skinModel".to_string(), json!(final_model));
    }

    storage::save_accounts(&accounts);

    write_skin_log(&format!(
        "上传皮肤成功 accountId={} model={} file={} size={}",
        account_id,
        final_model,
        file_name,
        skin_buf.len()
    ));
    ApiResult::ok(json!({
        "success": true,
        "fileName": file_name
    }))
}

/// GET /api/skin-texture — 获取整张皮肤图
/// 参数：uuid（必填）、serverUrl、username
///
/// 优先级：
///   1. 账号本地 skinFile（内置或自定义）
///   2. 账号 skinUrl（微软账号登录后从 Mojang 拿到的纹理 URL）
///   3. 外置认证服务器 /skin/{username}.png
///   4. 公共皮肤服务（mc-heads.net/skin、crafatar.com/skins、minotar.net/skin）
///   5. 回退到 Steve 整皮
async fn handle_skin_texture(params: &Option<Value>) -> ApiResult {
    let p = params.clone().unwrap_or(Value::Null);
    let uuid = utils::get_str(&p, "uuid");
    let server_url = utils::get_str(&p, "serverUrl");
    let username = utils::get_str(&p, "username");

    if uuid.is_empty() {
        return ApiResult::err(400, "Missing uuid");
    }

    let clean_uuid = uuid.replace('-', "");

    // 1. 优先用账号本地存储的皮肤文件（skinFile）或 skinUrl（微软账号）
    let accounts = storage::load_accounts();
    if let Some(arr) = accounts.as_array()
        && let Some(acc) = arr
            .iter()
            .find(|a| utils::get_str(a, "uuid").replace('-', "") == clean_uuid)
        {
            let skin_file = utils::get_str(acc, "skinFile");
            if !skin_file.is_empty() {
                if let Some(bytes) = get_builtin_skin_bytes(&skin_file) {
                    return png_response_with_model(bytes, utils::get_str(acc, "skinModel"));
                }
                // 用户自定义皮肤
                let custom_path = storage::resolve_data_dir().join("img").join(&skin_file);
                if let Ok(bytes) = std::fs::read(&custom_path)
                    && is_png(&bytes) {
                        return png_response_with_model(&bytes, utils::get_str(acc, "skinModel"));
                    }
            }

            // 1b. 微软/外置账号的 skinUrl 字段：从 Mojang texture URL 直接拉取整皮
            //   这是登录时从 https://api.minecraftservices.com/minecraft/profile 拿到的
            //   textures.SKIN.url 字段
            let skin_url = utils::get_str(acc, "skinUrl");
            if !skin_url.is_empty()
                && let Some(bytes) = fetch_remote_bytes(&skin_url).await
                    && is_png(&bytes) {
                        let model = utils::get_str(acc, "skinModel");
                        return png_response_with_model(&bytes, model);
                    }
                // skinUrl 拉取失败继续尝试后续数据源
        }

    // 2. 外置服务器：从 /skin/{username}.png 拉取
    if !server_url.is_empty() && !username.is_empty() {
        let url = format!(
            "{}/skin/{}.png",
            server_url.trim_end_matches('/'),
            username
        );
        if let Some(bytes) = fetch_remote_bytes(&url).await
            && is_png(&bytes) {
                return png_response_with_model(&bytes, "default".to_string());
            }
    }

    // 3. 公共皮肤服务（按 UUID 拉取整张皮肤）
    //   注意：这里用 SKIN_SERVICES（整皮），不是 AVATAR_SERVICES（头像）
    //   避免拿到 64x64 头像图被当成 64x64 皮肤拉伸
    let skin_services: &[&str] = &[
        "https://mc-heads.net/skin/{uuid}",
        "https://crafatar.com/skins/{uuid}",
        "https://minotar.net/skin/{uuid}",
    ];
    for tmpl in skin_services {
        let url = tmpl.replace("{uuid}", &clean_uuid);
        if let Some(bytes) = fetch_remote_bytes(&url).await
            && is_png(&bytes) {
                return png_response_with_model(&bytes, "default".to_string());
            }
    }

    // 4. 全部失败，回退到 Steve 整皮
    png_response_with_model(STEVE_SKIN_PNG, "default".to_string())
}

/// POST /api/save-avatar — 保存头像文件
/// 参数：dataUrl（如 data:image/png;base64,xxxx）
fn handle_save_avatar(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let data_url = utils::get_str(&data, "dataUrl");

    if data_url.is_empty() {
        return ApiResult::err(400, "dataUrl required");
    }

    // 解析 data URL：data:image/<fmt>;base64,<payload>
    let captures: Vec<&str> = data_url.splitn(2, "base64,").collect();
    if captures.len() != 2 {
        return ApiResult::err(400, "invalid dataUrl");
    }
    let header = captures[0];
    let payload = captures[1];

    let fmt = if header.contains("image/jpeg") || header.contains("image/jpg") {
        "jpg"
    } else if header.contains("image/png") {
        "png"
    } else if header.contains("image/webp") {
        "webp"
    } else {
        "png"
    };

    let bytes = match base64_decode(payload) {
        Some(b) => b,
        None => return ApiResult::err(400, "invalid base64 payload"),
    };

    let file_name = format!("avatar.{}", fmt);
    let file_path = storage::resolve_data_dir().join(&file_name);

    if std::fs::write(&file_path, &bytes).is_err() {
        return ApiResult::err(500, "写入头像文件失败");
    }

    ApiResult::ok(json!({
        "success": true,
        "path": file_path.to_string_lossy()
    }))
}

/// GET /api/clear-avatar — 清除已保存的头像文件
fn handle_clear_avatar() -> ApiResult {
    let data_dir = storage::resolve_data_dir();
    for ext in &["png", "jpg", "jpeg", "webp"] {
        let p = data_dir.join(format!("avatar.{}", ext));
        let _ = std::fs::remove_file(&p);
    }
    ApiResult::ok(json!({ "success": true }))
}
