// api/launch_preflight.rs — 启动前检查、参数预览、诊断与失败日志
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::api::ApiResult;
use crate::launch::{self, dep_check};
use crate::storage;
use crate::utils;

use super::{clean_external_marker, resolve_external_version_dir};

/// 写入启动失败日志到 DATA_DIR/logs/launch-fail-{timestamp}.json
pub(super) fn write_launch_fail_log(version_id: &str, error: &str) {
    let data_dir = storage::resolve_data_dir();
    let logs_dir = data_dir.join("logs");
    if std::fs::create_dir_all(&logs_dir).is_err() {
        return;
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let log_file = logs_dir.join(format!("launch-fail-{}.json", timestamp));
    let log_content = json!({
        "versionId": version_id,
        "error": error,
        "timestamp": format!("{}", timestamp)
    });
    let _ = std::fs::write(&log_file, log_content.to_string());
}

/// POST /api/launch/cancel — 取消启动并清理游戏实例
pub(super) fn handle_launch_cancel() -> ApiResult {
    // 终止所有运行中的游戏实例
    let _pids = launch::stop_all();
    ApiResult::ok(json!({
        "success": true,
        "message": "启动已取消"
    }))
}

/// POST /api/launch/check — 检查版本依赖完整性
pub(super) fn handle_launch_check(_params: &Option<Value>, body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let version_id = utils::get_str(&data, "versionId").to_string();
    if version_id.is_empty() {
        return ApiResult::err(400, "Missing versionId");
    }

    let clean_id = clean_external_marker(&version_id);
    let settings = storage::load_settings();
    let external_dir = resolve_external_version_dir(&version_id);
    let external_path = external_dir.as_ref().map(PathBuf::from);

    let dep_result = dep_check::check_dependencies(&clean_id, &settings, external_path.as_deref());

    // 把 dep_result 的字段展开到顶层
    // 前端直接用 depCheck.java / depCheck.maxVersion 等访问
    let mut body = serde_json::Map::new();
    body.insert("success".to_string(), Value::Bool(true));
    if let Value::Object(map) = dep_result.to_json() {
        for (k, v) in map {
            body.insert(k, v);
        }
    }
    ApiResult::ok(Value::Object(body))
}

/// POST /api/launch/args-preview — 预览启动参数（不实际启动）
pub(super) fn handle_args_preview(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let version_id = utils::get_str(&data, "versionId").to_string();
    if version_id.is_empty() {
        return ApiResult::err(400, "Missing versionId");
    }

    let clean_id = clean_external_marker(&version_id);
    let settings = storage::load_settings();

    // 解析版本 JSON
    let external_dir = resolve_external_version_dir(&version_id);
    let external_path = external_dir.as_ref().map(PathBuf::from);
    let version_json = match dep_check::merge_version_json_chain(&clean_id, external_path.as_deref()) {
        Some(v) => v,
        None => return ApiResult::err(400, "版本 JSON 缺失或损坏"),
    };

    // 使用默认离线账号预览（不依赖账号存在）
    let account = json!({
        "username": "Player",
        "uuid": "",
        "accessToken": "",
        "type": "offline"
    });

    let launch_args = launch::build_launch_arguments(
        &version_json,
        &settings,
        &account,
        &clean_id,
        None,
        external_path.as_deref(),
        None,
    );

    let java_path = dep_check::select_java_for_version(&clean_id, &settings, &version_json);

    ApiResult::ok(json!({
        "args": launch_args.args,
        "maxMemMB": launch_args.max_mem_mb,
        "javaPath": java_path
    }))
}

/// GET /api/launch/diagnose — 诊断启动配置
/// 构建 classpath、检查缺失库、查找主 jar、预览启动参数
pub(super) fn handle_diagnose(params: &Option<Value>) -> ApiResult {
    let version_id = params
        .as_ref()
        .and_then(|p| p.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if version_id.is_empty() {
        return ApiResult::err(400, "Missing versionId");
    }

    let clean_id = clean_external_marker(version_id);
    let external_dir = resolve_external_version_dir(version_id);
    let external_path = external_dir.as_ref().map(PathBuf::from);

    let version_json = match dep_check::merge_version_json_chain(&clean_id, external_path.as_deref()) {
        Some(v) => v,
        None => return ApiResult::err(400, "版本 JSON 缺失或损坏"),
    };

    let settings = storage::load_settings();
    let java_path = dep_check::select_java_for_version(&clean_id, &settings, &version_json);

    // 主类 / inheritsFrom / libraries 数量
    let main_class = utils::get_str(&version_json, "mainClass");
    let inherits_from = utils::get_str(&version_json, "inheritsFrom");
    let libraries_count = version_json
        .get("libraries")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    // 构建 classpath 并检查每个条目是否存在
    let data_dir = storage::resolve_data_dir();
    let libraries_dir = data_dir.join("libraries");
    let classpath_entries =
        launch::args_builder::build_classpath(&version_json, external_path.as_deref(), &libraries_dir);

    let mut missing_libraries: Vec<String> = Vec::new();
    let mut critical_missing: Vec<String> = Vec::new();
    let critical_keywords = [
        "securejarhandler",
        "forge",
        "neoforge",
        "fmlloader",
        "modlauncher",
        "fabric-loader",
        "launchwrapper",
        "log4j",
        "lwjgl",
    ];

    for entry in &classpath_entries {
        let path = std::path::Path::new(entry);
        if !path.exists() {
            missing_libraries.push(entry.clone());
            let basename = path
                .file_name()
                .map(|f| f.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if critical_keywords.iter().any(|kw| basename.contains(kw)) {
                critical_missing.push(entry.clone());
            }
        }
    }

    // 查找主 jar 文件（使用 dep_check::find_main_jar 确保继承链搜索）
    let main_jar_found = dep_check::find_main_jar(&version_json, &clean_id, external_path.as_deref())
        .map(|p| p.exists())
        .unwrap_or(false);
    let main_jar_path = dep_check::find_main_jar(&version_json, &clean_id, external_path.as_deref())
        .map(|p| p.to_string_lossy().to_string());

    // 选择当前账号（找不到则用默认离线账号）
    let accounts = storage::load_accounts();
    let selected_account_id = utils::get_str(&settings, "selectedAccount").to_string();
    let account = accounts
        .get("accounts")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|a| utils::get_str(a, "id") == selected_account_id)
                .cloned()
        })
        .or_else(|| {
            accounts
                .get("accounts")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first().cloned())
        })
        .unwrap_or_else(|| {
            json!({
                "username": "Player",
                "uuid": "",
                "accessToken": "",
                "type": "offline"
            })
        });

    // 预览启动参数并估算命令行长度
    let launch_args = launch::build_launch_arguments(
        &version_json,
        &settings,
        &account,
        &clean_id,
        None,
        external_path.as_deref(),
        None,
    );
    let args_count = launch_args.args.len();
    let cmd_len = java_path.len() + launch_args.args.iter().map(|a| a.len() + 3).sum::<usize>();

    let result = json!({
        "versionId": clean_id,
        "externalDir": external_dir,
        "mainClass": main_class,
        "inheritsFrom": inherits_from,
        "librariesCount": libraries_count,
        "javaPath": java_path,
        "classpathEntries": classpath_entries,
        "missingLibraries": missing_libraries,
        "criticalMissing": critical_missing,
        "mainJarFound": main_jar_found,
        "mainJarPath": main_jar_path,
        "argsPreview": launch_args.args,
        "argsCount": args_count,
        "estimatedCmdLength": cmd_len
    });

    ApiResult::ok(result)
}
