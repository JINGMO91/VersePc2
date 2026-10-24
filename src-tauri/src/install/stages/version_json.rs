// install/stages/version_json.rs — 版本 JSON 阶段
// 职责：拉取版本详情，确定基础版本号，并按加载器类型决定是否落地真实原版目录。

use serde_json::Value;

use crate::install::context::{append_install_log, log_now, InstallCtx, StageError};
use crate::install::session;

/// 执行版本 JSON 阶段，返回版本详情供后续阶段使用
pub(crate) async fn run(ctx: &InstallCtx, version_json_url: &str) -> Result<Value, StageError> {
    ctx.update(session::InstallStage::VersionJson, 0, "获取版本信息...");
    let version_details = match fetch_json(version_json_url, &ctx.download_source).await {
        Ok(v) => v,
        Err(e) => {
            append_install_log(
                &ctx.data_dir,
                &format!(
                    "[{}] 获取版本信息失败: {} — {}",
                    log_now(),
                    ctx.version_id,
                    e
                ),
            );
            return Err(ctx.fail(format!("获取版本信息失败: {}", e), Some(e)));
        }
    };

    // 基础版本号：整合包用 inheritsFrom，普通版本用原始下载版本号。
    // 不能回退到 actual_version_id（自定义名），否则原版会被装到带加载器后缀的目录。
    let game_version = version_details
        .get("inheritsFrom")
        .and_then(|v| v.as_str())
        .unwrap_or(&ctx.version_id)
        .to_string();
    ctx.set_game_version(game_version);

    // 记录版本目录是否由本次安装新建：只有本次新建的目录，失败/取消时才允许整目录清理。
    let version_dir = ctx.version_dir();
    ctx.mark_version_dir_state(!ctx.merge_only_loader() && !version_dir.exists());

    // 合并式加载器（Fabric/OptiFine）不写真实原版目录，由加载器阶段直接合并成单一实例；
    // Forge/NeoForge 安装器需要真实版本目录里存在原版 JSON 与 client.jar。
    if !ctx.merge_only_loader() {
        let version_json_path = version_dir.join(format!("{}.json", ctx.game_version()));
        if let Err(e) = tokio::fs::create_dir_all(&version_dir).await {
            append_install_log(
                &ctx.data_dir,
                &format!(
                    "[{}] 创建版本目录失败: {} — {}",
                    log_now(),
                    version_dir.display(),
                    e
                ),
            );
            return Err(ctx.fail(format!("创建版本目录失败: {}", e), None));
        }
        let json_str = serde_json::to_string_pretty(&version_details).unwrap_or_default();
        if let Err(e) = tokio::fs::write(&version_json_path, &json_str).await {
            ctx.cleanup_new_version_dir();
            append_install_log(
                &ctx.data_dir,
                &format!(
                    "[{}] 写入版本 JSON 失败: {} — {}",
                    log_now(),
                    version_json_path.display(),
                    e
                ),
            );
            return Err(ctx.fail(format!("写入版本 JSON 失败: {}", e), None));
        }
    }

    ctx.update(session::InstallStage::VersionJson, 100, "版本信息已获取");
    if ctx.is_cancelled() {
        return Err(ctx.cancelled());
    }
    Ok(version_details)
}

/// 拉取 JSON（带镜像回退）
async fn fetch_json(url: &str, download_source: &str) -> Result<Value, String> {
    use crate::download::mirror;

    let urls = mirror::get_mirror_urls(url, download_source);
    let mut last_err = String::new();

    for u in &urls {
        match reqwest::get(u).await {
            Ok(resp) => {
                if resp.status().is_success() {
                    match resp.json::<Value>().await {
                        Ok(v) => {
                            if u != url {
                                mirror::mirror_success();
                            }
                            return Ok(v);
                        }
                        Err(e) => last_err = format!("解析 JSON 失败: {}", e),
                    }
                } else {
                    last_err = format!("HTTP {}", resp.status());
                }
            }
            Err(e) => {
                last_err = format!("请求失败: {}", e);
                if u != url {
                    mirror::mirror_failed();
                }
            }
        }
    }
    Err(last_err)
}
