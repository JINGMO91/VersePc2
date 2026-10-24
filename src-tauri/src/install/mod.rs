// install/mod.rs — 安装编排模块入口
// 职责：按顺序调用安装阶段，维护安装会话与共享上下文。

pub mod context;
pub mod session;
pub mod stages;

use std::sync::Arc;
use tauri::AppHandle;

use crate::storage;
use crate::utils;
use context::InstallCtx;

/// 安装入口
#[allow(clippy::too_many_arguments)]
pub async fn perform_installation(
    app: AppHandle,
    session_id: String,
    version_id: String,
    version_json_url: String,
    custom_name: Option<String>,
    loader_info: Option<serde_json::Value>,
    download_source_arg: Option<String>,
    cancel_flag: Arc<std::sync::atomic::AtomicBool>,
) {
    let settings = storage::load_settings();
    // 下载源：优先使用前端传入的值，为空时回退到设置值
    let download_source =
        download_source_arg.unwrap_or_else(|| utils::get_str(&settings, "downloadSource"));
    let ctx = InstallCtx::new(
        app,
        session_id,
        version_id,
        custom_name,
        loader_info,
        download_source,
        settings,
        cancel_flag,
    );

    // 阶段 1：版本 JSON（含原版目录落地策略）
    let version_details = match stages::version_json::run(&ctx, &version_json_url).await {
        Ok(details) => details,
        Err(_) => return,
    };
    // 阶段 2：客户端 JAR
    if stages::client_jar::run(&ctx, &version_details).await.is_err() {
        return;
    }
    // 阶段 3：依赖库
    if stages::libraries::run(&ctx, &version_details).await.is_err() {
        return;
    }
    // 阶段 4：资源文件
    if stages::assets::run(&ctx, &version_details).await.is_err() {
        return;
    }
    // 阶段 5：模组加载器
    if stages::loader::run(&ctx).await.is_err() {
        return;
    }

    ctx.complete();
}
