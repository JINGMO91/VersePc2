// modpack/curseforge_chain.rs — CurseForge 整合包版本链清理与 JSON 递归解析
use std::fs;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use super::curseforge_fs::versions_dir;

// ============== 版本链清理 ==============

/// 清理版本链：删除版本目录及其继承链中的非原版目录
/// 原版目录（如 1.20.1）不删除
pub fn cleanup_version_chain(version_id: &str) {
    let chain = find_version_chain(version_id);
    let vanilla_pattern = regex::Regex::new(
        r"^\d+\.\d+(\.\d+)?(-rc\d+|-pre\d+|-snapshot.*)?$",
    )
    .unwrap();

    let mut to_delete: Vec<String> = Vec::new();
    for id in &chain {
        if vanilla_pattern.is_match(id) && id != version_id {
            continue;
        }
        to_delete.push(id.clone());
    }
    if !to_delete.contains(&version_id.to_string()) {
        to_delete.push(version_id.to_string());
    }

    for id in &to_delete {
        let dir = versions_dir().join(id);
        if !dir.exists() {
            continue;
        }
        // 最多重试 5 次删除（文件可能被占用）
        let mut deleted = false;
        for attempt in 1..=5u32 {
            if fs::remove_dir_all(&dir).is_ok() {
                deleted = true;
                break;
            }
            eprintln!("[Cleanup] 删除 {} 失败 (第{}次)", id, attempt);
            if attempt < 5 {
                std::thread::sleep(Duration::from_millis(attempt as u64 * 1000));
            }
        }
        if !deleted {
            eprintln!("[Cleanup] {} 文件可能被占用，请关闭游戏后重试", id);
        }
    }
}

/// 查找版本继承链
fn find_version_chain(version_id: &str) -> Vec<String> {
    let mut chain = Vec::new();
    let mut current = version_id.to_string();
    let mut visited = std::collections::HashSet::new();
    while !visited.contains(&current) {
        visited.insert(current.clone());
        chain.push(current.clone());
        let json_path = versions_dir().join(&current).join(format!("{}.json", current));
        if !json_path.exists() {
            break;
        }
        let content = match fs::read_to_string(&json_path) {
            Ok(c) => c,
            Err(_) => break,
        };
        let json: Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => break,
        };
        match json.get("inheritsFrom").and_then(|v| v.as_str()) {
            Some(parent) if !parent.is_empty() => current = parent.to_string(),
            _ => break,
        }
    }
    chain
}

// ============== 版本 JSON 递归解析 ==============

/// 递归解析版本 JSON（合并 inheritsFrom 的 libraries + downloads.client）
pub fn resolve_version_json(version_id: &str) -> Option<Value> {
    resolve_version_json_recursive(version_id, &versions_dir())
}

fn resolve_version_json_recursive(version_id: &str, versions_dir: &Path) -> Option<Value> {
    let json_path = versions_dir.join(version_id).join(format!("{}.json", version_id));
    if !json_path.exists() {
        return None;
    }
    let content = fs::read_to_string(&json_path).ok()?;
    let mut json: Value = serde_json::from_str(&content).ok()?;

    if let Some(parent_id) = json
        .get("inheritsFrom")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        && let Some(parent_json) = resolve_version_json_recursive(&parent_id, versions_dir) {
            // 合并 libraries（父版本在前，子版本在后，去重）
            if let (Some(parent_libs), Some(self_libs)) = (
                parent_json.get("libraries").and_then(|v| v.as_array()).cloned(),
                json.get("libraries").and_then(|v| v.as_array()).cloned(),
            ) {
                let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
                let mut merged: Vec<Value> = Vec::new();
                for lib in parent_libs.iter().chain(self_libs.iter()) {
                    if let Some(name) = lib.get("name").and_then(|v| v.as_str()) {
                        if seen.insert(name.to_string()) {
                            merged.push(lib.clone());
                        }
                    } else {
                        merged.push(lib.clone());
                    }
                }
                if let Some(obj) = json.as_object_mut() {
                    obj.insert("libraries".to_string(), json!(merged));
                }
            }
            // 合并 downloads.client
            if json.get("downloads").and_then(|d| d.get("client")).is_none()
                && let Some(parent_client) = parent_json.get("downloads").and_then(|d| d.get("client"))
                    && let Some(obj) = json.as_object_mut() {
                        let mut downloads = obj.get("downloads").cloned().unwrap_or(json!({}));
                        if let Some(d_obj) = downloads.as_object_mut() {
                            d_obj.insert("client".to_string(), parent_client.clone());
                        }
                        obj.insert("downloads".to_string(), downloads);
                    }
            // 合并 assetIndex
            if json.get("assetIndex").is_none()
                && let Some(parent_asset_index) = parent_json.get("assetIndex")
                    && let Some(obj) = json.as_object_mut() {
                        obj.insert("assetIndex".to_string(), parent_asset_index.clone());
                    }
            // 合并 jar
            if json.get("jar").is_none()
                && let Some(parent_jar) = parent_json.get("jar").and_then(|v| v.as_str())
                    && let Some(obj) = json.as_object_mut() {
                        obj.insert("jar".to_string(), json!(parent_jar));
                    }
        }
    Some(json)
}
