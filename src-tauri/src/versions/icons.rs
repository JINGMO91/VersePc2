// versions/icons.rs — 版本图标：内置方块图标与自定义图标读取
use serde_json::{json, Value};
use crate::storage;
use crate::utils;

use super::diagnose::resolve_version_json_recursive;
use super::external::is_external_version;
use super::scan::detect_loader;


// ============== 内置方块图标（编译时嵌入二进制） ==============
// 这里用 include_bytes! 嵌入，运行时永远可用
pub(crate) const ICON_GRASS: &[u8] = include_bytes!("../../../frontend/public/img/Grass.png");

pub(crate) const ICON_COMMAND_BLOCK: &[u8] = include_bytes!("../../../frontend/public/img/CommandBlock.png");

pub(crate) const ICON_GOLD_BLOCK: &[u8] = include_bytes!("../../../frontend/public/img/GoldBlock.png");

pub(crate) const ICON_COBBLESTONE: &[u8] = include_bytes!("../../../frontend/public/img/CobbleStone.png");

pub(crate) const ICON_ANVIL: &[u8] = include_bytes!("../../../frontend/public/img/Anvil.png");

pub(crate) const ICON_FABRIC: &[u8] = include_bytes!("../../../frontend/public/img/Fabric.png");

pub(crate) const ICON_NEOFORGE: &[u8] = include_bytes!("../../../frontend/public/img/NeoForge.png");

/// 根据查询参数选择内置方块图标
pub(crate) fn get_builtin_icon(version_type: &str, is_forge: bool, is_fabric: bool, is_neoforge: bool, is_modpack: bool) -> &'static [u8] {
    // 加载器优先级：NeoForge > Forge > Fabric > 整合包 > 类型默认
    if is_neoforge {
        return ICON_NEOFORGE;
    }
    if is_forge {
        return ICON_ANVIL;
    }
    if is_fabric {
        return ICON_FABRIC;
    }
    if is_modpack {
        return ICON_ANVIL;
    }
    match version_type {
        "snapshot" => ICON_COMMAND_BLOCK,
        "release" => ICON_GRASS,
        "special" => ICON_GOLD_BLOCK,
        "old_beta" | "old_alpha" => ICON_COBBLESTONE,
        _ => ICON_GRASS,
    }
}

/// Tauri 命令：get_version_icon
/// 前端通过 invoke('get_version_icon', { id, versionType, forge, fabric, neoforge, modpack, extDir }) 调用
/// 返回 { data_url, mime } — 自定义图标返回 base64，方块图标也转 base64
/// 注：rename_all = "camelCase" 让前端可用 camelCase 参数名（versionType/extDir），
///     Rust 端参数仍是 snake_case（version_type/ext_dir）
#[tauri::command(rename_all = "camelCase")]
pub async fn get_version_icon(
    id: String,
    version_type: Option<String>,
    forge: Option<bool>,
    fabric: Option<bool>,
    neoforge: Option<bool>,
    modpack: Option<bool>,
    ext_dir: Option<String>,
) -> Value {
    println!("[version_icon] called: id={}, version_type={:?}, forge={}, fabric={}, neoforge={}, modpack={}, ext_dir={:?}",
        id, version_type, forge.unwrap_or(false), fabric.unwrap_or(false),
        neoforge.unwrap_or(false), modpack.unwrap_or(false), ext_dir);
    if id.is_empty() {
        println!("[version_icon] empty id, returning empty");
        return json!({ "success": false, "data_url": "" });
    }

    // 清洗 ID（去掉 " [外部N]" 后缀）
    let clean_id = id.split(" [外部").next().unwrap_or(&id).to_string();
    let is_forge = forge.unwrap_or(false);
    let is_fabric = fabric.unwrap_or(false);
    let is_neoforge = neoforge.unwrap_or(false);
    let is_modpack = modpack.unwrap_or(false);
    let v_type = version_type.unwrap_or_else(|| "release".to_string());

    // 1. 在版本目录找自定义图标（icon.png / pack.png / logo.png / PCL/Logo.png）
    let data_dir = storage::resolve_data_dir();
    let internal_dir = data_dir.join("versions").join(&clean_id);
    let icon_file_names = ["icon.png", "pack.png", "logo.png"];
    let pcl_logo = std::path::Path::new("PCL").join("Logo.png");

    // 优先级 1：内部版本目录
    let mut custom_icon: Option<(Vec<u8>, String)> = None;

    // PCL/Logo.png
    let pcl_path = internal_dir.join(&pcl_logo);
    if pcl_path.exists()
        && let Ok(data) = std::fs::read(&pcl_path) {
            custom_icon = Some((data, "image/png".to_string()));
        }
    // icon.png / pack.png / logo.png
    if custom_icon.is_none() {
        for fn_name in &icon_file_names {
            let p = internal_dir.join(fn_name);
            if p.exists()
                && let Ok(data) = std::fs::read(&p) {
                    let mime = if fn_name.ends_with(".jpg") || fn_name.ends_with(".jpeg") {
                        "image/jpeg"
                    } else {
                        "image/png"
                    };
                    custom_icon = Some((data, mime.to_string()));
                    break;
                }
        }
    }

    // 优先级 2：外部目录
    if custom_icon.is_none()
        && let Some(ext) = &ext_dir
            && !ext.is_empty() {
                let ext_path = std::path::Path::new(ext);
                // extDir 自身
                let pcl_path = ext_path.join(&pcl_logo);
                if pcl_path.exists()
                    && let Ok(data) = std::fs::read(&pcl_path) {
                        custom_icon = Some((data, "image/png".to_string()));
                    }
                if custom_icon.is_none() {
                    for fn_name in &icon_file_names {
                        let p = ext_path.join(fn_name);
                        if p.exists()
                            && let Ok(data) = std::fs::read(&p) {
                                let mime = if fn_name.ends_with(".jpg") || fn_name.ends_with(".jpeg") {
                                    "image/jpeg"
                                } else {
                                    "image/png"
                                };
                                custom_icon = Some((data, mime.to_string()));
                                break;
                            }
                    }
                }
                // extDir 上两级
                if custom_icon.is_none()
                    && let Some(grandparent) = ext_path.parent().and_then(|p| p.parent()) {
                        let pcl_path = grandparent.join(&pcl_logo);
                        if pcl_path.exists()
                            && let Ok(data) = std::fs::read(&pcl_path) {
                                custom_icon = Some((data, "image/png".to_string()));
                            }
                        if custom_icon.is_none() {
                            for fn_name in &icon_file_names {
                                let p = grandparent.join(fn_name);
                                if p.exists()
                                    && let Ok(data) = std::fs::read(&p) {
                                        let mime = if fn_name.ends_with(".jpg") || fn_name.ends_with(".jpeg") {
                                            "image/jpeg"
                                        } else {
                                            "image/png"
                                        };
                                        custom_icon = Some((data, mime.to_string()));
                                        break;
                                    }
                            }
                        }
                    }
            }

    // 优先级 3：.minecraft/versions/<id>
    if custom_icon.is_none()
        && let Some(home) = dirs::home_dir() {
            let mc_versions_dir = storage::default_minecraft_dir(home.join(".minecraft"))
                .join("versions")
                .join(&clean_id);
            let pcl_path = mc_versions_dir.join(&pcl_logo);
            if pcl_path.exists()
                && let Ok(data) = std::fs::read(&pcl_path) {
                    custom_icon = Some((data, "image/png".to_string()));
                }
            if custom_icon.is_none() {
                for fn_name in &icon_file_names {
                    let p = mc_versions_dir.join(fn_name);
                    if p.exists()
                        && let Ok(data) = std::fs::read(&p) {
                            let mime = if fn_name.ends_with(".jpg") || fn_name.ends_with(".jpeg") {
                                "image/jpeg"
                            } else {
                                "image/png"
                            };
                            custom_icon = Some((data, mime.to_string()));
                            break;
                        }
                }
            }
        }

    // 4. 自定义图标：转 data URL 返回
    if let Some((data, mime)) = custom_icon {
        let data_url = utils::bytes_to_data_url(&data, &mime);
        return json!({ "success": true, "data_url": data_url, "is_custom": true });
    }

    // 5. 无自定义图标：用内置方块图标
    let icon_bytes = get_builtin_icon(&v_type, is_forge, is_fabric, is_neoforge, is_modpack);
    let data_url = utils::bytes_to_data_url(icon_bytes, "image/png");
    json!({ "success": true, "data_url": data_url, "is_custom": false })
}

/// GET /api/version-icon — 读取版本图标文件（base64 data URL）
///
/// 参数：versionId（必填）、type（版本类型）、forge、fabric、neoforge、modpack（可选）
/// 查找版本目录下的 icon.png / icon.jpg / icon.jpeg / pack.png / logo.png
/// 找到则读为 base64 返回 { success, dataUrl }
/// 找不到自定义图标时，用内置方块图标兜底
pub(crate) fn handle_version_icon(params: &Option<Value>) -> crate::api::ApiResult {
    use crate::api::ApiResult;

    let version_id = params
        .as_ref()
        .and_then(|p| p.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if version_id.is_empty() {
        return ApiResult::err(400, "Missing versionId");
    }

    // 读取前端传的可选参数（用于远程版本无法解析 JSON 时兜底）
    let version_type = params.as_ref()
        .and_then(|p| p.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("release");
    let is_forge = params.as_ref()
        .and_then(|p| p.get("forge"))
        .and_then(|v| v.as_str())
        .map(|s| s == "true" || s == "1")
        .unwrap_or(false);
    let is_fabric = params.as_ref()
        .and_then(|p| p.get("fabric"))
        .and_then(|v| v.as_str())
        .map(|s| s == "true" || s == "1")
        .unwrap_or(false);
    let is_neoforge = params.as_ref()
        .and_then(|p| p.get("neoforge"))
        .and_then(|v| v.as_str())
        .map(|s| s == "true" || s == "1")
        .unwrap_or(false);
    let is_modpack = params.as_ref()
        .and_then(|p| p.get("modpack"))
        .and_then(|v| v.as_str())
        .map(|s| s == "true" || s == "1")
        .unwrap_or(false);

    let is_external = is_external_version(version_id);
    let clean_id = if is_external {
        version_id.split(" [外部").next().unwrap_or(version_id).to_string()
    } else {
        version_id.to_string()
    };

    let data_dir = storage::resolve_data_dir();
    let version_dir = data_dir.join("versions").join(&clean_id);

    // 1. 找自定义图标
    let icon_candidates = ["icon.png", "icon.jpg", "icon.jpeg", "pack.png", "logo.png"];
    for fname in &icon_candidates {
        let icon_path = version_dir.join(fname);
        if icon_path.exists()
            && let Ok(data) = std::fs::read(&icon_path) {
                let mime = if fname.ends_with(".jpg") || fname.ends_with(".jpeg") {
                    "image/jpeg"
                } else {
                    "image/png"
                };
                let data_url = utils::bytes_to_data_url(&data, mime);
                return ApiResult::ok(json!({
                    "success": true,
                    "dataUrl": data_url
                }));
            }
    }

    // 2. 找不到自定义图标：根据版本 JSON 推断加载器类型
    let versions_dir = data_dir.join("versions");
    let (detected_type, detected_forge, detected_fabric, detected_neoforge) =
        if let Some(version_json) = resolve_version_json_recursive(&clean_id, &versions_dir) {
            let vt = utils::get_str(&version_json, "type");
            let inherits_from = utils::get_str(&version_json, "inheritsFrom");
            let (df, dg, dn, _, _, _, _) =
                detect_loader(&version_json, &clean_id, &inherits_from, None);
            (vt, dg, df, dn)
        } else {
            // 远程版本（未安装）：用前端传的参数
            (version_type.to_string(), is_forge, is_fabric, is_neoforge)
        };

    let icon_bytes = get_builtin_icon(&detected_type, detected_forge, detected_fabric, detected_neoforge, is_modpack);
    let data_url = utils::bytes_to_data_url(icon_bytes, "image/png");
    ApiResult::ok(json!({
        "success": true,
        "dataUrl": data_url
    }))
}
