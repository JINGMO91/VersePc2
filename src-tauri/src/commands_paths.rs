// commands_paths.rs — 路径获取命令（默认 Mod 目录与下载保存目录）
use serde_json::{json, Value};

use crate::storage;

// ============== 路径获取命令 ==============

#[tauri::command]
pub(crate) fn get_default_mod_path(
    state: tauri::State<storage::Store>,
    version_id: Option<String>,
) -> Value {
    let data_dir = storage::resolve_data_dir();
    let versions_dir = data_dir.join("versions");
    let settings_file = data_dir.join("settings.json");
    let minecraft_dir = storage::default_minecraft_dir(data_dir.clone());

    // 读取 settings.json
    let settings: Value = std::fs::read_to_string(&settings_file)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or(Value::Null);

    let requested = version_id.unwrap_or_default();

    let mut version_id = settings
        .get("selectedVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 没有选中版本则取 versions 目录下第一个子目录
    if version_id.is_empty()
        && let Ok(entries) = std::fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir()
                    && let Some(name) = entry.file_name().to_str() {
                        version_id = name.to_string();
                        break;
                    }
            }
        }

    // 显式传入且为已安装版本目录时，以传入版本为准
    if !requested.is_empty() {
        let cand = versions_dir.join(&requested);
        if cand.is_dir() {
            version_id = requested;
        }
    }

    // 没有版本：回退到 .minecraft/mods
    if version_id.is_empty() {
        let default_path = minecraft_dir.join("mods");
        let _ = std::fs::create_dir_all(&default_path);
        return json!({ "success": true, "path": default_path.to_string_lossy() });
    }

    // 判断游戏目录
    let game_dir;
    if version_id.contains("[外部]") {
        let folders = state
            .get("externalVersionFolders")
            .and_then(|v| v.as_array().cloned());
        let clean_id = version_id.replace(" [外部]", "").replace("[外部]", "");
        let mut found = None;
        if let Some(arr) = folders {
            for folder in arr {
                if let Some(fs) = folder.as_str() {
                    let candidate = std::path::PathBuf::from(fs).join(&clean_id);
                    if candidate.exists() {
                        found = Some(candidate);
                        break;
                    }
                    let candidate2 = std::path::PathBuf::from(fs).join(&version_id);
                    if candidate2.exists() {
                        found = Some(candidate2);
                        break;
                    }
                }
            }
        }
        game_dir = found.unwrap_or_else(|| versions_dir.join(clean_id));
    } else {
        // 读取版本设置判断隔离
        let ver_settings_file = versions_dir.join(&version_id).join("version-settings.json");
        let mut effective_isolation: Option<bool> = None;
        if let Ok(content) = std::fs::read_to_string(&ver_settings_file)
            && let Ok(vs) = serde_json::from_str::<Value>(&content) {
                match vs.get("isolation").and_then(|v| v.as_str()) {
                    Some("on") => effective_isolation = Some(true),
                    Some("off") => effective_isolation = Some(false),
                    _ => {}
                }
            }
        if effective_isolation.is_none() {
            effective_isolation = Some(
                settings
                    .get("versionIsolation")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
            );
        }
        let eff = effective_isolation.unwrap_or(true);
        if !eff {
            let version_dir = versions_dir.join(&version_id);
            let has_mods = version_dir.join("mods").exists();
            let has_saves = version_dir.join("saves").exists();
            let has_config = version_dir.join("config").exists();
            if has_mods || has_saves || has_config {
                game_dir = version_dir;
            } else {
                game_dir = settings
                    .get("gameDir")
                    .and_then(|v| v.as_str())
                    .map(std::path::PathBuf::from)
                    .unwrap_or(data_dir);
            }
        } else {
            game_dir = versions_dir.join(&version_id);
        }
    }

    let default_path = game_dir.join("mods");
    let _ = std::fs::create_dir_all(&default_path);
    eprintln!("[get_default_mod_path] version={} path={}", version_id, default_path.display());
    json!({ "success": true, "path": default_path.to_string_lossy() })
}

/// 解析下载 Mod 时的默认保存文件夹。
/// 查找顺序：
///   1. 当前选中版本兼容（游戏版本 + 加载器匹配）时，使用其 mods 文件夹
///   2. 否则在全部已安装版本中找兼容版本，按其 mods 文件夹的修改时间、文件数择优
///   3. 否则回退到 MC 根目录的 mods 文件夹
/// 返回 { path, compatible, selectedCompatible }
#[tauri::command]
pub(crate) fn get_default_mod_save_folder(game_version: String, loader: String) -> Value {
    let settings = storage::load_settings();
    let data_dir = storage::resolve_data_dir();

    let allowed = match loader.to_lowercase().as_str() {
        "forge" => 1,
        "liteloader" => 2,
        "fabric" => 4,
        "neoforge" => 16,
        _ => 0,
    };
    eprintln!(
        "[mod-folder] 输入: game={:?} loader={:?} allowed_mask={}",
        game_version, loader, allowed
    );

    // 收集已安装版本：(id, 原版版本名, 加载器掩码)
    let mut versions: Vec<(String, String, i32)> = Vec::new();
    for v in crate::versions::scan_local_versions()
        .into_iter()
        .chain(crate::versions::scan_external_versions())
    {
        let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
        if id.is_empty() {
            continue;
        }
        let base = v.get("baseVersion").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let mut mask = 0i32;
        if v.get("isForge").and_then(|x| x.as_bool()).unwrap_or(false) {
            mask |= 1;
        }
        if v.get("isFabric").and_then(|x| x.as_bool()).unwrap_or(false) {
            mask |= 4;
        }
        if v.get("isNeoForge").and_then(|x| x.as_bool()).unwrap_or(false) {
            mask |= 16;
        }
        if v.get("isLiteLoader").and_then(|x| x.as_bool()).unwrap_or(false) {
            mask |= 2;
        }
        let vanilla = if base.is_empty() {
            id.split('-').next().unwrap_or("").to_string()
        } else {
            base
        };
        versions.push((id, vanilla, mask));
    }

    let loader_ok = |mask: i32| allowed == 0 || (mask & allowed) != 0;
    let match_tier = |vanilla: &str, masked: i32| -> i32 {
        if !loader_ok(masked) {
            return -1;
        }
        let base_known = crate::resource::mcversion::is_mc_version(vanilla);
        if base_known
            && !game_version.is_empty()
            && crate::resource::mcversion::version_snapshot_match(&game_version, vanilla)
        {
            return 0;
        }
        if base_known
            && !game_version.is_empty()
            && crate::resource::mcversion::version_prefix_match(&game_version, vanilla)
        {
            return 1;
        }
        if !base_known || game_version.is_empty() {
            return 2;
        }
        -1
    };

    let selected_id = settings
        .get("selectedVersion")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    let mut selected_tier = -1;
    let mut selected_path = String::new();
    for inst in &versions {
        if inst.0 == selected_id {
            selected_tier = match_tier(&inst.1, inst.2);
            selected_path = crate::mods::list::resolve_mods_dir_for(&settings, &inst.0)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            break;
        }
    }
    let selected_compatible = selected_tier == 0 || selected_tier == 1;
    let mut matched_version = selected_compatible;

    let mut path = String::new();
    if (selected_tier == 0 || selected_tier == 1) && !selected_path.is_empty() {
        path = selected_path;
    }

    for t in 0..3 {
        if !path.is_empty() {
            break;
        }
        let mut bm: i64 = -1;
        let mut bc: usize = 0;
        let mut bp = String::new();
        for inst in &versions {
            if match_tier(&inst.1, inst.2) != t {
                continue;
            }
            let Some(d) = crate::mods::list::resolve_mods_dir_for(&settings, &inst.0) else {
                continue;
            };
            let mtime = std::fs::metadata(&d)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|x| x.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|x| x.as_secs() as i64)
                .unwrap_or(0);
            let count = std::fs::read_dir(&d).map(|rd| rd.count()).unwrap_or(0);
            let d = d.to_string_lossy().to_string();
            if bp.is_empty() || mtime > bm || (mtime == bm && count > bc) {
                bm = mtime;
                bc = count;
                bp = d;
            }
        }
        if !bp.is_empty() {
            path = bp;
            matched_version = true;
        }
    }

    if path.is_empty() {
        let game_dir = settings
            .get("gameDir")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| data_dir.clone());
        path = game_dir.join("mods").to_string_lossy().to_string();
    }

    let debug_versions: Vec<Value> = versions
        .iter()
        .map(|(id, vanilla, mask)| json!({ "id": id, "vanilla": vanilla, "mask": mask }))
        .collect();

    json!({
        "success": true,
        "path": path,
        "compatible": matched_version,
        "selectedCompatible": selected_compatible,
        "selectedVersion": selected_id,
        "versions": debug_versions
    })
}
