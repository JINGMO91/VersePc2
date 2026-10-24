// install/stages/client_jar.rs — 客户端 JAR 阶段
// 职责：下载原版 client.jar；合并式加载器跳过（由加载器阶段直接写入目标实例）。

use std::sync::Arc;

use serde_json::Value;

use crate::download;
use crate::install::context::{
    append_install_log, calc_progress, log_now, InstallCtx, StageError,
};
use crate::install::session;

/// 执行客户端 JAR 阶段
pub(crate) async fn run(ctx: &InstallCtx, version_details: &Value) -> Result<(), StageError> {
    ctx.update(session::InstallStage::ClientJar, 0, "下载客户端文件...");

    let client_jar_url = version_details
        .pointer("/downloads/client/url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let client_jar_sha1 = version_details
        .pointer("/downloads/client/sha1")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let client_jar_size = version_details
        .pointer("/downloads/client/size")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    // 合并式加载器不在此处下载原版 client.jar：加载器阶段会把原版 JAR 直接落到合并后的版本目录
    if !client_jar_url.is_empty() && !ctx.merge_only_loader() {
        let version_dir = ctx.version_dir();
        let client_jar_path = version_dir.join(format!("{}.jar", ctx.game_version()));

        let version_id_for_cb = ctx.actual_version_id.clone();
        let app_for_cb = ctx.app.clone();
        let session_id_for_cb = ctx.session_id.clone();
        let progress_cb: download::ProgressCb = Arc::new(move |p: &download::DownloadProgress| {
            session::update_session(&app_for_cb, &session_id_for_cb, |s| {
                s.stage = session::InstallStage::ClientJar;
                s.progress = calc_progress(
                    &session::InstallStage::ClientJar,
                    ((p.bytes_downloaded as f64 / p.total_bytes.max(1) as f64) * 100.0) as u32,
                );
                s.bytes_downloaded = p.bytes_downloaded;
                s.total_bytes = p.total_bytes;
                s.speed = p.speed;
                s.current_file = format!("{}.jar", version_id_for_cb);
            });
        });

        let result = download::download_with_mirror(
            &client_jar_url,
            &client_jar_path,
            if client_jar_sha1.is_empty() {
                None
            } else {
                Some(&client_jar_sha1)
            },
            if client_jar_size > 0 {
                Some(client_jar_size)
            } else {
                None
            },
            &ctx.download_source,
            300,
            Some(progress_cb),
        )
        .await;

        match result {
            Ok(()) => ctx.update(session::InstallStage::ClientJar, 100, "客户端文件已下载"),
            Err(e) => {
                ctx.cleanup_new_version_dir();
                let cancelled = e.contains("已取消");
                if cancelled {
                    append_install_log(
                        &ctx.data_dir,
                        &format!("[{}] 安装取消: {}", log_now(), ctx.actual_version_id),
                    );
                    return Err(ctx.cancelled());
                }
                append_install_log(
                    &ctx.data_dir,
                    &format!(
                        "[{}] 客户端下载失败: {} — {}",
                        log_now(),
                        ctx.game_version(),
                        e
                    ),
                );
                return Err(ctx.fail(format!("下载客户端文件失败: {}", e), Some(e)));
            }
        }
    }

    if ctx.is_cancelled() {
        return Err(ctx.cancelled());
    }
    Ok(())
}
