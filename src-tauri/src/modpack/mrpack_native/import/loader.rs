// loader.rs — 由 import.rs 拆分
#![allow(unused_imports)]

// Forge 核心文件检查
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use serde_json::{json, Map, Value};
use tauri::AppHandle;
use tokio::sync::{Mutex, Semaphore};
use crate::modpack::curseforge_shared as cf_shared;
use super::{emit_progress, emit_progress_with_files, versions_dir};
use crate::storage;
use super::{MrpackManifest, MrpackDependencies, MrpackFile, MAX_DOWNLOAD_ROUNDS};
use super::*;

/// 检查 Forge 核心文件是否存在且完整
/// forge-client.jar / client-srg.jar / client-extra.jar
pub(crate) fn check_forge_core_files(merged_json: &Value) -> Result<(), String> {
    let libs = merged_json
        .get("libraries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let forge_client_lib = libs.iter().find(|l| {
        if let Some(name) = l.get("name").and_then(|v| v.as_str())
            && regex::Regex::new(r"^net\.minecraftforge:forge:\d")
                .unwrap()
                .is_match(name)
            {
                return name.ends_with(":client") || name.split(':').count() == 3;
            }
        false
    });

    let srg_lib = libs.iter().find(|l| {
        if let Some(name) = l.get("name").and_then(|v| v.as_str()) {
            name.starts_with("net.minecraft:client:") && name.ends_with(":srg")
        } else {
            false
        }
    });

    let extra_lib = libs.iter().find(|l| {
        if let Some(name) = l.get("name").and_then(|v| v.as_str()) {
            name.starts_with("net.minecraft:client:") && name.ends_with(":extra")
        } else {
            false
        }
    });

    let libraries_dir = cf_shared::libraries_dir();
    let mut missing: Vec<(String, PathBuf)> = Vec::new();

    if let Some(lib) = forge_client_lib {
        let name = lib.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let parts: Vec<&str> = name.split(':').collect();
        if parts.len() >= 3 {
            let group_path = parts[0].replace('.', std::path::MAIN_SEPARATOR.to_string().as_str());
            let classifier = if parts.len() >= 4 {
                format!("-{}", parts[3])
            } else {
                String::new()
            };
            let jar_name = format!("{}-{}{}.jar", parts[1], parts[2], classifier);
            let p = libraries_dir
                .join(&group_path)
                .join(parts[1])
                .join(parts[2])
                .join(&jar_name);
            if !p.exists() || !cf_shared::is_jar_intact(&p) {
                missing.push(("forge-client.jar".to_string(), p));
            }
        }
    }

    if let Some(lib) = srg_lib {
        let name = lib.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let parts: Vec<&str> = name.split(':').collect();
        if parts.len() >= 3 {
            let group_path = parts[0].replace('.', std::path::MAIN_SEPARATOR.to_string().as_str());
            let jar_name = format!("{}-{}-srg.jar", parts[1], parts[2]);
            let p = libraries_dir
                .join(&group_path)
                .join(parts[1])
                .join(parts[2])
                .join(&jar_name);
            if !p.exists() || !cf_shared::is_jar_intact(&p) {
                missing.push(("client-srg.jar".to_string(), p));
            }
        }
    }

    if let Some(lib) = extra_lib {
        let name = lib.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let parts: Vec<&str> = name.split(':').collect();
        if parts.len() >= 3 {
            let group_path = parts[0].replace('.', std::path::MAIN_SEPARATOR.to_string().as_str());
            let jar_name = format!("{}-{}-extra.jar", parts[1], parts[2]);
            let p = libraries_dir
                .join(&group_path)
                .join(parts[1])
                .join(parts[2])
                .join(&jar_name);
            if !p.exists() || !cf_shared::is_jar_intact(&p) {
                missing.push(("client-extra.jar".to_string(), p));
            }
        }
    }

    if !missing.is_empty() {
        let missing_names: Vec<String> = missing.iter().map(|(n, _)| n.clone()).collect();
        let missing_paths: Vec<String> = missing.iter().map(|(_, p)| p.display().to_string()).collect();
        eprintln!(
            "[mrpack] Forge核心文件验证失败: 缺失 {} 个文件: {}",
            missing.len(),
            missing_names.join(", ")
        );
        for p in &missing {
            eprintln!("[mrpack]   缺失: {}", p.1.display());
        }
        return Err(format!(
            "Forge核心文件生成失败: 缺失 {}。\n请检查Java环境是否正常，网络是否畅通，然后重试。\n缺失文件路径:\n{}",
            missing_names.join(", "),
            missing_paths.join("\n")
        ));
    }

    Ok(())
}
