// manifest_check.rs — 由 import.rs 拆分
#![allow(unused_imports)]

// 依赖清单构造与检查
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

/// 构建 mrpack-manifest.json（供启动前 mods 完整性检查使用）
/// 只保留 mods 目录下实际存在的文件
pub(crate) fn build_mrpack_manifest_for_check(
    manifest: &MrpackManifest,
    version_dir: &Path,
    pack_name: &str,
) -> Value {
    let files: Vec<Value> = manifest
        .files
        .iter()
        .filter(|f| {
            // 只保留 mods 目录下实际存在的文件
            if let Some(ref p) = f.path {
                let fp = version_dir.join(p);
                fp.exists()
            } else {
                // 非 mods 文件（如 shaderpacks）保留
                true
            }
        })
        .map(|f| {
            json!({
                "path": f.path.as_ref().cloned().unwrap_or_default(),
                "hashes": f.hashes.sha1.as_ref().map(|s| json!({"sha1": s})).unwrap_or(json!({})),
                "downloads": f.downloads,
                "fileSize": f.file_size.unwrap_or(0)
            })
        })
        .collect();

    json!({
        "format": manifest.format_version.unwrap_or(1),
        "game": manifest.game.as_ref().cloned().unwrap_or_else(|| "minecraft".to_string()),
        "versionId": manifest.version_id.as_ref().cloned().unwrap_or_default(),
        "name": manifest.name.as_ref().cloned().unwrap_or_else(|| pack_name.to_string()),
        "dependencies": manifest_deps_to_json(&manifest.dependencies),
        "files": files
    })
}

/// 将 MrpackDependencies 转为 JSON
pub(crate) fn manifest_deps_to_json(deps: &MrpackDependencies) -> Value {
    let mut obj = Map::new();
    if let Some(ref mc) = deps.minecraft {
        obj.insert("minecraft".to_string(), json!(mc));
    }
    if let Some(ref forge) = deps.forge {
        obj.insert("forge".to_string(), json!(forge));
    }
    if let Some(ref neoforge) = deps.neoforge {
        obj.insert("neoforge".to_string(), json!(neoforge));
    }
    if let Some(ref fabric) = deps.fabric_loader {
        obj.insert("fabric-loader".to_string(), json!(fabric));
    }
    if let Some(ref quilt) = deps.quilt_loader {
        obj.insert("quilt-loader".to_string(), json!(quilt));
    }
    json!(obj)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modpack::mrpack_native::group_jvm_tokens;

    #[test]
    fn group_preserves_pair_flags() {
        // Forge 类版本常见的多个 --add-opens：必须保持成对，不能折叠成 flag 少值多
        let args: Vec<Value> = serde_json::from_str(r#"[
            "--add-opens",
            "java.base/java.lang=ALL-UNNAMED",
            "--add-opens",
            "java.base/java.util=ALL-UNNAMED"
        ]"#)
        .unwrap();
        let groups = group_jvm_tokens(&args);
        assert_eq!(groups.len(), 2, "应保留两个成对组，实际: {:?}", groups);
        for g in &groups {
            assert_eq!(g.len(), 2, "成对组应为 flag+值: {:?}", g);
            assert_eq!(g[0].as_str().unwrap(), "--add-opens");
        }
        assert_eq!(groups[1][1].as_str().unwrap(), "java.base/java.util=ALL-UNNAMED");
    }
}
