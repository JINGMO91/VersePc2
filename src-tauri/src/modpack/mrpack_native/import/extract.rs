// extract.rs — 由 import.rs 拆分
#![allow(unused_imports)]

// overrides、图标与文件名处理
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

/// 解压 overrides 到版本目录
/// 含路径遍历保护、Windows 保留名过滤、5 次重试、50 文件 yield、实时进度回调
pub(crate) fn extract_overrides_with_progress(
    archive: &mut zip::ZipArchive<std::fs::File>,
    dest_dir: &Path,
    app: &AppHandle,
) -> Result<Vec<Value>, String> {
    let prefix = "overrides/";
    let dest_canonical = dest_dir
        .canonicalize()
        .unwrap_or_else(|_| dest_dir.to_path_buf());

    // 先统计待解压文件总数
    let mut override_total = 0usize;
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().replace('\\', "/");
            if name.starts_with(prefix) {
                override_total += 1;
            }
        }
    }

    let mut override_files: Vec<Value> = Vec::new();
    let mut yield_counter = 0usize;
    let mut extract_count = 0usize;

    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        // 统一分隔符：Windows 打包的 zip 可能使用反斜杠
        let name = entry.name().replace('\\', "/");
        if !cf_shared::is_modpack_path_safe(&name) {
            continue;
        }
        if !name.starts_with(prefix) {
            continue;
        }

        let rel_path = &name[prefix.len()..];
        let dest_path = dest_dir.join(rel_path);

        // 路径遍历校验
        if let Some(parent) = dest_path.parent() {
            let _ = std::fs::create_dir_all(parent);
            let parent_canonical = parent
                .canonicalize()
                .unwrap_or_else(|_| parent.to_path_buf());
            if !parent_canonical.starts_with(&dest_canonical) {
                eprintln!("[Modpack] mrpack路径遍历已拦截: {}", rel_path);
                continue;
            }
        }

        // 读取 entry 数据
        let mut buf = Vec::new();
        if let Err(e) = entry.read_to_end(&mut buf) {
            eprintln!("[mrpack] 读取 entry 失败: {} - {}", rel_path, e);
            continue;
        }

        // 5 次重试写入
        let mut written = false;
        for attempt in 1..=5u32 {
            match std::fs::write(&dest_path, &buf) {
                Ok(_) => {
                    written = true;
                    break;
                }
                Err(e) => {
                    eprintln!(
                        "[Modpack] mrpack解压 {} 第 {} 次失败: {}",
                        rel_path, attempt, e
                    );
                    if attempt < 5 {
                        std::thread::sleep(Duration::from_millis((attempt - 1) as u64 * 2000));
                    }
                }
            }
        }

        if written {
            override_files.push(json!({
                "name": rel_path,
                "status": "completed",
                "progress": 100
            }));
            extract_count += 1;
        }

        // 实时进度反馈：每 50 个文件更新一次进度（40% → 50% 区间）
        yield_counter += 1;
        if override_total > 0 && yield_counter.is_multiple_of(50) {
            let pct = 40 + (extract_count * 10 / override_total);
            emit_progress(
                app,
                pct as u32,
                &format!("解压覆盖文件... ({}/{})", extract_count, override_total),
                "extract",
            );
            std::thread::yield_now();
        }
    }

    Ok(override_files)
}

/// 解压 client_overrides 到版本目录（在 overrides 之后解压）
pub(crate) fn extract_client_overrides(
    archive: &mut zip::ZipArchive<std::fs::File>,
    dest_dir: &Path,
    app: &AppHandle,
) -> Result<(), String> {
    let prefix = "client-overrides/";
    let dest_canonical = dest_dir
        .canonicalize()
        .unwrap_or_else(|_| dest_dir.to_path_buf());

    let mut yield_counter = 0usize;
    let mut extract_count = 0usize;

    // 先统计
    let mut total = 0usize;
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            if entry.is_dir() {
                continue;
            }
            if entry.name().replace('\\', "/").starts_with(prefix) {
                total += 1;
            }
        }
    }

    if total == 0 {
        return Ok(());
    }

    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        // 统一分隔符：Windows 打包的 zip 可能使用反斜杠
        let name = entry.name().replace('\\', "/");
        if !cf_shared::is_modpack_path_safe(&name) {
            continue;
        }
        if !name.starts_with(prefix) {
            continue;
        }

        let rel_path = &name[prefix.len()..];
        let dest_path = dest_dir.join(rel_path);

        // 路径遍历校验
        if let Some(parent) = dest_path.parent() {
            let _ = std::fs::create_dir_all(parent);
            let parent_canonical = parent
                .canonicalize()
                .unwrap_or_else(|_| parent.to_path_buf());
            if !parent_canonical.starts_with(&dest_canonical) {
                eprintln!("[Modpack] mrpack client-overrides 路径遍历已拦截: {}", rel_path);
                continue;
            }
        }

        let mut buf = Vec::new();
        if let Err(e) = entry.read_to_end(&mut buf) {
            eprintln!("[mrpack] 读取 client-overrides entry 失败: {} - {}", rel_path, e);
            continue;
        }

        // 5 次重试写入
        let mut written = false;
        for attempt in 1..=5u32 {
            match std::fs::write(&dest_path, &buf) {
                Ok(_) => {
                    written = true;
                    break;
                }
                Err(e) => {
                    eprintln!(
                        "[Modpack] mrpack client-overrides 解压 {} 第 {} 次失败: {}",
                        rel_path, attempt, e
                    );
                    if attempt < 5 {
                        std::thread::sleep(Duration::from_millis((attempt - 1) as u64 * 2000));
                    }
                }
            }
        }

        if written {
            extract_count += 1;
        }

        yield_counter += 1;
        if total > 0 && yield_counter.is_multiple_of(50) {
            let pct = 40 + (extract_count * 10 / total);
            emit_progress(
                app,
                pct as u32,
                &format!("解压 client-overrides... ({}/{})", extract_count, total),
                "extract",
            );
            std::thread::yield_now();
        }
    }

    Ok(())
}

/// 提取整合包根目录的图标文件（pack.png / icon.png / logo.png）
pub(crate) fn extract_root_icon(archive: &mut zip::ZipArchive<std::fs::File>, version_dir: &Path) {
    let icon_names = ["pack.png", "icon.png", "logo.png"];
    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        let entry_name = entry.name().replace('\\', "/");
        if icon_names.contains(&entry_name.as_str()) {
            let dest_icon_path = version_dir.join(&entry_name);
            if !dest_icon_path.exists() {
                let mut buf = Vec::new();
                if entry.read_to_end(&mut buf).is_ok() {
                    let _ = std::fs::write(&dest_icon_path, &buf);
                    eprintln!("[Modpack] 提取整合包图标: {}", entry_name);
                }
            }
            break;
        }
    }
}

/// 从 fileEntry 提取文件名（basename of path 或 downloads[0]）
pub(crate) fn extract_file_name(f: &MrpackFile) -> String {
    if let Some(ref p) = f.path {
        let normalized = p.replace('\\', "/");
        if let Some(name) = normalized.rsplit('/').next()
            && !name.is_empty() {
                return name.to_string();
            }
    }
    if let Some(first) = f.downloads.first() {
        let path = first.split('?').next().unwrap_or(first);
        if let Some(name) = path.rsplit('/').next()
            && !name.is_empty() {
                return name.to_string();
            }
    }
    "unknown".to_string()
}
