// mods.rs — 由 server_host.rs 拆分
#![allow(unused_imports)]

// 客户端模组识别与同步
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::oneshot;
use crate::download::download_with_mirror;
use crate::storage;
use super::*;

pub(crate) fn resolve_client_mods_dir(version_id: &str) -> PathBuf {
    let cand = versions_dir().join(version_id).join("mods");
    if cand.exists() {
        return cand;
    }
    let global = storage::resolve_data_dir().join("mods");
    if global.exists() {
        return global;
    }
    cand
}

pub(crate) fn is_client_only_by_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    let hints = [
        "optifine", "sodium", "iris", "rubidium", "oculus",
        "notenoughanimations", "entityculling", "fabrishot", "modmenu",
        "reeses-sodium", "immediatelyfast", "dynamic-fps", "zoomify",
        "controllable", "mousewheelie", "xaero", "journeymap",
        "minimap", "litematica", "tweakeroo", "malilib",
        "replaymod", "freecam", "bobby",
    ];
    hints.iter().any(|h| lower.contains(h))
}

/// 读取 jar 中的指定条目（zip 解析）
pub(crate) fn read_jar_entry(jar_path: &std::path::Path, entry_name: &str) -> Option<String> {
    let file = std::fs::File::open(jar_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).ok()?;
        if entry.name() == entry_name {
            use std::io::Read;
            let mut buf = String::new();
            entry.take(8 * 1024 * 1024).read_to_string(&mut buf).ok()?;
            return Some(buf.trim_start_matches('\u{FEFF}').to_string());
        }
    }
    None
}

/// 判断模组是否仅客户端（fabric.mod.json 的 environment 或 mods.toml 的 clientSideOnly）
pub(crate) fn is_mod_client_only(jar_path: &std::path::Path) -> bool {
    // fabric.mod.json
    if let Some(content) = read_jar_entry(jar_path, "fabric.mod.json")
        && let Ok(j) = serde_json::from_str::<Value>(&content) {
            let env = j.get("environment");
            // 字符串形式："client" | "server" | "*"
            if let Some(env_str) = env.and_then(|v| v.as_str())
                && env_str == "client" {
                    return true;
                }
            // 数组形式（少见）
            if let Some(arr) = env.and_then(|v| v.as_array())
                && arr.len() == 1 && arr[0].as_str() == Some("client") {
                    return true;
                }
            // environment 字段可能也写成对象
            if let Some(obj) = env.and_then(|v| v.as_object())
                && let Some(client) = obj.get("client").and_then(|v| v.as_str())
                    && client == "client" {
                        return true;
                    }
        }
    // META-INF/mods.toml
    if let Some(content) = read_jar_entry(jar_path, "META-INF/mods.toml")
        && let Ok(re) = regex::Regex::new(r"(?i)clientSideOnly\s*=\s*true")
            && re.is_match(&content) {
                return true;
            }
    false
}

/// 同步客户端 mods 到服务端
pub(crate) async fn sync_client_mods_to_server(
    sink: &dyn HostSink,
    server_id: &str,
    src_mods: &std::path::Path,
    dest_mods: &std::path::Path,
) -> Value {
    let _ = tokio::fs::create_dir_all(dest_mods).await;

    if !src_mods.exists() {
        return json!({
            "ok": true,
            "copied": 0,
            "skipped": 0,
            "clientOnly": 0,
            "message": "客户端无 mods 目录"
        });
    }

    let mut files: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(src_mods) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            if lower.ends_with(".jar") && !lower.starts_with('.') {
                files.push(name);
            }
        }
    }

    let total = files.len();
    let mut copied = 0u32;
    let mut skipped = 0u32;
    let mut client_only_count = 0u32;

    for (i, name) in files.iter().enumerate() {
        let pct = ((i + 1) * 100).checked_div(total).map(|v| v as u8).unwrap_or(100);
        emit_status(
            sink,
            server_id,
            "syncing-mods",
            json!({
                "progress": pct,
                "indeterminate": false,
                "message": format!("同步模组 {}/{}: {}", i + 1, total, name),
                "stage": "mods"
            }),
        );
        emit_log(sink, server_id, &format!("[VersePC] 同步模组 {}/{}: {}", i + 1, total, name), "out");

        if is_client_only_by_name(name) {
            client_only_count += 1;
            skipped += 1;
            continue;
        }

        let src = src_mods.join(name);
        let dest = dest_mods.join(name);

        let env_client_only = is_mod_client_only(&src);
        if env_client_only {
            client_only_count += 1;
            skipped += 1;
            continue;
        }

        // 已存在且大小相同则跳过
        let should_copy = match (std::fs::metadata(&src), std::fs::metadata(&dest)) {
            (Ok(s), Ok(d)) => s.len() != d.len(),
            (Ok(_), Err(_)) => true,
            _ => false,
        };
        if !should_copy {
            skipped += 1;
            continue;
        }

        if std::fs::copy(&src, &dest).is_ok() {
            copied += 1;
        } else {
            skipped += 1;
        }
    }

    let other_skipped = skipped.saturating_sub(client_only_count);
    json!({
        "ok": true,
        "copied": copied,
        "skipped": skipped,
        "clientOnly": client_only_count,
        "total": total,
        "source": src_mods.to_string_lossy(),
        "dest": dest_mods.to_string_lossy(),
        "message": format!("已同步 {} 个模组（跳过客户端 {}，其他跳过 {}）", copied, client_only_count, other_skipped)
    })
}
