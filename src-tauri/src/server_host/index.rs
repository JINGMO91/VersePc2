// index.rs — 由 server_host.rs 拆分
#![allow(unused_imports)]

// 服务器目录与索引读写
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
use std::os::windows::process::CommandExt;
use super::*;

pub(crate) fn servers_root() -> PathBuf {
    storage::resolve_data_dir().join("servers")
}

pub(crate) fn index_file() -> PathBuf {
    servers_root().join("index.json")
}

pub(crate) fn versions_dir() -> PathBuf {
    storage::resolve_data_dir().join("versions")
}

pub(crate) fn server_dir_of(id: &str) -> PathBuf {
    servers_root().join(id)
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn ensure_root() {
    let _ = std::fs::create_dir_all(servers_root());
    let idx = index_file();
    if !idx.exists() {
        let _ = std::fs::write(&idx, "{\"servers\":[]}");
    }
}

pub(crate) fn load_index() -> Value {
    ensure_root();
    let idx = index_file();
    match std::fs::read_to_string(&idx) {
        Ok(content) => {
            let content = content.trim_start_matches('\u{FEFF}');
            match serde_json::from_str::<Value>(content) {
                Ok(v) if v.get("servers").and_then(|s| s.as_array()).is_some() => v,
                _ => json!({ "servers": [] }),
            }
        }
        Err(_) => json!({ "servers": [] }),
    }
}

pub(crate) fn save_index(idx: &Value) {
    ensure_root();
    let _ = std::fs::write(index_file(), serde_json::to_string_pretty(idx).unwrap_or_default());
}

pub(crate) fn read_json_safe(path: &std::path::Path) -> Option<Value> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim_start_matches('\u{FEFF}').to_string())
        .and_then(|s| serde_json::from_str(&s).ok())
}
