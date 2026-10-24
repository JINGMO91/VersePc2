// native.rs — 由 dep_check.rs 拆分
#![allow(unused_imports)]

// 新旧原生库完整性检查
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use regex::Regex;
use crate::java;
use crate::storage;
use crate::utils;
use super::*;

/// 检查新格式 native（classifier 以 natives- 开头）
/// 返回 Some(MissingFile) 表示缺失，None 表示存在或跳过
pub(crate) fn check_native_lib(
    lib: &Value,
    libraries_dir: &Path,
    external_version_dir: Option<&Path>,
    _current_platform: &str,
) -> Option<MissingFile> {
    let name = utils::get_str(lib, "name");
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 4 {
        return None;
    }
    let native_suffix = parts[3];
    let platform_native = native_suffix.strip_prefix("natives-").unwrap_or("");
    // 规则中的平台名是 osx，但原生产物后缀使用 macos，统一由 platform 模块转换
    let native_os = crate::platform::native_suffix();
    // 架构匹配：arm64 优先专用包，x86_64 不接受 arm 变体
    let is_valid_platform = if cfg!(target_arch = "aarch64") {
        platform_native == native_os
            || platform_native == format!("{}-arm64", native_os)
            || platform_native == format!("{}-aarch64", native_os)
    } else if cfg!(target_arch = "x86") {
        platform_native == native_os || platform_native == format!("{}-x86", native_os)
    } else {
        platform_native == native_os
            || (platform_native == format!("{}-x64", native_os))
    };
    if !is_valid_platform {
        return None;
    }

    // 优先从 downloads.artifact.path 取路径
    let mut native_path: Option<PathBuf> = None;
    if let Some(artifact_path) = lib.get("downloads").and_then(|v| v.get("artifact")).and_then(|v| v.get("path")).and_then(|v| v.as_str()) {
        let p = safe_lib_path(artifact_path, libraries_dir);
        if let Some(p) = p {
            if !p.exists() {
                if let Some(ext_dir) = external_version_dir
                    && let Some(root) = find_external_root(ext_dir) {
                        let ext_p = safe_lib_path(artifact_path, &root.join("libraries"));
                        if let Some(ext_p) = ext_p
                            && ext_p.exists() {
                                native_path = Some(ext_p);
                            }
                    }
            } else {
                native_path = Some(p);
            }
        }
    }

    if native_path.is_none() && parts.len() >= 4 {
        // 按 maven 坐标构造本地路径
        let group_path = parts[0].replace('.', std::path::MAIN_SEPARATOR_STR);
        let jar_name = format!("{}-{}-{}.jar", parts[1], parts[2], parts[3]);
        let local_path = libraries_dir.join(&group_path).join(parts[1]).join(parts[2]).join(&jar_name);
        if local_path.exists() {
            native_path = Some(local_path);
        } else if let Some(ext_dir) = external_version_dir
            && let Some(root) = find_external_root(ext_dir) {
                let ext_path = root.join("libraries").join(&group_path).join(parts[1]).join(parts[2]).join(&jar_name);
                if ext_path.exists() {
                    native_path = Some(ext_path);
                }
            }
    }

    match native_path {
        Some(p) if p.exists() => {
            // 校验 SHA1（如果提供）
            let sha1 = lib.get("downloads").and_then(|v| v.get("artifact")).and_then(|v| v.get("sha1")).and_then(|v| v.as_str()).unwrap_or("");
            if !sha1.is_empty()
                && let Some(actual) = utils::calculate_sha1(&p)
                    && actual != sha1 {
                        let url = lib.get("downloads").and_then(|v| v.get("artifact")).and_then(|v| v.get("url")).and_then(|v| v.as_str()).unwrap_or("");
                        let size = lib.get("downloads").and_then(|v| v.get("artifact")).and_then(|v| v.get("size")).and_then(|v| v.as_u64()).unwrap_or(0);
                        return Some(MissingFile {
                            kind: "native".to_string(),
                            url: url.to_string(),
                            path: p.to_string_lossy().to_string(),
                            sha1: sha1.to_string(),
                            size,
                            name,
                            desc: String::new(),
                            message: String::new(),
                        });
                    }
            None
        }
        _ => {
            // 缺失：构造下载 URL
            let group_maven = parts[0].replace('.', "/");
            let jar_name = format!("{}-{}-{}.jar", parts[1], parts[2], parts[3]);
            let url = lib.get("downloads").and_then(|v| v.get("artifact")).and_then(|v| v.get("url")).and_then(|v| v.as_str()).unwrap_or("");
            let base_url = if !url.is_empty() {
                url.to_string()
            } else {
                let lib_url = utils::get_str(lib, "url");
                if !lib_url.is_empty() {
                    lib_url
                } else {
                    "https://libraries.minecraft.net/".to_string()
                }
            };
            let native_url = if !url.is_empty() {
                url.to_string()
            } else {
                format!("{}{}/{}/{}/{}", base_url, group_maven, parts[1], parts[2], jar_name)
            };
            let local_path = libraries_dir.join(parts[0].replace('.', std::path::MAIN_SEPARATOR_STR)).join(parts[1]).join(parts[2]).join(&jar_name);
            let sha1 = lib.get("downloads").and_then(|v| v.get("artifact")).and_then(|v| v.get("sha1")).and_then(|v| v.as_str()).unwrap_or("");
            let size = lib.get("downloads").and_then(|v| v.get("artifact")).and_then(|v| v.get("size")).and_then(|v| v.as_u64()).unwrap_or(0);
            Some(MissingFile {
                kind: "native".to_string(),
                url: native_url,
                path: local_path.to_string_lossy().to_string(),
                sha1: sha1.to_string(),
                size,
                name,
                desc: String::new(),
                message: String::new(),
            })
        }
    }
}

/// 检查旧格式 native（lib.natives 字典 + lib.downloads.classifiers）
pub(crate) fn check_legacy_native(
    lib: &Value,
    libraries_dir: &Path,
    external_version_dir: Option<&Path>,
    current_platform: &str,
) -> Option<MissingFile> {
    let natives = lib.get("natives").and_then(|v| v.as_object())?;
    let native_key = natives.get(current_platform).and_then(|v| v.as_str())?;
    let classifier = if cfg!(target_pointer_width = "64") {
        native_key.replace("${arch}", "64")
    } else {
        native_key.replace("${arch}", "32")
    };
    let native_download = lib.get("downloads").and_then(|v| v.get("classifiers")).and_then(|v| v.get(&classifier));
    let native_download = native_download?;

    let path_str = utils::get_str(native_download, "path");
    if path_str.is_empty() {
        return None;
    }
    let mut native_path = libraries_dir.join(&path_str);
    if !native_path.exists()
        && let Some(ext_dir) = external_version_dir
            && let Some(root) = find_external_root(ext_dir) {
                let ext_path = root.join("libraries").join(&path_str);
                if ext_path.exists() {
                    native_path = ext_path;
                }
            }

    if native_path.exists() {
        // 校验 SHA1
        let sha1 = utils::get_str(native_download, "sha1");
        if !sha1.is_empty() {
            if let Some(actual) = utils::calculate_sha1(&native_path)
                && actual == sha1 {
                    return None;
                }
        } else {
            return None;
        }
    }

    let url = utils::get_str(native_download, "url");
    let size = native_download.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
    Some(MissingFile {
        kind: "native".to_string(),
        url,
        path: native_path.to_string_lossy().to_string(),
        sha1: utils::get_str(native_download, "sha1"),
        size,
        name: format!("{} ({})", utils::get_str(lib, "name"), classifier),
        desc: String::new(),
        message: String::new(),
    })
}
