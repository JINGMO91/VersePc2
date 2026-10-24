// version.rs — 由 java.rs 拆分
#![allow(unused_imports)]

// Java 版本解析与 -version 输出识别
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use crate::modloaders::shared;
use crate::storage;
use crate::utils;
use super::*;

/// 读取 <javaHome>/release 文件中的 JAVA_VERSION 与 OS_ARCH
/// 比执行 java -version 快得多；OS_ARCH 用于判断 64 位
pub(crate) fn read_release_version(java_home: &Path) -> Option<(String, u32, bool)> {
    let release_file = java_home.join("release");
    let content = std::fs::read_to_string(&release_file).ok()?;
    let mut version_str: Option<String> = None;
    let mut is64 = true; // 默认 64 位，仅当 OS_ARCH 明确为 32 位时才为 false
    for line in content.lines() {
        if line.starts_with("JAVA_VERSION=") {
            let v = line.trim_start_matches("JAVA_VERSION=").trim_matches('"');
            version_str = Some(v.to_string());
        } else if line.starts_with("OS_ARCH=") {
            let arch = line.trim_start_matches("OS_ARCH=").trim_matches('"').to_lowercase();
            // x86_64 / amd64 / aarch64 / arm64 均为 64 位
            is64 = arch.contains("64") || arch.contains("arm") || arch.contains("aarch");
        }
    }
    let version = version_str?;
    let major = parse_version_major(&version);
    Some((version, major, is64))
}

/// 解析版本字符串的主版本号："1.8.0_301" → 8，"17.0.1" → 17
pub(crate) fn parse_version_major(version: &str) -> u32 {
    if let Some(first) = version.split('.').next() {
        if first == "1" {
            // 旧式版本号 1.8.0_301 → 8
            version.split('.').nth(1).and_then(|s| s.parse().ok()).unwrap_or(8)
        } else {
            first.parse().unwrap_or(0)
        }
    } else {
        0
    }
}

/// 从 java 输出中提取版本号并规范化为 4 段："17.0.1" → (17, 0, 1, 0)
/// 规则：
///   - 取 version "..." 引号内内容（或 openjdk N 前缀）
///   - 把 _ 与 + 替换为 .
///   - 截断到 - 之前（如 "1.8.0_301-b09"）
///   - 去除开头的 1.（旧式版本号）
///   - 补齐 4 段
pub(crate) fn normalize_version_string(raw: &str) -> Option<String> {
    let mut v = raw.replace(['_', '+'], ".");
    if let Some(idx) = v.find('-') {
        v.truncate(idx);
    }
    if v.starts_with("1.") {
        v = v[2..].to_string();
    }
    let mut segs: Vec<&str> = v.split('.').collect();
    if segs.is_empty() || segs[0].is_empty() {
        return None;
    }
    while segs.len() < 4 {
        segs.push("0");
    }
    let major = segs[0].parse::<u32>().ok()?;
    // 主版本 4 及以下或 100 及以上视为解析异常
    if major <= 4 || major >= 100 {
        return None;
    }
    Some(segs[..4].join("."))
}

/// 执行 java -version 解析版本和架构
/// 优先运行 -XshowSettings:properties -version 获取完整信息，
/// 包括版本号、64 位检测、file.encoding 等；失败时回退到 -version 仅解析版本号
pub fn inspect_java(java_exe: &Path) -> Option<(String, u32, bool)> {
    if !java_exe.exists() {
        return None;
    }
    // 先试读 release 文件（不执行 java，速度快）
    if let Some(java_home) = java_exe.parent().and_then(|p| p.parent())
        && let Some((v, m, is64)) = read_release_version(java_home) {
            return Some((v, m, is64));
        }

    // 尝试运行 java -XshowSettings:properties -version 获取完整信息
    let mut cmd = Command::new(java_exe);
    cmd.args(["-XshowSettings:properties", "-version"]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    if let Ok(out) = cmd.output() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let combined = format!("{}\n{}", stderr, stdout);

        // 检查是否包含致命错误
        if combined.contains("/lib/ext exists") {
            return None;
        }
        if combined.contains("a fatal error") || combined.contains("error: ") {
            return None;
        }

        // 提取版本号
        if let Some(version) = extract_version_from_output(&combined)
            && let Some(normalized) = normalize_version_string(&version) {
                let major = parse_version_major(&normalized);
                // 检查 64 位（含 macOS/Linux 的 aarch64/arm64）
                let is64 = combined.contains("os.arch = x86_64")
                    || combined.contains("os.arch = amd64")
                    || combined.contains("os.arch = aarch64")
                    || combined.contains("os.arch = arm64")
                    || combined.contains("64-Bit")
                    || combined.contains("64-bit");
                return Some((normalized, major, is64));
            }
    }

    // 回退：仅运行 java -version 解析版本号
    let mut cmd = Command::new(java_exe);
    cmd.arg("-version");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd.output().ok()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    let combined = format!("{}\n{}", stderr, stdout);

    if let Some(version) = extract_version_from_output(&combined)
        && let Some(normalized) = normalize_version_string(&version) {
            let major = parse_version_major(&normalized);
            let is64 = combined.contains("64-Bit") || combined.contains("64-bit");
            return Some((normalized, major, is64));
        }
    None
}

/// 从 java -version 输出中提取版本字符串
pub(crate) fn extract_version_from_output(output: &str) -> Option<String> {
    // 匹配 version "1.8.0_301" 或 version "17.0.1"（引号可选）
    let re = regex::Regex::new(r#"version\s+"?([^"\s]+)"?"#).ok()?;
    if let Some(cap) = re.captures(output) {
        return Some(cap[1].to_string());
    }
    // 回退匹配 openjdk <number>
    let re2 = regex::Regex::new(r"(?i)openjdk\s+(\d+)").ok()?;
    if let Some(cap) = re2.captures(output) {
        return Some(cap[1].to_string());
    }
    None
}
