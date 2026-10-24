// install/context.rs — 安装上下文与共享工具
// 职责：保存安装过程共享状态，提供进度更新、取消检查、日志与目录清理能力。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use serde_json::Value;
use tauri::AppHandle;

use super::session::{self, InstallStage};

/// 安装阶段权重
const STAGE_WEIGHTS: &[(InstallStage, u32)] = &[
    (InstallStage::VersionJson, 1),
    (InstallStage::ClientJar, 5),
    (InstallStage::Libraries, 15),
    (InstallStage::Natives, 1),
    (InstallStage::Assets, 20),
    (InstallStage::Loader, 10),
    (InstallStage::Finalizing, 1),
];

/// 计算累计进度（0-99）
pub(crate) fn calc_progress(current_stage: &InstallStage, stage_pct: u32) -> u32 {
    let mut total = 0u32;
    let total_weight: u32 = STAGE_WEIGHTS.iter().map(|(_, w)| w).sum();
    let mut in_current = false;
    for (stage, weight) in STAGE_WEIGHTS {
        if stage == current_stage {
            in_current = true;
            total += weight * stage_pct.min(100) / 100;
            break;
        }
        total += weight;
    }
    if !in_current {
        return 99;
    }
    (total * 99 / total_weight.max(1)).min(99)
}

/// 安装阶段错误：阶段内部已完成会话状态与日志记录，编排层只需停止后续阶段
#[derive(Debug)]
pub(crate) enum StageError {
    Cancelled,
    Failed,
}

/// 安装失败/取消时清理版本目录：
/// 只有本次新建的目录才允许删除，已有版本目录一律保留（含 mods/、saves/、options.txt）。
pub(crate) fn cleanup_failed_version_dir(version_dir: &std::path::Path, version_dir_was_new: bool) {
    if version_dir_was_new {
        let _ = std::fs::remove_dir_all(version_dir);
    }
}

/// 追加一行到 logs/install-download.log（安装流程下载日志）
pub(crate) fn append_install_log(data_dir: &std::path::Path, line: &str) {
    let log_dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("install-download.log");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = writeln!(f, "{}", line);
    }
}

/// 当前时间文本（日志用）
pub(crate) fn log_now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// 安装上下文：一次安装会话内共享的路径、设置与状态
pub(crate) struct InstallCtx {
    pub app: AppHandle,
    pub session_id: String,
    pub data_dir: PathBuf,
    pub versions_dir: PathBuf,
    pub libraries_dir: PathBuf,
    pub assets_dir: PathBuf,
    pub settings: Value,
    pub download_source: String,
    pub version_id: String,
    pub actual_version_id: String,
    pub loader_info: Option<Value>,
    pub cancel: Arc<std::sync::atomic::AtomicBool>,
    game_version: OnceLock<String>,
    merge_only_loader: bool,
    version_dir_was_new: AtomicBool,
}

impl InstallCtx {
    /// 创建上下文；合并式加载器（Fabric/OptiFine）不落地独立原版目录
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        app: AppHandle,
        session_id: String,
        version_id: String,
        custom_name: Option<String>,
        loader_info: Option<Value>,
        download_source: String,
        settings: Value,
        cancel: Arc<std::sync::atomic::AtomicBool>,
    ) -> Self {
        let data_dir = crate::storage::resolve_data_dir();
        let actual_version_id = custom_name
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| version_id.clone());
        let merge_only_loader = loader_info
            .as_ref()
            .and_then(|l| l.get("type"))
            .and_then(|v| v.as_str())
            .is_some_and(|t| t == "fabric" || t == "optifine");
        Self {
            app,
            session_id,
            versions_dir: data_dir.join("versions"),
            libraries_dir: data_dir.join("libraries"),
            assets_dir: data_dir.join("assets"),
            data_dir,
            settings,
            download_source,
            version_id,
            actual_version_id,
            loader_info,
            cancel,
            game_version: OnceLock::new(),
            merge_only_loader,
            version_dir_was_new: AtomicBool::new(false),
        }
    }

    /// 基础版本号（由版本 JSON 阶段写入）
    pub fn game_version(&self) -> &str {
        self.game_version.get().map(|s| s.as_str()).unwrap_or("")
    }

    /// 写入基础版本号
    pub fn set_game_version(&self, value: String) {
        let _ = self.game_version.set(value);
    }

    /// 基础版本目录（versions/<game_version>）
    pub fn version_dir(&self) -> PathBuf {
        self.versions_dir.join(self.game_version())
    }

    /// 是否为合并式加载器（Fabric/OptiFine）
    pub fn merge_only_loader(&self) -> bool {
        self.merge_only_loader
    }

    /// 记录基础版本目录是否由本次安装新建
    pub fn mark_version_dir_state(&self, was_new: bool) {
        self.version_dir_was_new.store(was_new, Ordering::SeqCst);
    }

    /// 基础版本目录是否由本次安装新建
    pub fn version_dir_was_new(&self) -> bool {
        self.version_dir_was_new.load(Ordering::SeqCst)
    }

    /// 失败/取消时清理本次安装新建的基础版本目录
    pub fn cleanup_new_version_dir(&self) {
        if self.version_dir_was_new() {
            cleanup_failed_version_dir(&self.version_dir(), true);
        }
    }

    /// 是否已请求取消
    pub fn is_cancelled(&self) -> bool {
        session::is_cancelled(&self.cancel)
    }

    /// 更新会话进度
    pub fn update(&self, stage: InstallStage, pct: u32, message: &str) {
        session::update_session(&self.app, &self.session_id, |s| {
            s.progress = calc_progress(&stage, pct);
            s.stage = stage.clone();
            s.message = message.to_string();
        });
    }

    /// 记录失败信息并返回阶段错误
    pub fn fail(&self, message: String, push_error: Option<String>) -> StageError {
        session::update_session(&self.app, &self.session_id, |s| {
            s.stage = InstallStage::Failed;
            s.message = message.clone();
            if let Some(err) = push_error {
                s.errors.push(err);
            }
        });
        StageError::Failed
    }

    /// 标记取消并返回阶段错误
    pub fn cancelled(&self) -> StageError {
        session::update_session(&self.app, &self.session_id, |s| {
            s.stage = InstallStage::Cancelled;
            s.progress = 0;
            s.message = "已取消".to_string();
        });
        StageError::Cancelled
    }

    /// 安装完成：写入完成状态、日志并安排会话回收
    pub fn complete(&self) {
        session::update_session(&self.app, &self.session_id, |s| {
            s.stage = InstallStage::Completed;
            s.progress = 100;
            s.message = "安装完成".to_string();
            s.current_file = String::new();
        });
        append_install_log(
            &self.data_dir,
            &format!("[{}] 安装完成: {}", log_now(), self.actual_version_id),
        );
        let sid = self.session_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            session::remove_session(&sid);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_ID: AtomicU32 = AtomicU32::new(0);

    fn temp_case_dir(name: &str) -> std::path::PathBuf {
        let id = TEST_ID.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "verse-install-test-{}-{}-{}",
            std::process::id(),
            id,
            name
        ))
    }

    /// 已有版本目录在安装失败时必须保留用户数据
    #[test]
    fn existing_version_dir_is_preserved_after_failed_install() {
        let dir = temp_case_dir("existing");
        std::fs::create_dir_all(dir.join("mods")).unwrap();
        std::fs::write(dir.join("options.txt"), "keep").unwrap();

        cleanup_failed_version_dir(&dir, false);

        assert!(dir.join("options.txt").exists(), "已有 options.txt 不应被删除");
        assert!(dir.join("mods").is_dir(), "已有 mods 目录不应被删除");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 本次新建的版本目录在安装失败时应被清理
    #[test]
    fn newly_created_version_dir_is_removed_after_failed_install() {
        let dir = temp_case_dir("new");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("client.jar"), "partial").unwrap();

        cleanup_failed_version_dir(&dir, true);

        assert!(!dir.exists(), "本次新建的版本目录应被清理");
    }
}
