// versions/repair.rs — 版本补全文件的异步修复会话
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use crate::storage;
use crate::utils;

use super::diagnose::chrono_now_millis;


/// 异步修复会话存储：sessionId -> 会话状态
///
/// 说明：
/// - 前端"补全文件"调用 POST /api/version/repair-start 创建会话，返回 sessionId。
/// - 后端 spawn 后台任务执行修复，边执行边更新会话进度。
/// - 前端轮询 GET /api/version/repair-progress 获取进度，可 GET /api/version/repair-cancel 取消。
/// - 会话结束（成功/失败/取消）后由后台任务清理，避免内存泄漏。
pub(crate) static REPAIR_SESSIONS: LazyLock<Mutex<HashMap<String, RepairSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 单个修复会话的状态
#[derive(Clone)]
pub(crate) struct RepairSession {
    version_id: String,
    status: String, // preparing | running | completed | failed | cancelled
    progress: f64,
    stage: String,
    message: String,
    checked_files: u32,
    total_files: u32,
    missing_files: u32,
    repaired_files: u32,
    current_file: String,
    abort: Arc<AtomicBool>,
    created_at: u64,
}

/// POST /api/version/repair — 同步修复缺失的库文件与客户端 jar
///
/// 流程：
/// 1. 复用 dep_check 依赖检查，获取所有缺失文件（含 natives 原生库与客户端 jar）
/// 2. 遍历缺失文件，通过 download_with_mirror 使用用户配置的下载源下载
///
/// 返回：{ success, repaired: N, missing: [...] }
pub(crate) async fn handle_repair(body: &Option<Value>) -> crate::api::ApiResult {
    use crate::api::ApiResult;

    let data = body.clone().unwrap_or(Value::Null);
    let version_id = utils::get_str(&data, "versionId");
    if version_id.is_empty() {
        return ApiResult::err(400, "Missing versionId");
    }

    let data_dir = storage::resolve_data_dir();
    let versions_dir = data_dir.join("versions");
    let version_dir = versions_dir.join(&version_id);

    if !version_dir.exists() {
        return ApiResult::err(404, "版本目录不存在");
    }

    // 使用用户配置的下载源（默认 china-first），避免国内直连官方源超时
    let settings = storage::load_settings();
    let configured_source = utils::get_str(&settings, "downloadSource");
    let download_source = if configured_source.is_empty() {
        "china-first"
    } else {
        configured_source.as_str()
    };

    // 复用依赖检查，获取所有缺失文件（含 natives 原生库与客户端 jar）
    let dep_result = crate::launch::dep_check::check_dependencies(
        &version_id,
        &settings,
        None,
    );

    let mut repaired: u32 = 0;
    let mut missing: Vec<String> = Vec::new();

    for file in &dep_result.missing_files {
        if file.url.is_empty() {
            continue;
        }

        let dest = std::path::PathBuf::from(&file.path);
        if let Some(parent) = dest.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                eprintln!("[repair] 创建目录失败 {}: {}", parent.display(), e);
                missing.push(file.name.clone());
                continue;
            }
        }

        let sha1 = if file.sha1.is_empty() { None } else { Some(file.sha1.as_str()) };
        let size = if file.size > 0 { Some(file.size) } else { None };

        eprintln!("[repair] 下载缺失文件: {}", file.name);
        match crate::download::download_with_mirror(
            &file.url,
            &dest,
            sha1,
            size,
            download_source,
            120,
            None,
        ).await {
            Ok(()) => repaired += 1,
            Err(e) => {
                eprintln!("[repair] 下载失败 {}: {}", file.name, e);
                missing.push(file.name.clone());
            }
        }
    }

    ApiResult::ok(json!({
        "success": missing.is_empty(),
        "repaired": repaired,
        "missing": missing
    }))
}

/// POST /api/version/repair-start — 启动异步修复会话
///
/// 请求体：{ versionId }
/// 返回：{ success, sessionId }
///
/// 后台 spawn 执行修复，边执行边把进度写入 REPAIR_SESSIONS，
/// 前端通过 repair-progress 轮询、repair-cancel 取消。
pub(crate) async fn handle_repair_start(body: &Option<Value>) -> crate::api::ApiResult {
    use crate::api::ApiResult;

    let data = body.clone().unwrap_or(Value::Null);
    let version_id = utils::get_str(&data, "versionId");
    if version_id.is_empty() {
        return ApiResult::err(400, "Missing versionId");
    }

    let data_dir = storage::resolve_data_dir();
    let versions_dir = data_dir.join("versions");
    let version_dir = versions_dir.join(&version_id);

    if !version_dir.exists() {
        return ApiResult::err(404, "版本目录不存在");
    }

    let session_id = format!("repair_{}_{}", version_id, chrono_now_millis());
    let abort = Arc::new(AtomicBool::new(false));

    {
        let mut guard = REPAIR_SESSIONS.lock().unwrap();
        guard.insert(session_id.clone(), RepairSession {
            version_id: version_id.clone(),
            status: "preparing".to_string(),
            progress: 0.0,
            stage: "preparing".to_string(),
            message: "准备修复...".to_string(),
            checked_files: 0,
            total_files: 0,
            missing_files: 0,
            repaired_files: 0,
            current_file: String::new(),
            abort: abort.clone(),
            created_at: chrono_now_millis(),
        });
    }

    // 后台执行修复
    let sid = session_id.clone();
    let vid = version_id.clone();
    tokio::spawn(async move {
        run_repair_session(&sid, &vid, abort).await;
    });

    ApiResult::ok(json!({ "success": true, "sessionId": session_id }))
}

/// GET /api/version/repair-progress — 查询修复进度
///
/// 查询参数：{ sessionId }
/// 返回：{ status, progress, message, stage, checkedFiles, totalFiles, missingFiles, repairedFiles, currentFile }
pub(crate) fn handle_repair_progress(params: &Option<Value>) -> crate::api::ApiResult {
    use crate::api::ApiResult;

    let params = params.as_ref().unwrap_or(&Value::Null);
    let session_id = utils::get_str(&params, "sessionId");
    if session_id.is_empty() {
        return ApiResult::err(400, "Missing sessionId");
    }

    let guard = REPAIR_SESSIONS.lock().unwrap();
    let Some(s) = guard.get(&session_id) else {
        return ApiResult::err(404, "Invalid session");
    };

    ApiResult::ok(json!({
        "status": s.status,
        "progress": s.progress,
        "message": s.message,
        "stage": s.stage,
        "checkedFiles": s.checked_files,
        "totalFiles": s.total_files,
        "missingFiles": s.missing_files,
        "repairedFiles": s.repaired_files,
        "currentFile": s.current_file
    }))
}

/// GET /api/version/repair-cancel — 取消修复会话
///
/// 查询参数：{ sessionId }
pub(crate) async fn handle_repair_cancel(params: &Option<Value>) -> crate::api::ApiResult {
    use crate::api::ApiResult;

    let params = params.as_ref().unwrap_or(&Value::Null);
    let session_id = utils::get_str(&params, "sessionId");
    if session_id.is_empty() {
        return ApiResult::err(400, "Missing sessionId");
    }

    let guard = REPAIR_SESSIONS.lock().unwrap();
    let Some(s) = guard.get(&session_id) else {
        return ApiResult::err(404, "Invalid session");
    };
    s.abort.store(true, Ordering::SeqCst);
    ApiResult::ok(json!({ "success": true }))
}

/// 后台执行一次修复会话，边执行边更新 REPAIR_SESSIONS 中的进度
pub(crate) async fn run_repair_session(session_id: &str, version_id: &str, abort: Arc<AtomicBool>) {
    let is_aborted = || abort.load(Ordering::SeqCst);

    // 使用用户配置的下载源（默认 china-first）
    let settings = storage::load_settings();
    let configured_source = utils::get_str(&settings, "downloadSource");
    let download_source = if configured_source.is_empty() {
        "china-first".to_string()
    } else {
        configured_source
    };

    // 更新会话状态为 running
    {
        let mut guard = REPAIR_SESSIONS.lock().unwrap();
        if let Some(s) = guard.get_mut(session_id) {
            s.status = "running".to_string();
            s.stage = "scanning".to_string();
            s.message = "正在扫描缺失文件...".to_string();
            s.progress = 5.0;
        }
    }

    // 复用依赖检查，获取所有缺失文件
    let dep_result = crate::launch::dep_check::check_dependencies(version_id, &settings, None);

    let missing_files: Vec<_> = dep_result
        .missing_files
        .iter()
        .filter(|f| !f.url.is_empty())
        .cloned()
        .collect();
    let total = missing_files.len();

    {
        let mut guard = REPAIR_SESSIONS.lock().unwrap();
        if let Some(s) = guard.get_mut(session_id) {
            s.total_files = total as u32;
            s.missing_files = total as u32;
            s.message = format!("正在修复 {} 个缺失文件...", total);
        }
    }

    if is_aborted() {
        finalize_repair_session(session_id, "cancelled", "修复已取消");
        schedule_repair_cleanup(session_id);
        return;
    }

    // 并发下载缺失文件
    const PARALLEL: usize = 8;
    let repaired = std::sync::Arc::new(std::sync::Mutex::new(0u32));
    // 为并发流克隆引用，保留原变量供完成阶段使用
    let abort_stream = abort.clone();
    let repaired_stream = repaired.clone();

    use futures_util::StreamExt;
    let files: Vec<_> = missing_files
        .into_iter()
        .map(|f| {
            let d = std::path::PathBuf::from(&f.path);
            (f, d)
        })
        .collect();
    futures_util::stream::iter(files)
        .for_each_concurrent(PARALLEL, move |(file, dest)| {
            let repaired_cur = repaired_stream.clone();
            let abort_cur = abort_stream.clone();
            let source_cur = download_source.clone();
            async move {
                if abort_cur.load(Ordering::SeqCst) {
                    return;
                }
                if let Some(parent) = dest.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        eprintln!("[repair] 创建目录失败 {}: {}", parent.display(), e);
                        return;
                    }
                }
                let sha1 = if file.sha1.is_empty() { None } else { Some(file.sha1.clone()) };
                let size = if file.size > 0 { Some(file.size) } else { None };
                match crate::download::download_with_mirror_retry(
                    &file.url,
                    &dest,
                    sha1.as_deref(),
                    size,
                    &source_cur,
                    120,
                )
                .await
                {
                    Ok(()) => {
                        let r = {
                            let mut rc = repaired_cur.lock().unwrap();
                            *rc += 1;
                            *rc
                        };
                        let prog = 5.0 + (r as f64 / total.max(1) as f64) * 90.0;
                        let mut guard = REPAIR_SESSIONS.lock().unwrap();
                        if let Some(s) = guard.get_mut(session_id) {
                            s.repaired_files = r;
                            s.checked_files = r;
                            s.progress = prog;
                            s.current_file = file.name.clone();
                            s.message = format!("正在修复: {}", file.name);
                        }
                    }
                    Err(e) => {
                        eprintln!("[repair] 下载失败 {}: {}", file.name, e);
                    }
                }
            }
        })
        .await;

    let repaired = { *repaired.lock().unwrap() };
    let remaining = total as u32 - repaired;
    if is_aborted() {
        finalize_repair_session(session_id, "cancelled", "修复已取消");
    } else if remaining == 0 {
        finalize_repair_session(session_id, "completed", "文件修复完成！");
    } else {
        finalize_repair_session(
            session_id,
            if repaired > 0 { "completed" } else { "failed" },
            &format!("修复完成，{} 个文件修复失败", remaining),
        );
    }
    schedule_repair_cleanup(session_id);
}

/// 结束会话并写最终状态
pub(crate) fn finalize_repair_session(session_id: &str, status: &str, message: &str) {
    let mut guard = REPAIR_SESSIONS.lock().unwrap();
    if let Some(s) = guard.get_mut(session_id) {
        s.status = status.to_string();
        s.stage = status.to_string();
        s.message = message.to_string();
        s.progress = if status == "completed" { 100.0 } else { s.progress };
    }
}

/// 会话结束后延迟清理，避免长期累积未完成会话占用内存
pub(crate) fn schedule_repair_cleanup(session_id: &str) {
    let sid = session_id.to_string();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        REPAIR_SESSIONS.lock().unwrap().remove(&sid);
    });
}
