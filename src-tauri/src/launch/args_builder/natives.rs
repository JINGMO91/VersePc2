// natives.rs — 由 args_builder.rs 拆分
#![allow(unused_imports)]

// 原生库识别、解压与完整性检查
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

/// 判断库是否为 native 库（任何平台的 natives-* 都不应进入 classpath）
pub(crate) fn is_native_library(lib: &Value, _current_os: &str) -> bool {
    // 旧版 JSON 用 natives 字段 + classifiers；新版 JSON 把原生包作为独立 classifier 条目
    lib.get("natives").is_some() || utils::get_str(lib, "name").contains(":natives-")
}

/// 原生库包使用的平台后缀（Windows/macOS/Linux）
pub(crate) fn native_os_name() -> &'static str {
    crate::platform::native_suffix()
}

/// 计算 natives 目录路径并从版本 JSON 的 native 库中解压原生二进制文件
///
/// 从 version_json.libraries 中识别 native 库，解压其中的 .dll/.so/.dylib/.jnilib
/// 到 natives 目录。带完整性校验：关键原生库齐全且 jar 未更新时跳过解压。
pub(crate) fn extract_natives_dir(
    version_json: &Value,
    version_id: &str,
    external_version_dir: Option<&Path>,
    data_dir: &Path,
) -> PathBuf {
    let natives_root = data_dir.join("natives");
    let natives_dir = natives_root.join(version_id);
    // 26.2+ 的版本 JSON 会把 java.library.path / jna / lwjgl / netty 指向 natives 下的子目录，
    // 提前创建可避免 JNA/LWJGL 在首次启动时因目录不存在而失败。
    for sub in ["java", "jna", "lwjgl", "netty"] {
        let _ = std::fs::create_dir_all(natives_dir.join(sub));
    }

    let libraries = version_json
        .get("libraries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let current_platform = dep_check::current_platform_name();
    let native_os = native_os_name();
    let is_64 = cfg!(target_pointer_width = "64");
    let is_arm64 = cfg!(target_arch = "aarch64");
    // 同一库可能同时提供通用包（x86_64）与 arm64 专用包，arm64 上优先专用包
    let has_arm_variant = libraries.iter().any(|lib| {
        let name = utils::get_str(lib, "name");
        name.contains(&format!(":natives-{}-arm64", native_os))
            || name.contains(&format!(":natives-{}-aarch64", native_os))
    });

    // 搜索路径：外部根 libraries 优先，其次本地 libraries，再 .minecraft/libraries
    let mut search_bases: Vec<PathBuf> = Vec::new();
    if let Some(ext_dir) = external_version_dir
        && let Some(root) = dep_check::find_external_root(ext_dir) {
            search_bases.push(root.join("libraries"));
        }
    let libraries_dir = data_dir.join("libraries");
    search_bases.push(libraries_dir.clone());
    let mc_lib = storage::default_minecraft_dir(data_dir.to_path_buf()).join("libraries");
    if mc_lib != libraries_dir && mc_lib.exists() {
        search_bases.push(mc_lib);
    }

    // 收集所有 native jar 路径
    let mut native_jars: Vec<PathBuf> = Vec::new();
    for lib in &libraries {
        if let Some(rules) = lib.get("rules").and_then(|v| v.as_array())
            && !dep_check::evaluate_rules(rules, false, false) {
                continue;
            }
        let lib_name = utils::get_str(lib, "name");
        let mut native_path: Option<PathBuf> = None;
        let mut is_native = false;

        if let Some(natives) = lib.get("natives").and_then(|v| v.as_object()) {
            let native_key = natives.get(current_platform.as_str()).and_then(|v| v.as_str());
            let Some(native_key) = native_key else {
                continue;
            };
            is_native = true;
            let classifier = native_key.replace("${arch}", if is_64 { "64" } else { "32" });
            if let Some(nd) = lib
                .get("downloads")
                .and_then(|d| d.get("classifiers"))
                .and_then(|c| c.get(classifier.as_str()))
                && let Some(path) = nd.get("path").and_then(|p| p.as_str())
                    && !path.is_empty() {
                        native_path = find_native_jar(&search_bases, path);
                    }
        } else if lib_name.contains(":natives-") {
            let name_parts: Vec<&str> = lib_name.split(':').collect();
            let native_suffix = name_parts.last().copied().unwrap_or("");
            if !native_suffix.starts_with("natives-") {
                continue;
            }
            let platform_native = native_suffix.strip_prefix("natives-").unwrap_or("");
            // Minecraft 的规则名是 osx，但原生包后缀是 macos/natives-macos
            let arch_ok = if is_arm64 {
                if has_arm_variant {
                    platform_native.ends_with("arm64") || platform_native.ends_with("aarch64")
                } else {
                    !platform_native.ends_with("x86") && !platform_native.ends_with("x64")
                }
            } else {
                !platform_native.ends_with("arm64")
                    && !platform_native.ends_with("aarch64")
                    && !(is_64 && platform_native.ends_with("-x86"))
            };
            let valid = arch_ok
                && (platform_native == native_os
                    || platform_native == format!("{}-legacy", native_os)
                    || platform_native == format!("{}-x64", native_os)
                    || platform_native == format!("{}-x86", native_os)
                    || platform_native == format!("{}-arm64", native_os)
                    || platform_native == format!("{}-aarch64", native_os));
            if !valid {
                continue;
            }
            is_native = true;
            if let Some(path) = lib
                .get("downloads")
                .and_then(|d| d.get("artifact"))
                .and_then(|a| a.get("path"))
                .and_then(|p| p.as_str())
                && !path.is_empty() {
                    native_path = find_native_jar(&search_bases, path);
                }
            if native_path.is_none() && name_parts.len() >= 4 {
                let group_path = name_parts[0].replace('.', "/");
                let nname = name_parts[1];
                let nver = name_parts[2];
                let nclassifier = name_parts[3];
                let njar = format!("{}-{}-{}.jar", nname, nver, nclassifier);
                native_path = find_native_jar(
                    &search_bases,
                    &format!("{}/{}/{}/{}", group_path, nname, nver, njar),
                );
            }
        }

        if !is_native {
            continue;
        }
        if let Some(np) = native_path
            && np.exists() && !native_jars.contains(&np) {
                native_jars.push(np);
            }
    }

    if native_jars.is_empty() {
        let _ = std::fs::create_dir_all(&natives_dir);
        return natives_dir;
    }

    // 完整性校验：判断关键原生库是否齐全
    let is_lwjgl2 = libraries
        .iter()
        .any(|l| utils::get_str(l, "name").starts_with("org.lwjgl.lwjgl:"));
    let critical_list: &[&str] = if is_lwjgl2 {
        &["lwjgl.dll", "lwjgl64.dll", "OpenAL32.dll", "OpenAL64.dll"]
    } else {
        &[
            "lwjgl.dll",
            "lwjgl_opengl.dll",
            "glfw.dll",
            "lwjgl_stb.dll",
            "lwjgl_tinyfd.dll",
            "openal.dll",
        ]
    };
    let native_ext = if cfg!(target_os = "windows") {
        "dll"
    } else if cfg!(target_os = "macos") {
        "dylib"
    } else {
        "so"
    };
    let is_win = cfg!(target_os = "windows");
    // macOS/Linux 的原生库名带 lib 前缀（liblwjgl.dylib / liblwjgl.so），
    // 不能沿用 Windows 的精确 DLL 名，否则每次启动都会误判缺失并重复解压。
    let critical_missing: Vec<&str> = if is_win {
        critical_list
            .iter()
            .filter(|n| !native_critical_exists(&natives_dir, n, true, native_ext))
            .copied()
            .collect()
    } else {
        // LWJGL2 没有 glfw，不能把 glfw 当作必需库，否则每次启动都会误判缺失并重复解压
        let required: &[&str] = if is_lwjgl2 {
            &["lwjgl", "openal"]
        } else {
            &["lwjgl", "glfw", "openal"]
        };
        required
            .iter()
            .filter(|key| !native_lib_exists(&natives_dir, key, native_ext))
            .copied()
            .collect()
    };

    // 判断是否需要重新解压：目录缺失 / 关键库缺失 / jar 已更新
    let needs_extract = if natives_dir.exists() && critical_missing.is_empty() {
        let max_jar_mtime = max_mtime(&native_jars);
        let max_file_mtime = max_dir_mtime(&natives_dir);
        max_jar_mtime > max_file_mtime
    } else {
        true
    };

    if needs_extract {
        if natives_dir.exists() {
            let _ = std::fs::remove_dir_all(&natives_dir);
        }
        let _ = std::fs::create_dir_all(&natives_dir);
        for jar_path in &native_jars {
            extract_native_jar(jar_path, &natives_dir);
        }
    }

    natives_dir
}

/// 在多个搜索基准目录中查找 native jar 的相对路径
pub(crate) fn find_native_jar(bases: &[PathBuf], href: &str) -> Option<PathBuf> {
    for base in bases {
        let p = base.join(href);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// 判断关键原生库文件是否存在（Windows 下直接匹配 .dll）
pub(crate) fn native_critical_exists(natives_dir: &Path, dll_name: &str, is_win: bool, ext: &str) -> bool {
    let target = if is_win {
        natives_dir.join(dll_name)
    } else {
        let base = dll_name.trim_end_matches(".dll");
        natives_dir.join(format!("{}.{}", base, ext))
    };
    target.exists()
}

/// 非 Windows：原生库通常带 lib 前缀，按"文件名包含关键字且扩展名匹配"判断
pub(crate) fn native_lib_exists(natives_dir: &Path, key: &str, ext: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(natives_dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        name.contains(key)
            && (name.ends_with(&format!(".{}", ext)) || name.ends_with(".jnilib"))
    })
}

/// 计算一组路径中的最大修改时间（毫秒）
pub(crate) fn max_mtime(paths: &[PathBuf]) -> u64 {
    paths
        .iter()
        .filter_map(|p| file_mtime_ms(p))
        .max()
        .unwrap_or(0)
}

/// 计算目录中所有文件的最大修改时间（毫秒）
pub(crate) fn max_dir_mtime(dir: &Path) -> u64 {
    let mut max = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            if let Some(m) = e.metadata().ok().and_then(|m| m.modified().ok())
                && let Ok(s) = m.duration_since(std::time::UNIX_EPOCH) {
                    max = max.max(s.as_millis() as u64);
                }
        }
    }
    max
}

/// 计算单个文件的修改时间（毫秒）
pub(crate) fn file_mtime_ms(path: &Path) -> Option<u64> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let secs = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(secs.as_millis() as u64)
}

/// 解压单个 native jar 中的原生二进制文件（.dll/.so/.dylib/.jnilib）
pub(crate) fn extract_native_jar(jar_path: &Path, natives_dir: &Path) {
    use std::io::Read;
    let file = match std::fs::File::open(jar_path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(_) => return,
    };
    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        // 统一分隔符，避免以反斜杠命名的原生产物在 macOS/Linux 上落成带 \ 的文件
        let name = entry.name().replace('\\', "/");
        if name.starts_with("META-INF")
            || name.starts_with('.')
            || name.contains("/.git")
            || name.ends_with(".sha1")
            || name.ends_with(".gitkeep")
            || name.ends_with(".gitignore")
        {
            continue;
        }
        let lower = name.to_lowercase();
        let is_native = lower.ends_with(".dll")
            || lower.ends_with(".so")
            || lower.ends_with(".dylib")
            || lower.ends_with(".jnilib");
        if !is_native {
            continue;
        }
        let file_name = match std::path::Path::new(&name).file_name() {
            Some(f) => f.to_string_lossy().to_string(),
            None => continue,
        };
        let dest_path = natives_dir.join(&file_name);
        // 已存在且大小相同则跳过
        if let Ok(existing) = std::fs::metadata(&dest_path)
            && existing.len() == entry.size() {
                continue;
            }
        let mut buf = Vec::new();
        if entry.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
            let _ = std::fs::write(&dest_path, buf);
        }
    }
}
