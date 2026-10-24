// select.rs — 由 java.rs 拆分
#![allow(unused_imports)]

// Java 选择、排序与托管目录判断
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use crate::modloaders::shared;
use crate::storage;
use crate::utils;
use super::*;

/// 排序 Java 列表：
/// 1. 候选文件夹中的 Java 优先
/// 2. 其次主版本号接近 21 的 Java 优先
pub(crate) fn sort_java_list(list: &mut [Value]) {
    let candidates = candidate_folders();
    list.sort_by(|a, b| {
        let pa = a.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let pb = b.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let ia = is_in_candidate_folder(Path::new(pa), &candidates);
        let ib = is_in_candidate_folder(Path::new(pb), &candidates);
        if ia != ib {
            return ib.cmp(&ia);
        }
        let ma = a.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
        let mb = b.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
        let da = (ma - 21).abs();
        let db = (mb - 21).abs();
        da.cmp(&db)
    });
}

/// 根据游戏版本选择最合适的 Java（用于 Forge/NeoForge 安装器等需按版本匹配 Java 的场景）
/// 返回 java.exe 的绝对路径；找不到合适版本返回 None
///
/// 流程：
/// 1. 根据游戏版本计算所需的 Java 主版本范围 [min, max]
/// 2. 收集候选：用户指定 Java + 系统检测到的所有 Java
/// 3. 过滤出主版本在范围内的候选
/// 4. 按"距离需求版本最近、64 位优先"排序，取最优
#[allow(dead_code)]
pub fn select_java_for_version(game_version: &str) -> Option<String> {
    let (min_version, max_version) = crate::launch::get_java_version_range(game_version);

    let mut candidates: Vec<Value> = Vec::new();

    // 1. settings.json 中用户指定的 Java
    let settings = storage::load_settings();
    let current_java_path = utils::get_str(&settings, "javaPath");
    if !current_java_path.is_empty() {
        let p = PathBuf::from(&current_java_path);
        if p.exists()
            && let Some((version, major, is64)) = inspect_java(&p) {
                candidates.push(json!({
                    "path": p.to_string_lossy(),
                    "version": version,
                    "majorVersion": major,
                    "is64Bit": is64,
                    "source": "user",
                }));
            }
    }

    // 2. 系统检测到的所有 Java
    for j in detect_all() {
        candidates.push(j);
    }

    // 过滤：主版本在 [min, max] 范围内
    let mut suitable: Vec<&Value> = candidates
        .iter()
        .filter(|j| {
            let major = j.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            major >= min_version && major <= max_version
        })
        .collect();

    if suitable.is_empty() {
        return None;
    }

    // 排序：距离需求版本最近优先，其次 64 位优先
    suitable.sort_by(|a, b| {
        let ma = a.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
        let mb = b.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
        let da = (ma - min_version as i64).abs();
        let db = (mb - min_version as i64).abs();
        da.cmp(&db).then_with(|| {
            let ia = a.get("is64Bit").and_then(|v| v.as_bool()).unwrap_or(false);
            let ib = b.get("is64Bit").and_then(|v| v.as_bool()).unwrap_or(false);
            ib.cmp(&ia)
        })
    });

    Some(suitable[0].get("path").and_then(|v| v.as_str()).unwrap_or("").to_string())
}

/// 根据游戏版本收集"可用 Java 候选列表"（最优在前），用于安装器失败时自动换 Java 重试
///
/// 顺序：用户指定 Java 优先，其余按"距离需求版本最近、64 位优先"排序。
/// 返回 java.exe 绝对路径列表；无任何可用候选时返回空列表。
pub fn select_java_candidates_for_version(game_version: &str) -> Vec<String> {
    let (min_version, max_version) = crate::launch::get_java_version_range(game_version);

    let mut candidates: Vec<Value> = Vec::new();

    // 1. settings.json 中用户指定的 Java（优先）
    let settings = storage::load_settings();
    let current_java_path = utils::get_str(&settings, "javaPath");
    if !current_java_path.is_empty() {
        let p = PathBuf::from(&current_java_path);
        if p.exists()
            && let Some((version, major, is64)) = inspect_java(&p) {
                candidates.push(json!({
                    "path": p.to_string_lossy(),
                    "version": version,
                    "majorVersion": major,
                    "is64Bit": is64,
                    "source": "user",
                }));
            }
    }

    // 2. 系统检测到的所有 Java
    for j in detect_all() {
        candidates.push(j);
    }

    // 过滤：主版本在 [min, max] 范围内（确保安装器能运行）
    let mut suitable: Vec<&Value> = candidates
        .iter()
        .filter(|j| {
            let major = j.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            major >= min_version && major <= max_version
        })
        .collect();

    // 排序：距离需求版本最近优先，其次 64 位优先
    suitable.sort_by(|a, b| {
        let ma = a.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
        let mb = b.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
        let da = (ma - min_version as i64).abs();
        let db = (mb - min_version as i64).abs();
        da.cmp(&db).then_with(|| {
            let ia = a.get("is64Bit").and_then(|v| v.as_bool()).unwrap_or(false);
            let ib = b.get("is64Bit").and_then(|v| v.as_bool()).unwrap_or(false);
            ib.cmp(&ia)
        })
    });

    // 去重并转成路径列表
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut result: Vec<String> = Vec::new();
    for j in suitable {
        let p = j.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if p.is_empty() {
            continue;
        }
        if seen.insert(p.clone()) {
            result.push(p);
        }
    }
    result
}

/// 读取自定义 Java 列表（custom-java-list.json）
pub(crate) fn load_custom_java() -> Value {
    let path = storage::resolve_data_dir().join("custom-java-list.json");
    if let Ok(content) = std::fs::read_to_string(&path)
        && let Ok(v) = serde_json::from_str::<Value>(&content)
            && let Some(arr) = v.get("entries").and_then(|v| v.as_array()) {
                return Value::Array(arr.clone());
            }
    Value::Array(vec![])
}

/// 保存自定义 Java 列表
pub(crate) fn save_custom_java(entries: &Vec<Value>) -> bool {
    let path = storage::resolve_data_dir().join("custom-java-list.json");
    let data = json!({ "entries": entries });
    if let Ok(s) = serde_json::to_string_pretty(&data) {
        std::fs::write(&path, s).is_ok()
    } else {
        false
    }
}

/// 启动器托管 Java 的根目录（data_dir/java）
pub(crate) fn managed_java_root() -> PathBuf {
    storage::resolve_data_dir().join("java")
}

/// 判断 javaHome 是否位于指定托管根目录内（便于单元测试）。
/// canonicalize 后比较，防止通过 `..` 或符号链接绕过；目录不存在时返回 false。
pub(crate) fn is_managed_java_home_under(root: &Path, java_home: &Path) -> bool {
    let root = match root.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let home = match java_home.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    home != root && home.starts_with(&root)
}

/// 判断 javaHome 是否位于启动器托管目录内。
pub(crate) fn is_managed_java_home(java_home: &Path) -> bool {
    is_managed_java_home_under(&managed_java_root(), java_home)
}
