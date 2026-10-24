// env.rs — 由 args_builder.rs 拆分
#![allow(unused_imports)]

// 游戏目录、环境探测与目录准备
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use crate::storage;
use crate::utils;
use super::dep_check;
use crate::launch::memory::{
    resolve_max_memory, resolve_memory_mode, MemoryMode,
};
use super::*;

/// 解析版本游戏目录
pub(crate) fn resolve_game_dir(
    version_id: &str,
    custom_game_dir: Option<&str>,
    external_version_dir: Option<&Path>,
    settings: &Value,
    versions_dir: &Path,
    data_dir: &Path,
) -> PathBuf {
    if let Some(custom) = custom_game_dir
        && !custom.is_empty() {
            return PathBuf::from(custom);
        }
    if let Some(ext_dir) = external_version_dir {
        return ext_dir.to_path_buf();
    }
    if resolve_version_isolation(version_id) {
        return versions_dir.join(version_id);
    }
    let settings_game_dir = utils::get_str(settings, "gameDir");
    if !settings_game_dir.is_empty() {
        return PathBuf::from(settings_game_dir);
    }
    data_dir.to_path_buf()
}

/// 简化版版本隔离判定
pub(crate) fn resolve_version_isolation(version_id: &str) -> bool {
    if version_id.is_empty() || version_id.contains(" [外部") {
        return !version_id.is_empty();
    }
    let settings = storage::load_settings();
    let ver_settings = storage::load_version_settings(version_id, false);
    let ver_isolation = utils::get_str(&ver_settings, "isolation");
    let mut effective: bool;
    if ver_isolation == "on" {
        effective = true;
    } else if ver_isolation == "off" {
        effective = false;
    } else {
        effective = settings
            .get("versionIsolation")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
    }
    // 关闭隔离时若已有 mods/saves 子目录则保持隔离
    if !effective {
        let data_dir = storage::resolve_data_dir();
        let version_dir = data_dir.join("versions").join(version_id);
        let mods_dir = version_dir.join("mods");
        let saves_dir = version_dir.join("saves");
        if mods_dir.exists() && dir_has_visible_files(&mods_dir) {
            effective = true;
        }
        if !effective && saves_dir.exists() && dir_has_subdirs(&saves_dir) {
            effective = true;
        }
    }
    effective
}

pub(crate) fn dir_has_visible_files(dir: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with('.') {
                return true;
            }
        }
    }
    false
}

pub(crate) fn dir_has_subdirs(dir: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata()
                && meta.is_dir() {
                    return true;
                }
        }
    }
    false
}

/// 预创建游戏目录常用子目录
pub(crate) fn ensure_game_dirs(game_dir: &Path) {
    let _ = std::fs::create_dir_all(game_dir);
    for sub in ["mods", "resourcepacks", "shaderpacks", "saves", "config", "logs", "crash-reports"] {
        let _ = std::fs::create_dir_all(game_dir.join(sub));
    }
}

/// 复制 Forge log4j2.xml 到游戏目录
pub(crate) fn copy_forge_log4j(version_id: &str, versions_dir: &Path, game_dir: &Path) {
    let src = versions_dir.join(version_id).join("log4j2.xml");
    if !src.exists() {
        return;
    }
    let dst = game_dir.join("log4j2.xml");
    if dst.exists() {
        return;
    }
    let _ = std::fs::copy(&src, &dst);
}

/// 解析分辨率字符串（如 "1280x720"）
pub(crate) fn parse_resolution(resolution: &str) -> (u32, u32) {
    let parts: Vec<&str> = resolution.split('x').collect();
    let w = parts.first().and_then(|s| s.parse().ok()).unwrap_or(854);
    let h = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(480);
    (w, h)
}

/// 生成离线 access token（JWT 格式，避免 BootstrapLauncher Base64 解析崩溃）
pub(crate) fn generate_offline_access_token(uuid: &str, player_name: &str) -> String {
    use base64::{engine::general_purpose, Engine as _};
    let header = general_purpose::URL_SAFE_NO_PAD
        .encode(serde_json::json!({"alg":"none","typ":"JWT"}).to_string());
    let payload = general_purpose::URL_SAFE_NO_PAD.encode(
        serde_json::json!({
            "sub": uuid,
            "iss": "VersePC",
            "name": player_name,
            "offline": true
        })
        .to_string(),
    );
    format!("{}.{}.offline", header, payload)
}

/// 统计 mods 目录中的 .jar 文件数量
pub(crate) fn count_mods(game_dir: &Path) -> u64 {
    let mods_dir = game_dir.join("mods");
    if !mods_dir.exists() {
        return 0;
    }
    let mut count = 0u64;
    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".jar") && !name.ends_with(".jar.disabled") {
                count += 1;
            }
        }
    }
    count
}

/// 检测整合包 mods 目录是否包含 CustomSkinLoader（万用皮肤补丁）
/// 文件名通常形如 "[万用皮肤补丁] CustomSkinLoader_Universal-*.jar" 或 "CustomSkinLoader-*.jar"
pub(crate) fn has_custom_skin_loader(game_dir: &Path) -> bool {
    let mods_dir = game_dir.join("mods");
    if !mods_dir.exists() {
        return false;
    }
    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.ends_with(".jar")
                && !name.ends_with(".jar.disabled")
                && name.contains("customskinloader")
            {
                return true;
            }
        }
    }
    false
}
