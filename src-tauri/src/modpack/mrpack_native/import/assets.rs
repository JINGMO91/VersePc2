// assets.rs — 由 import.rs 拆分
#![allow(unused_imports)]

// 资源文件下载
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

/// 下载游戏资源索引和缺失资源
pub(crate) async fn download_assets(
    app: &AppHandle,
    asset_index: &Value,
    settings: &Value,
) -> Result<(), String> {
    let assets_dir = cf_shared::assets_dir();
    let asset_index_id = asset_index
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("assetIndex 无 id")?;
    let asset_index_url = asset_index
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("assetIndex 无 url")?;
    let asset_index_sha1 = asset_index
        .get("sha1")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let index_path = assets_dir
        .join("indexes")
        .join(format!("{}.json", asset_index_id));

    // 下载索引文件
    if !index_path.exists()
        || (!asset_index_sha1.is_empty()
            && !verify_file_sha1(&index_path, asset_index_sha1).await)
    {
        if let Some(parent) = index_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if index_path.exists() {
            let _ = std::fs::remove_file(&index_path);
        }
        crate::download::single::download_with_mirror(
            asset_index_url,
            &index_path,
            if asset_index_sha1.is_empty() { None } else { Some(asset_index_sha1) },
            None,
            "china-first",
            60,
            None,
        )
        .await
        .map_err(|e| format!("下载资源索引失败: {}", e))?;
    }

    if !index_path.exists() {
        return Ok(());
    }

    // 解析索引文件，收集缺失资源
    let index_content = std::fs::read_to_string(&index_path)
        .map_err(|e| format!("读取资源索引失败: {}", e))?;
    let index_json: Value = serde_json::from_str(&index_content)
        .map_err(|e| format!("解析资源索引失败: {}", e))?;

    let objects = index_json
        .get("objects")
        .and_then(|v| v.as_object())
        .ok_or("资源索引无 objects")?;

    let mut asset_objects: Vec<crate::download::AssetObject> = Vec::with_capacity(objects.len());
    for (name, info) in objects {
        let hash = info
            .get("hash")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let size = info
            .get("size")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if hash.is_empty() {
            continue;
        }
        let sub_dir = &hash[..2];
        let a_path = assets_dir.join("objects").join(sub_dir).join(hash);
        if !a_path.exists() {
            asset_objects.push(crate::download::AssetObject {
                name: name.clone(),
                hash: hash.to_string(),
                size,
            });
        }
    }

    if asset_objects.is_empty() {
        return Ok(());
    }

    let asset_total = asset_objects.len();
    let sources = crate::download::select_asset_sources("china-first").await;
    let asset_parallel = settings
        .get("maxThreads")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(32)
        .clamp(8, 64);

    emit_progress(
        app,
        93,
        &format!("下载游戏资源 (0/{})", asset_total),
        "assets",
    );

    let app_progress = app.clone();
    let (done, failed) = crate::download::download_asset_objects(
        asset_objects,
        &assets_dir,
        &sources,
        asset_parallel,
        move |done, _total, name| {
            let pct = 93 + (done as u64 * 4 / asset_total as u64);
            emit_progress(
                &app_progress,
                pct.min(97) as u32,
                &format!("下载游戏资源 ({}/{})", done, asset_total),
                "assets",
            );
            if done % 50 == 0 || done == asset_total {
                eprintln!("[mrpack] 资源下载进度 {}/{} 当前: {}", done, asset_total, name);
            }
        },
    ).await;

    if failed > 0 {
        eprintln!("[mrpack] {} 个资源文件下载失败", failed);
    }

    crate::download::ensure_language_assets(objects, &assets_dir, &sources, asset_parallel)
        .await?;

    emit_progress(
        app,
        97,
        &format!("游戏资源下载完成 ({}/{})", done, asset_total),
        "assets",
    );

    Ok(())
}
