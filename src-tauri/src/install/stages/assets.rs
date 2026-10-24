// install/stages/assets.rs — 资源文件阶段
// 职责：下载资源索引，计算缺失对象并并发下载。

use serde_json::Value;

use crate::download;
use crate::install::context::{calc_progress, InstallCtx, StageError};
use crate::install::session;

/// 执行资源文件阶段
pub(crate) async fn run(ctx: &InstallCtx, version_details: &Value) -> Result<(), StageError> {
    ctx.update(session::InstallStage::Assets, 0, "下载资源文件...");

    if let Some(asset_index) = version_details.get("assetIndex") {
        let asset_index_url = asset_index
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let asset_index_id = asset_index
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("legacy");
        let asset_index_sha1 = asset_index
            .get("sha1")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let asset_index_path = ctx
            .assets_dir
            .join("indexes")
            .join(format!("{}.json", asset_index_id));

        if !asset_index_url.is_empty() {
            // 下载资源索引
            if let Err(e) = download::download_with_mirror(
                asset_index_url,
                &asset_index_path,
                if asset_index_sha1.is_empty() {
                    None
                } else {
                    Some(asset_index_sha1)
                },
                None,
                &ctx.download_source,
                60,
                None,
            )
            .await
            {
                session::update_session(&ctx.app, &ctx.session_id, |s| {
                    s.errors.push(format!("资源索引下载失败: {}", e));
                });
            }

            // 解析并批量下载缺失资源
            if let Ok(index_content) = tokio::fs::read_to_string(&asset_index_path).await
                && let Ok(index_json) = serde_json::from_str::<Value>(&index_content)
                && let Some(objects) = index_json.get("objects").and_then(|v| v.as_object())
            {
                let mut asset_objects: Vec<download::AssetObject> =
                    Vec::with_capacity(objects.len());
                for (name, info) in objects {
                    let hash = info.get("hash").and_then(|v| v.as_str()).unwrap_or("");
                    let size = info.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                    if hash.is_empty() {
                        continue;
                    }
                    let prefix = &hash[..2];
                    let path = ctx.assets_dir.join("objects").join(prefix).join(hash);
                    if !path.exists() {
                        asset_objects.push(download::AssetObject {
                            name: name.clone(),
                            hash: hash.to_string(),
                            size,
                        });
                    }
                }

                let total_assets = asset_objects.len() as u32;
                if total_assets > 0 {
                    let sources = download::select_asset_sources(&ctx.download_source).await;
                    let max_parallel = ctx
                        .settings
                        .get("maxThreads")
                        .and_then(|v| v.as_u64())
                        .map(|n| n as usize)
                        .unwrap_or(32)
                        .clamp(8, 64);

                    let app_progress = ctx.app.clone();
                    let session_id_progress = ctx.session_id.clone();
                    let total_assets_usize = total_assets as usize;
                    let (_done, failed) = download::download_asset_objects(
                        asset_objects,
                        &ctx.assets_dir,
                        &sources,
                        max_parallel,
                        move |done, _total, name| {
                            session::update_session(&app_progress, &session_id_progress, |s| {
                                s.progress = calc_progress(
                                    &session::InstallStage::Assets,
                                    (done as u32 * 100) / total_assets.max(1),
                                );
                                s.message = format!("下载资源 ({}/{})", done, total_assets_usize);
                                s.completed_files = done as u32;
                                s.total_files = total_assets;
                                s.current_file = name.to_string();
                            });
                        },
                    )
                    .await;

                    if failed > 0 {
                        session::update_session(&ctx.app, &ctx.session_id, |s| {
                            s.errors.push(format!("{} 个资源文件下载失败", failed));
                        });
                    }
                }
            }
        }
    }

    ctx.update(session::InstallStage::Assets, 100, "资源文件已下载");
    if ctx.is_cancelled() {
        return Err(ctx.cancelled());
    }
    Ok(())
}
