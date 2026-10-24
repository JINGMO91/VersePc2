// Java 安装器查找：从共享工具中拆出，保持 shared.rs 聚焦。
use std::path::Path;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::storage;
use super::shared::jstr;

// ============== Java 查找 ==============
// 优先使用 settings.javaPath，其次扫描系统已安装的 Java

/// 查找可用的 Java 可执行文件路径（用于运行 installer）
///
/// 优先级：
/// 1. settings.json 中的 javaPath
/// 2. 系统扫描的 Java 列表中第一个 major >= 8 的
/// 3. 系统 PATH 中的 java
#[allow(dead_code)]
pub fn find_java_for_install(min_major: u32) -> Option<std::path::PathBuf> {
    // 1. settings.javaPath
    let settings = storage::load_settings();
    let java_path = jstr(&settings, "javaPath");
    if !java_path.is_empty() {
        let p = std::path::PathBuf::from(&java_path);
        if p.exists() {
            if let Some(major) = inspect_java_major(&p)
                && major >= min_major {
                    return Some(p);
                }
            // 即使版本检测失败也允许使用（兜底）
            return Some(p);
        }
    }

    // 2. 扫描系统 Java
    let java_list = crate::java::detect_all();
    for entry in &java_list {
        let major = entry.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        let path = jstr(entry, "path");
        if !path.is_empty() && major >= min_major {
            return Some(std::path::PathBuf::from(path));
        }
    }
    // 没有满足版本的，取第一个
    if let Some(first) = java_list.first() {
        let path = jstr(first, "path");
        if !path.is_empty() {
            return Some(std::path::PathBuf::from(path));
        }
    }

    // 3. PATH 中的 java（Windows 用分号，macOS/Linux 用冒号）
    if let Ok(path) = std::env::var("PATH") {
        let sep = if cfg!(target_os = "windows") { ';' } else { ':' };
        for dir in path.split(sep) {
            let java_exe = std::path::PathBuf::from(dir).join("java.exe");
            if java_exe.exists() {
                return Some(java_exe);
            }
            let java_exe = std::path::PathBuf::from(dir).join("java");
            if java_exe.exists() {
                return Some(java_exe);
            }
        }
    }

    None
}

/// 检测 Java 主版本号（执行 java -version）
#[allow(dead_code)]
fn inspect_java_major(java_path: &Path) -> Option<u32> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new(java_path);
        c.arg("-version");
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = std::process::Command::new(java_path);
        c.arg("-version");
        c
    };
    let output = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&output.stderr);
    let text2 = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{}\n{}", text, text2);

    // 匹配 "version \"1.8.0_432\"" 或 "version \"17.0.1\""
    if let Some(idx) = combined.find("version \"") {
        let rest = &combined[idx + 9..];
        if let Some(end) = rest.find('"') {
            let ver_str = &rest[..end];
            let parts: Vec<&str> = ver_str.split('.').collect();
            if parts.len() >= 2 {
                // 旧版本格式 1.8.0_xxx → 主版本 8
                // 新版本格式 17.0.1 → 主版本 17
                let major = if parts[0] == "1" {
                    parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0)
                } else {
                    parts[0].parse().ok().unwrap_or(0)
                };
                return Some(major);
            }
            return parts[0].parse().ok();
        }
    }
    None
}
