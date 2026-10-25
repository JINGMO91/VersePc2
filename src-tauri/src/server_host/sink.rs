// sink.rs — 由 server_host.rs 拆分
#![allow(unused_imports)]

// 日志与状态广播
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

/// 开服日志/状态广播出口。
/// 抽象成 trait，使同一套开服核心逻辑既能跑在 Tauri 命令里，也能跑在独立守护进程里。
pub trait HostSink: Send + Sync {
    fn emit_log(&self, id: &str, line: &str, stream: &str);
    fn emit_status(&self, id: &str, status: &str, extra: Value);
}

/// 面向实时流的默认空实现（不落地，供需要静默的场合使用）。
#[allow(dead_code)]
pub struct NullHostSink;

impl HostSink for NullHostSink {
    fn emit_log(&self, _id: &str, _line: &str, _stream: &str) {}
    fn emit_status(&self, _id: &str, _status: &str, _extra: Value) {}
}

/// Tauri 环境下的实现：通过 AppHandle 广播到前端。
pub struct TauriHostSink(pub AppHandle);

impl HostSink for TauriHostSink {
    fn emit_log(&self, id: &str, line: &str, stream: &str) {
        let _ = self.0.emit(
            "server-host:log",
            json!({
                "id": id,
                "line": line.replace('\r', ""),
                "stream": stream,
                "ts": now_ms()
            }),
        );
    }
    fn emit_status(&self, id: &str, status: &str, extra: Value) {
        let mut payload = json!({
            "id": id,
            "status": status,
            "ts": now_ms()
        });
        if let (Some(dst), Some(src)) = (payload.as_object_mut(), extra.as_object()) {
            for (k, v) in src {
                dst.insert(k.clone(), v.clone());
            }
        }
        let _ = self.0.emit("server-host:status", payload);
    }
}

pub(crate) fn emit_log(sink: &dyn HostSink, id: &str, line: &str, stream: &str) {
    sink.emit_log(id, line, stream);
}

pub(crate) fn emit_status(sink: &dyn HostSink, id: &str, status: &str, extra: Value) {
    sink.emit_status(id, status, extra);
}
