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
/// 到 natives 目录。带完整性校验：jar 内所有原生文件齐全且大小一致时跳过解压。
pub(crate) fn extract_natives_dir(
    version_json: &Value,
    version_id: &str,
    external_version_dir: Option<&Path>,
    data_dir: &Path,
) -> (PathBuf, Vec<String>) {
    let natives_root = data_dir.join("natives");
    // 目录名使用版本 ID + 外部目录的短哈希，而不是原始版本名：
    // 中文/超长整合包名会让 java.library.path 过长或包含非 ASCII 字符，
    // 部分 Windows 环境下会导致原生库加载失败（游戏退出码 -3）。
    let natives_dir = natives_root.join(natives_cache_name(version_id, external_version_dir));
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
        return (natives_dir, Vec::new());
    }

    // 按 native jar 内实际存在的文件做完整性校验，而不是硬编码 glfw/tinyfd 等名单。
    // 26.3 改用 SDL3，根本没有 glfw.dll，旧名单会让每次启动都误判缺失并反复清空解压。
    let expected = expected_native_files(&native_jars);

    // 目录缺失 / 任一期望文件缺失或大小不符 / jar 比解压结果新 → 需要解压。
    let needs_extract = !natives_dir.exists()
        || expected
            .iter()
            .any(|(name, size)| !native_file_matches(&natives_dir, name, *size))
        || max_mtime(&native_jars) > max_dir_mtime(&natives_dir);

    if needs_extract {
        let _ = std::fs::create_dir_all(&natives_dir);
        // 原地补齐缺失文件，不再整目录删除：避免杀软/上一个游戏实例占用 DLL 时
        // 解压到一半失败，最终以退出码 -3 崩溃。
        for jar_path in &native_jars {
            extract_native_jar(jar_path, &natives_dir);
        }
    }

    let missing: Vec<String> = expected
        .iter()
        .filter(|(name, size)| !native_file_matches(&natives_dir, name, *size))
        .map(|(name, _)| name.clone())
        .collect();

    if !missing.is_empty() {
        write_natives_error_log(data_dir, version_id, &natives_dir, &missing);
    }

    (natives_dir, missing)
}

/// 原生库缓存目录名：版本 ID + 外部目录的短 SHA1（纯 ASCII，避免路径过长/中文）
fn natives_cache_name(version_id: &str, external_version_dir: Option<&Path>) -> String {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(version_id.as_bytes());
    if let Some(dir) = external_version_dir {
        hasher.update(b"|");
        hasher.update(dir.to_string_lossy().as_bytes());
    }
    let digest = hasher.finalize();
    let mut name = String::from("n-");
    for byte in digest.iter().take(12) {
        name.push_str(&format!("{:02x}", byte));
    }
    name
}

/// 计算 native jar 中应解压出的文件清单（文件名 → 大小），与解压逻辑保持一致：
/// 同名文件以最后一个非空条目为准。
fn expected_native_files(native_jars: &[PathBuf]) -> Vec<(String, u64)> {
    use std::collections::BTreeMap;
    let mut expected: BTreeMap<String, u64> = BTreeMap::new();
    for jar_path in native_jars {
        let Ok(file) = std::fs::File::open(jar_path) else {
            continue;
        };
        let Ok(mut archive) = zip::ZipArchive::new(file) else {
            continue;
        };
        for i in 0..archive.len() {
            let Ok(entry) = archive.by_index(i) else {
                continue;
            };
            let name = entry.name().replace('\\', "/");
            if name.starts_with("META-INF")
                || name.starts_with('.')
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
            if !is_native || entry.size() == 0 {
                continue;
            }
            let Some(file_name) = std::path::Path::new(&name)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
            else {
                continue;
            };
            expected.insert(file_name, entry.size());
        }
    }
    expected.into_iter().collect()
}

/// 目标文件是否存在且大小与 jar 内条目一致
fn native_file_matches(natives_dir: &Path, file_name: &str, size: u64) -> bool {
    std::fs::metadata(natives_dir.join(file_name))
        .map(|meta| meta.len() == size)
        .unwrap_or(false)
}

/// 解压不完整时写一份诊断日志，并打印到终端，便于用户反馈时定位
fn write_natives_error_log(
    data_dir: &Path,
    version_id: &str,
    natives_dir: &Path,
    missing: &[String],
) {
    let logs_dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let content = format!(
        "[{}] 原生库解压不完整\n版本: {}\n目录: {}\n缺失/大小不符: {}\n",
        utils::now_iso(),
        version_id,
        natives_dir.display(),
        missing.join(", ")
    );
    let _ = std::fs::write(logs_dir.join("natives-extract-error.log"), &content);
    eprintln!("[natives] {}", content.replace('\n', " "));
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
        if entry.read_to_end(&mut buf).is_ok() && !buf.is_empty()
            && let Err(e) = std::fs::write(&dest_path, buf)
        {
            eprintln!("[natives] 写入失败 {}: {}", dest_path.display(), e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use zip::write::SimpleFileOptions;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "verse-natives-{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_native_jar(path: &Path, files: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, data) in files {
            use std::io::Write;
            zip.start_file(*name, opts).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn cache_name_is_short_ascii_and_path_stable() {
        let name = natives_cache_name("落幕曲1.6.6.1安装包（拖入启动器安装）", None);
        assert!(name.starts_with("n-"));
        assert_eq!(name.len(), 26, "n- + 24 位十六进制");
        assert!(name.is_ascii());
        assert_eq!(name, natives_cache_name("落幕曲1.6.6.1安装包（拖入启动器安装）", None));
        assert_ne!(name, natives_cache_name("26.3", None));
        assert_ne!(
            natives_cache_name("26.3", None),
            natives_cache_name("26.3", Some(Path::new(r"D:\external\26.3")))
        );
    }

    #[test]
    fn expected_native_files_match_jar_entries_without_glfw_assumption() {
        let dir = temp_dir("expected");
        let jar = dir.join("natives.jar");
        write_native_jar(
            &jar,
            &[
                ("windows/x64/SDL3.dll", b"abc"),
                ("windows/x64/lwjgl_opengl.dll", b"12345"),
                ("META-INF/MANIFEST.MF", b"ignored"),
            ],
        );

        let expected = expected_native_files(std::slice::from_ref(&jar));
        assert!(expected.iter().any(|(name, size)| name == "SDL3.dll" && *size == 3));
        assert!(expected.iter().any(|(name, size)| name == "lwjgl_opengl.dll" && *size == 5));
        assert!(!expected.iter().any(|(name, _)| name == "glfw.dll"));

        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        extract_native_jar(&jar, &out);
        assert!(expected
            .iter()
            .all(|(name, size)| native_file_matches(&out, name, *size)));

        fs::write(out.join("SDL3.dll"), b"wrong-size").unwrap();
        assert!(!native_file_matches(&out, "SDL3.dll", 3));
        fs::remove_file(out.join("lwjgl_opengl.dll")).unwrap();
        assert!(!native_file_matches(&out, "lwjgl_opengl.dll", 5));

        let _ = fs::remove_dir_all(dir);
    }
}
