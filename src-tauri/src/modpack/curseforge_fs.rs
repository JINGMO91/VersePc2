// modpack/curseforge_fs.rs — CurseForge 整合包文件与路径工具
//
// 版本去重、下载残留清理、路径安全、资源包识别与迁移、模组清单、
// 并发与超时、数据目录与时间工具。
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::modloaders::shared as ml_shared;
use crate::storage;

// ============== 常量 ==============

pub const DEFAULT_MODPACK_CONCURRENCY: usize = 64;
pub const MAX_MODPACK_CONCURRENCY: usize = 64;

// ============== 版本 ID 去重 ==============
/// 重复版本名自动去重，避免覆盖已有版本
/// 重名时追加 (2)~(999)
pub fn dedupe_version_id(base_name: &str) -> String {
    let vdir = versions_dir();
    let mut candidate = base_name.to_string();
    let mut counter = 2;
    while vdir.join(&candidate).exists() {
        candidate = format!("{} ({})", base_name, counter);
        counter += 1;
        if counter > 999 {
            break;
        }
    }
    candidate
}

// ============== 清理 .downloading 残留 ==============
//

/// 清理 mods 目录下的 .downloading 残留临时文件
/// 下载中断/失败时 .downloading 文件会残留，续传时基于错误偏移量追加导致 SHA1 必然失败
pub fn clean_downloading_residue(version_dir: &Path) -> usize {
    let mods_dir = version_dir.join("mods");
    if !mods_dir.exists() {
        return 0;
    }
    let mut cleaned = 0usize;
    let entries = match fs::read_dir(&mods_dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str())
            && name.ends_with(".downloading")
                && fs::remove_file(&path).is_ok() {
                    cleaned += 1;
                }
    }
    if cleaned > 0 {
        eprintln!("[Modpack] 已清理 {} 个 .downloading 残留文件", cleaned);
    }
    cleaned
}

// ============== 路径安全校验 ==============
const WIN_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 拦截 __macosx 前缀和 Windows 保留名
pub fn is_modpack_path_safe(entry_path: &str) -> bool {
    if entry_path.is_empty() {
        return false;
    }
    let normalized = entry_path.replace('\\', "/");
    if normalized.to_lowercase().starts_with("__macosx/") {
        return false;
    }
    // 绝对路径：/x 或 C:/x（UNC 路径经上面替换后同样以 / 开头）
    if normalized.starts_with('/') {
        return false;
    }
    if normalized.as_bytes().get(1) == Some(&b':') {
        return false;
    }
    for seg in normalized.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        // 拒 .. 段，防止 zip-slip 越出目标目录
        if seg == ".." {
            return false;
        }
        let stem = seg.split('.').next().unwrap_or(seg);
        if WIN_RESERVED_NAMES.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
            return false;
        }
    }
    true
}

// ============== 资源包检测与重定位 ==============
/// 检测 zip 是否为资源包（有 pack.mcmeta 且无 mods.toml/mcmod.info）
pub fn is_resource_pack_zip(zip_path: &Path) -> bool {
    let file = match fs::File::open(zip_path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut has_mcmeta = false;
    let mut has_mods_toml = false;
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_lowercase();
            if name == "pack.mcmeta" {
                has_mcmeta = true;
            } else if name == "meta-inf/mods.toml" || name == "mcmod.info" {
                has_mods_toml = true;
            }
        }
    }
    has_mcmeta && !has_mods_toml
}

/// 将 mods 目录下误放的资源包 zip 移到 resourcepacks 目录
pub fn relocate_misplaced_resource_packs(version_dir: &Path) -> RelocateResult {
    let mut result = RelocateResult::default();
    let mods_dir = version_dir.join("mods");
    if !mods_dir.exists() || !mods_dir.is_dir() {
        return result;
    }
    let resourcepacks_dir = version_dir.join("resourcepacks");
    let zip_files: Vec<String> = match fs::read_dir(&mods_dir) {
        Ok(entries) => entries
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                if name.to_lowercase().ends_with(".zip") {
                    Some(name)
                } else {
                    None
                }
            })
            .collect(),
        Err(_) => return result,
    };
    for zip_name in zip_files {
        let src_path = mods_dir.join(&zip_name);
        if !is_resource_pack_zip(&src_path) {
            result.skipped.push(zip_name);
            continue;
        }
        if !resourcepacks_dir.exists()
            && fs::create_dir_all(&resourcepacks_dir).is_err() {
                result.skipped.push(zip_name);
                continue;
            }
        let dst_path = resourcepacks_dir.join(&zip_name);
        if dst_path.exists() {
            result.skipped.push(zip_name);
            continue;
        }
        if fs::rename(&src_path, &dst_path).is_ok() {
            result.relocated.push(zip_name);
        } else {
            result.skipped.push(zip_name);
        }
    }
    result
}

#[derive(Default, Debug)]
pub struct RelocateResult {
    pub relocated: Vec<String>,
    pub skipped: Vec<String>,
}

// ============== 模组清单保存 ==============
/// 保存模组清单到版本目录，供启动前校验使用
pub fn save_mod_manifest(version_dir: &Path, mods: &[Value]) {
    let manifest_path = version_dir.join("mod-manifest.json");
    let manifest_json = json!({
        "generatedAt": now_iso(),
        "mods": mods,
    });
    if let Err(e) = fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest_json).unwrap_or_default(),
    ) {
        eprintln!("[Modpack] 保存模组清单失败: {}", e);
    } else {
        eprintln!(
            "[Modpack] 已保存模组清单: {} ({} 个)",
            manifest_path.display(),
            mods.len()
        );
    }
}

// ============== 并发与超时 ==============
/// 根据 settings.maxThreads 解析模组下载并发数，默认 64，上限 64
pub fn resolve_concurrency(settings: &Value) -> usize {
    let max_threads = settings
        .get("maxThreads")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_MODPACK_CONCURRENCY);
    max_threads.clamp(1, MAX_MODPACK_CONCURRENCY)
}

/// 按文件大小返回单个模组下载超时（毫秒）
#[allow(dead_code)]
pub fn compute_mod_timeout(size_bytes: i64) -> u64 {
    if size_bytes > 50 * 1024 * 1024 {
        return 600_000;
    }
    if size_bytes > 20 * 1024 * 1024 {
        return 300_000;
    }
    if size_bytes > 5 * 1024 * 1024 {
        return 180_000;
    }
    120_000
}

// ============== 路径工具 ==============

pub fn data_dir() -> PathBuf {
    storage::resolve_data_dir()
}

pub fn versions_dir() -> PathBuf {
    data_dir().join("versions")
}

pub fn libraries_dir() -> PathBuf {
    data_dir().join("libraries")
}

pub fn assets_dir() -> PathBuf {
    data_dir().join("assets")
}

/// 递归复制目录
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !src.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let dest = dst.join(file_name);
        if path.is_dir() {
            copy_dir_recursive(&path, &dest)?;
        } else {
            let _ = fs::copy(&path, &dest);
        }
    }
    Ok(())
}

// ============== 时间工具 ==============

/// 当前 Unix 时间戳（秒）
pub fn now_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 当前时间的 ISO 8601 字符串
pub fn now_iso() -> String {
    ml_shared::now_iso()
}
