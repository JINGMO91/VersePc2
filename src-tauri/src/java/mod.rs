#![allow(unused_imports)]

// java.rs — Java 检测与文件系统命令
// 模块职责：
//   1. 扫描常见目录查找已安装的 Java
//   2. 执行 java -version 解析版本
//   3. 读写 custom-java-list.json（手动添加的 Java）
//   4. 当前 Java 路径存到 settings.json
//
//   - 简化扫描目录（只扫 Program Files / JAVA_HOME / .minecraft/runtime 等几个常见位置）
//   - 不依赖 worker_thread（Tauri 用 async 命令，不会阻塞主进程）
//   - 不修改系统环境变量（避免权限问题，只存到 settings.json）

use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use crate::modloaders::shared;
use crate::storage;
use crate::utils;

/// Java 检测结果缓存（一次启动内只扫一次）
/// 后续调用直接返回缓存
static JAVA_CACHE: Mutex<Option<JavaCache>> = Mutex::new(None);

/// 已取消的 Java 下载会话集合
/// install/download 实现后会在下载循环中查询此集合
static CANCELLED_SESSIONS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

#[derive(Clone)]
#[allow(dead_code)]
struct JavaCache {
    java_list: Vec<Value>,
    cached_at: u64,
}

/// 当前平台的 Java 可执行文件名（macOS/Linux 为 java）
fn java_bin_name() -> &'static str {
    crate::platform::java_bin_name()
}

/// 当前平台的 javac 文件名（用于判断是否为 JDK）
fn javac_bin_name() -> &'static str {
    crate::platform::javac_bin_name()
}
























/// 强制刷新缓存（手动添加 / 设置当前 Java 后调用）
pub fn invalidate_cache() {
    let mut cache = JAVA_CACHE.lock().unwrap();
    *cache = None;
}

/// 标记某个下载会话为已取消
/// install/download 路由实现后会在下载循环中查询此状态并主动中止
pub fn cancel_java_download(session_id: &str) {
    let mut guard = CANCELLED_SESSIONS.lock().unwrap();
    let set = guard.get_or_insert_with(HashSet::new);
    set.insert(session_id.to_string());
    eprintln!("[java] 已标记会话 {} 为取消状态", session_id);
}

/// 查询某个下载会话是否已被取消（供 install/download 路由使用）
pub fn is_java_download_cancelled(session_id: &str) -> bool {
    let guard = CANCELLED_SESSIONS.lock().unwrap();
    guard
        .as_ref()
        .map(|s| s.contains(session_id))
        .unwrap_or(false)
}

/// 清理已结束会话的取消标记（install/download 完成后调用）
pub fn clear_cancelled_session(session_id: &str) {
    let mut guard = CANCELLED_SESSIONS.lock().unwrap();
    if let Some(set) = guard.as_mut() {
        set.remove(session_id);
    }
}

// ============== Java 下载/安装（简化版） ==============

/// 写入状态文件
fn write_java_status(session_id: &str, status: &Value) {
    let data_dir = storage::resolve_data_dir();
    let status_file = data_dir.join(format!("java-download-{}.json", session_id));
    if let Ok(s) = serde_json::to_string_pretty(status) {
        let _ = std::fs::write(&status_file, s);
    }
}

/// 读取状态文件
fn read_java_status(session_id: &str) -> Option<Value> {
    let data_dir = storage::resolve_data_dir();
    let status_file = data_dir.join(format!("java-download-{}.json", session_id));
    std::fs::read_to_string(&status_file)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
}

// ============== Java 导入（压缩包/文件夹） ==============
// 以及 server/api/routes/java.js 的 /api/java/import 路由。
// 导入成功后将解压/复制后的 Java 写入 custom-java-list.json（source='imported'）。

/// 写入导入状态文件（java-import-{sessionId}.json）
fn write_java_import_status(session_id: &str, status: &Value) {
    let data_dir = storage::resolve_data_dir();
    let status_file = data_dir.join(format!("java-import-{}.json", session_id));
    if let Ok(s) = serde_json::to_string_pretty(status) {
        let _ = std::fs::write(&status_file, s);
    }
}

/// 读取导入状态文件
fn read_java_import_status(session_id: &str) -> Option<Value> {
    let data_dir = storage::resolve_data_dir();
    let status_file = data_dir.join(format!("java-import-{}.json", session_id));
    std::fs::read_to_string(&status_file)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
}











// ============== Tauri 命令 ==============

/// Tauri 命令：java_detect
#[tauri::command]
#[allow(dead_code)]
pub async fn java_detect() -> Value {
    let java_list = tokio::task::spawn_blocking(detect_all).await.unwrap_or_default();

    let has_java = !java_list.is_empty();
    let has_java17 = java_list
        .iter()
        .any(|j| j.get("majorVersion").and_then(|v| v.as_u64()) == Some(17));
    let has_java21 = java_list
        .iter()
        .any(|j| j.get("majorVersion").and_then(|v| v.as_u64()) == Some(21));

    json!({
        "success": true,
        "platform": std::env::consts::OS,
        "javaList": java_list,
        "hasJava": has_java,
        "hasJava17": has_java17,
        "hasJava21": has_java21
    })
}

/// api_proxy 路由处理：Java 相关
pub fn handle(method: &str, path: &str, params: &Option<Value>, body: &Option<Value>) -> Option<crate::api::ApiResult> {
    use crate::api::ApiResult;

    let key = format!("{} {}", method.to_uppercase(), path);

    match key.as_str() {
        "GET /api/java/detect" => {
            let java_list = detect_all();
            let has_java = !java_list.is_empty();
            let has_java17 = java_list.iter().any(|j| {
                j.get("majorVersion").and_then(|v| v.as_u64()) == Some(17)
            });
            let has_java21 = java_list.iter().any(|j| {
                j.get("majorVersion").and_then(|v| v.as_u64()) == Some(21)
            });
            Some(ApiResult::ok(json!({
                "success": true,
                "platform": std::env::consts::OS,
                "javaList": java_list,
                "hasJava": has_java,
                "hasJava17": has_java17,
                "hasJava21": has_java21
            })))
        }

        "GET /api/java/installed" => {
            let java_list = detect_all();
            let settings = storage::load_settings();
            let current_java_path = utils::get_str(&settings, "javaPath");
            let total = java_list.len();
            Some(ApiResult::ok(json!({
                "java": java_list,
                "total": total,
                "currentJavaPath": current_java_path,
                "detecting": false
            })))
        }

        "GET /api/java/list" => Some(ApiResult::ok(json!({
            "versions": [
                { "majorVersion": 8, "version": "Java 8", "source": "Mojang 官方" },
                { "majorVersion": 17, "version": "Java 17", "source": "Mojang 官方" },
                { "majorVersion": 21, "version": "Java 21", "source": "Mojang 官方" },
                { "majorVersion": 25, "version": "Java 25", "source": "Mojang 官方" }
            ]
        }))),

        "POST /api/java/set-current" => {
            let data = body.clone().unwrap_or(Value::Null);
            let java_path = utils::get_str(&data, "javaPath");
            if java_path.is_empty() {
                return Some(ApiResult::err(400, "Missing javaPath"));
            }
            let mut settings = storage::load_settings();
            if let Some(obj) = settings.as_object_mut() {
                obj.insert("javaPath".to_string(), json!(java_path));
            }
            storage::overwrite_settings(&settings);
            Some(ApiResult::ok(json!({ "success": true, "message": "已设为当前 Java" })))
        }

        "POST /api/java/add-manual" => {
            let data = body.clone().unwrap_or(Value::Null);
            // 前端 api.js 传入字段为 javaPath
            let path_str = utils::get_str(&data, "javaPath");
            if path_str.is_empty() {
                return Some(ApiResult::err(400, "Missing javaPath"));
            }
            let path = PathBuf::from(&path_str);
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
            if !["java.exe", "java", "javaw.exe"].contains(&file_name.as_str()) {
                return Some(ApiResult::err(400, "请选择 java.exe 或 java 可执行文件"));
            }
            if !path.exists() {
                return Some(ApiResult::err(400, "文件不存在"));
            }

            // 探测版本
            let (version, major, is64) = inspect_java(&path).unwrap_or(("未知".to_string(), 0, true));
            let java_home = path
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let entry = json!({
                "path": path_str,
                "javaHome": java_home,
                "source": "manual",
                "addedAt": utils::now_iso(),
                "majorVersion": major,
                "minorVersion": 0,
                "version": version,
                "isJdk": true,
                "is64Bit": is64
            });

            // 加到 custom-java-list.json
            let mut custom = load_custom_java();
            if let Some(arr) = custom.as_array_mut() {
                // 去重
                arr.retain(|v| utils::get_str(v, "path").to_lowercase().replace('\\', "/") != path_str.to_lowercase().replace('\\', "/"));
                arr.push(entry.clone());
            } else {
                custom = Value::Array(vec![entry.clone()]);
            }
            save_custom_java(&custom.as_array().cloned().unwrap_or_default());
            invalidate_cache();

            Some(ApiResult::ok(json!({
                "success": true,
                "message": format!("已添加 Java {}", major),
                "entry": entry
            })))
        }

        "POST /api/java/remove-custom" => {
            let data = body.clone().unwrap_or(Value::Null);
            // 前端 api.js 传入字段为 javaHome
            let java_home_str = utils::get_str(&data, "javaHome");
            let delete_files = data.get("deleteFiles").and_then(|v| v.as_bool()).unwrap_or(false);
            if java_home_str.is_empty() {
                return Some(ApiResult::err(400, "Missing javaHome"));
            }
            let mut custom = load_custom_java();
            let removed_entry: Option<Value> = if let Some(arr) = custom.as_array_mut() {
                let idx = arr.iter().position(|v| {
                    utils::get_str(v, "javaHome").to_lowercase().replace('\\', "/")
                        == java_home_str.to_lowercase().replace('\\', "/")
                });
                idx.map(|i| arr.remove(i))
            } else {
                None
            };
            save_custom_java(&custom.as_array().cloned().unwrap_or_default());
            invalidate_cache();

            // 仅 source=imported 且请求删除文件时才删除目录；manual 是原位引用不删。
            // 再叠加托管目录校验，避免条目里的 javaHome 指向系统目录时误删
            if delete_files
                && let Some(entry) = &removed_entry {
                    let source = utils::get_str(entry, "source");
                    if source == "imported" {
                        let java_home = utils::get_str(entry, "javaHome");
                        if !java_home.is_empty() && is_managed_java_home(Path::new(&java_home)) {
                            let _ = std::fs::remove_dir_all(&java_home);
                        }
                    }
                }
            Some(ApiResult::ok(json!({ "success": true })))
        }

        // 下载/安装相关路由暂未迁移
        "GET /api/java/download-sources" => Some(ApiResult::ok(json!({
            "sources": [
                { "id": "adoptium", "name": "Adoptium (Temurin)", "url": "https://adoptium.net" },
                { "id": "amazon", "name": "Amazon Corretto", "url": "https://aws.amazon.com/corretto" },
                { "id": "microsoft", "name": "Microsoft OpenJDK", "url": "https://microsoft.com/openjdk" },
                { "id": "zulu", "name": "Azul Zulu", "url": "https://www.azul.com" }
            ]
        }))),

        "GET /api/java/install-status" | "GET /api/java/download-status" => {
            let session_id = params
                .as_ref()
                .and_then(|p| p.get("sessionId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if session_id.is_empty() {
                return Some(ApiResult::ok(json!({
                    "status": "idle",
                    "progress": 0,
                    "message": "缺少 sessionId 参数"
                })));
            }

            match read_java_status(session_id) {
                Some(st) => Some(ApiResult::ok(st)),
                None => Some(ApiResult::ok(json!({
                    "status": "not_found",
                    "progress": 0,
                    "message": "未找到会话状态"
                }))),
            }
        }

        "GET /api/java/import-status" => {
            let session_id = params
                .as_ref()
                .and_then(|p| p.get("sessionId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if session_id.is_empty() {
                return Some(ApiResult::ok(json!({
                    "status": "idle",
                    "progress": 0,
                    "message": "缺少 sessionId 参数"
                })));
            }

            match read_java_import_status(session_id) {
                Some(st) => Some(ApiResult::ok(st)),
                None => Some(ApiResult::ok(json!({
                    "status": "not_found",
                    "progress": 0,
                    "message": "未找到导入会话状态"
                }))),
            }
        }

        "POST /api/java/import" => {
            // 导入 Java（压缩包或文件夹）：
            // body: { type: 'archive'|'directory', path: '...' }
            let data = body.clone().unwrap_or(Value::Null);
            let import_type = utils::get_str(&data, "type");
            let source_path = utils::get_str(&data, "path");
            if import_type.is_empty() || source_path.is_empty() {
                return Some(ApiResult::err(400, "缺少 type 或 path 参数"));
            }
            if import_type != "archive" && import_type != "directory" {
                return Some(ApiResult::err(400, "type 必须是 archive 或 directory"));
            }

            let session_id = format!("java-import-{}", chrono::Local::now().timestamp_millis());
            // 初始化导入状态文件
            write_java_import_status(
                &session_id,
                &json!({
                    "status": "starting",
                    "progress": 0,
                    "message": "准备导入...",
                    "sessionId": session_id,
                }),
            );

            // 后台执行导入
            let sid = session_id.clone();
            let itype = import_type.clone();
            let spath = source_path.clone();
            tokio::spawn(async move {
                import_java_async(&sid, &itype, &spath).await;
                // 完成后 60 秒清理状态文件
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                let _ = std::fs::remove_file(
                    storage::resolve_data_dir().join(format!("java-import-{}.json", sid)),
                );
            });

            Some(ApiResult::ok(json!({
                "success": true,
                "sessionId": session_id,
                "status": "starting",
                "message": "已开始导入 Java"
            })))
        }

        // 自动安装：先检测本地已有 Java，满足要求直接返回；否则启动下载
        "POST /api/java/auto-install" => {
            let data = body.clone().unwrap_or(Value::Null);
            let required_version = data
                .get("requiredVersion")
                .and_then(|v| v.as_u64())
                .or_else(|| data.get("majorVersion").and_then(|v| v.as_u64()))
                .unwrap_or(17);
            // 版本上限：1.12.2 等旧版本（launchwrapper）只允许 Java 8，
            // 本地已有更高版本 Java 时不能当作"已满足"，否则自动下载会被跳过
            let max_version = data
                .get("maxVersion")
                .and_then(|v| v.as_u64())
                .filter(|v| *v < 999)
                .unwrap_or(999);

            // 1. 先扫描本地已有 Java，满足要求（在需求范围内）直接返回，不重复下载
            let java_list = detect_all();
            if let Some(j) = java_list.iter().find(|j| {
                let mv = j.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0);
                mv >= required_version && mv <= max_version
            }) {
                return Some(ApiResult::ok(json!({
                    "success": true,
                    "installed": false,
                    "javaPath": utils::get_str(j, "path"),
                    "version": utils::get_str(j, "version"),
                    "majorVersion": j.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(required_version),
                    "message": format!("已检测到合适的 Java {}，无需安装", j.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(required_version))
                })));
            }

            // 2. 没有合适的 Java：启动异步下载安装
            let session_id = uuid::Uuid::new_v4().to_string();
            let sid = session_id.clone();
            tokio::spawn(async move {
                install_java_async(sid, required_version).await;
            });

            Some(ApiResult::ok(json!({
                "success": true,
                "installed": false,
                "sessionId": session_id,
                "status": "fetching",
                "message": format!("正在自动下载 Java {}...", required_version)
            })))
        }

        "POST /api/java/install" | "POST /api/java/download" => {
            let data = body.clone().unwrap_or(Value::Null);
            let major_version = data
                .get("majorVersion")
                .and_then(|v| v.as_u64())
                .or_else(|| data.get("major_version").and_then(|v| v.as_u64()))
                .unwrap_or(17);

            let session_id = data
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

            // 启动后台异步任务
            let sid = session_id.clone();
            tokio::spawn(async move {
                install_java_async(sid, major_version).await;
            });

            Some(ApiResult::ok(json!({
                "success": true,
                "sessionId": session_id,
                "status": "fetching",
                "message": format!("已开始安装 Java {}", major_version)
            })))
        }

        "POST /api/java/configure-env" => {
            // 简化实现：不修改系统环境变量，仅记录到 settings.json
            // 避免系统权限问题
            let data = body.clone().unwrap_or(Value::Null);
            let java_path = crate::utils::get_str(&data, "javaPath").to_string();
            if !java_path.is_empty() {
                let mut settings = storage::load_settings();
                if let Some(obj) = settings.as_object_mut() {
                    obj.insert("javaPath".to_string(), Value::String(java_path.clone()));
                    let _ = storage::save_settings(&settings);
                }
                invalidate_cache();
            }
            Some(ApiResult::ok(json!({
                "success": true,
                "message": "已保存到 settings.json（未修改系统环境变量）"
            })))
        }

        "POST /api/java/delete" => {
            let data = body.clone().unwrap_or(Value::Null);
            // 前端 java-mgr.js 传的是 javaHome（保留 javaPath 兼容旧调用）
            let mut java_home_str = crate::utils::get_str(&data, "javaHome");
            if java_home_str.is_empty() {
                java_home_str = crate::utils::get_str(&data, "javaPath");
            }
            if java_home_str.is_empty() {
                return Some(ApiResult::err(400, "缺少 javaHome 参数"));
            }
            // 允许传 java 可执行文件或 javaHome
            let mut home = PathBuf::from(&java_home_str);
            if !home.join("bin").join(java_bin_name()).exists()
                && let Some(p) = home.parent().and_then(|p| p.parent()) {
                    home = p.to_path_buf();
                }

            // 关键护栏：只允许删除启动器托管目录（data_dir/java）内的 Java。
            // 否则对 java.exe 取 parent().parent() 会把系统 JDK
            // （如 C:\Program Files\Java\jdk-17）当成 javaHome 整个目录删掉。
            if !is_managed_java_home(&home) {
                return Some(ApiResult::ok(json!({
                    "success": false,
                    "error": "只能删除启动器安装的 Java，系统或手动添加的 Java 请勿在此删除",
                    "message": "只能删除启动器安装的 Java"
                })));
            }

            // 不允许删除正在使用的 Java（按 javaHome 规范化后比较）
            let settings = storage::load_settings();
            let current = crate::utils::get_str(&settings, "javaPath");
            if !current.is_empty() {
                let current_exe = PathBuf::from(&current);
                let current_home = current_exe
                    .parent()
                    .and_then(|p| p.parent())
                    .unwrap_or(current_exe.as_path());
                if current_home.canonicalize().ok() == home.canonicalize().ok() {
                    return Some(ApiResult::ok(json!({
                        "success": false,
                        "error": "该 Java 正在使用，请先切换到其他 Java",
                        "message": "该 Java 正在使用，请先切换到其他 Java"
                    })));
                }
            }

            if !home.exists() {
                return Some(ApiResult::err(404, "Java 目录不存在"));
            }
            match std::fs::remove_dir_all(&home) {
                Ok(()) => {
                    invalidate_cache();
                    Some(ApiResult::ok(json!({
                        "success": true,
                        "message": format!("已删除: {}", home.display())
                    })))
                }
                Err(e) => Some(ApiResult::ok(json!({
                    "success": false,
                    "error": format!("删除失败: {}", e)
                }))),
            }
        }

        // ===== 取消 Java 下载任务（GET/POST 共用） =====
        // 实现：设置全局取消标志，让正在下载的 install 任务感知并中止
        // 当前 install/download 路由还是占位，cancel 先返回成功并清理会话
        "GET /api/java/cancel" | "POST /api/java/cancel" => {
            let session_id = params
                .as_ref()
                .and_then(|p| p.get("sessionId"))
                .and_then(|v| v.as_str())
                .or_else(|| {
                    body.as_ref()
                        .and_then(|b| b.get("sessionId"))
                        .and_then(|v| v.as_str())
                })
                .unwrap_or("")
                .to_string();

            if session_id.is_empty() {
                return Some(crate::api::ApiResult::err(400, "缺少sessionId参数"));
            }

            // 设置取消标志（如果会话存在）
            cancel_java_download(&session_id);

            // 同步更新状态文件为已取消
            let data_dir = crate::storage::resolve_data_dir();
            let status_file = data_dir.join(format!("java-download-{}.json", session_id));
            if status_file.exists()
                && let Ok(content) = std::fs::read_to_string(&status_file)
                    && let Ok(mut st) = serde_json::from_str::<Value>(&content) {
                        let current_status = st
                            .get("status")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if current_status != "completed"
                            && current_status != "error"
                            && current_status != "cancelled"
                        {
                            if let Some(obj) = st.as_object_mut() {
                                obj.insert("status".to_string(), json!("cancelled"));
                                obj.insert("message".to_string(), json!("下载已取消"));
                            }
                            let _ = std::fs::write(&status_file, st.to_string());
                        }
                    }

            Some(crate::api::ApiResult::ok(json!({
                "success": true,
                "message": "已取消Java下载"
            })))
        }

        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_version_various_formats() {
        // 新式版本号
        assert_eq!(normalize_version_string("17.0.1"), Some("17.0.1.0".to_string()));
        assert_eq!(normalize_version_string("21.0.7"), Some("21.0.7.0".to_string()));
        // 旧式版本号 1.8.0_301 → 8.0.301.0
        assert_eq!(normalize_version_string("1.8.0_301"), Some("8.0.301.0".to_string()));
        // 带构建号 1.8.0_301-b09
        assert_eq!(normalize_version_string("1.8.0_301-b09"), Some("8.0.301.0".to_string()));
        // 带 + 号（+ 替换为 . 后成为第 4 段）
        assert_eq!(normalize_version_string("17.0.1+12"), Some("17.0.1.12".to_string()));
        // 四段版本
        assert_eq!(normalize_version_string("17.0.1.12"), Some("17.0.1.12".to_string()));
        // 无效版本（主版本过低：1.4.0 去 1. 前缀后主版本 4）
        assert_eq!(normalize_version_string("1.4.0"), None);
        // 无效版本（主版本过高）
        assert_eq!(normalize_version_string("100.0.0"), None);
        // 无法解析
        assert_eq!(normalize_version_string(""), None);
    }

    #[test]
    fn parse_version_major_formats() {
        assert_eq!(parse_version_major("1.8.0_301"), 8);
        assert_eq!(parse_version_major("17.0.1"), 17);
        assert_eq!(parse_version_major("21.0.7"), 21);
        assert_eq!(parse_version_major("26.1.2"), 26);
    }

    #[test]
    fn extract_version_from_output_variants() {
        // 标准 java -version 输出
        let out = "java version \"1.8.0_301\"\nJava(TM) SE Runtime Environment (build 1.8.0_301-b09)";
        assert_eq!(extract_version_from_output(out).as_deref(), Some("1.8.0_301"));
        // OpenJDK 输出
        let out2 = "openjdk version \"17.0.1\" 2021-10-19\nOpenJDK Runtime Environment";
        assert_eq!(extract_version_from_output(out2).as_deref(), Some("17.0.1"));
        // 无版本信息
        assert_eq!(extract_version_from_output("nothing here"), None);
    }

    #[test]
    fn special_path_detection() {
        // Java 8 自动更新重定向目录
        assert!(is_special_path(Path::new(r"C:\ProgramData\Oracle\Java\javapath_target_1.8.0\java.exe")));
        assert!(is_special_path(Path::new(r"C:\Windows\System32\java.exe")));
        assert!(is_special_path(Path::new(r"C:\ProgramData\javatmp\bin\java.exe")));
        assert!(!is_special_path(Path::new(r"C:\Program Files\Java\jdk-17\bin\java.exe")));
    }

    #[test]
    fn sort_java_list_prefers_near_21() {
        let mut list = vec![
            json!({"path": r"C:\x\jdk-8\bin\java.exe", "majorVersion": 8}),
            json!({"path": r"C:\x\jdk-25\bin\java.exe", "majorVersion": 25}),
            json!({"path": r"C:\x\jdk-21\bin\java.exe", "majorVersion": 21}),
            json!({"path": r"C:\x\jdk-17\bin\java.exe", "majorVersion": 17}),
        ];
        sort_java_list(&mut list);
        // 排序后第一个应是接近 21 的 Java 21
        let first = list[0].get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0);
        assert_eq!(first, 21);
    }

    /// 验证 add-manual 路由能正确识别并写入自定义 Java 列表
    #[test]
    fn handle_add_manual_route() {
        // 系统真实存在的 Java（路径不存在则跳过）
        let real_java = r"C:\Program Files\Java\jdk-17\bin\java.exe";
        if !Path::new(real_java).exists() {
            return;
        }
        let body = Some(json!({ "javaPath": real_java }));
        let r = handle("POST", "/api/java/add-manual", &None, &body);
        assert!(r.is_some(), "add-manual 应返回结果");
        let res = r.unwrap();
        assert_eq!(res.status, 200, "add-manual 应成功: {}", res.body);
        assert_eq!(res.body["success"], true, "add-manual 返回: {}", res.body);
        // 清理测试写入的条目，避免污染
        let custom = load_custom_java();
        let cleaned: Vec<Value> = custom
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|e| {
                utils::get_str(e, "path").to_lowercase().replace('\\', "/")
                    != real_java.to_lowercase().replace('\\', "/")
            })
            .collect();
        save_custom_java(&cleaned);
        invalidate_cache();
    }

    /// 验证 directory 导入：把真实 Java Home 复制到启动器目录并写入列表
    #[tokio::test]
    async fn handle_import_directory_route() {
        let real_java = r"C:\Program Files\Java\jdk-17\bin\java.exe";
        if !Path::new(real_java).exists() {
            return;
        }
        let java_home = Path::new(real_java)
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let body = Some(json!({ "type": "directory", "path": java_home }));
        let r = handle("POST", "/api/java/import", &None, &body);
        assert!(r.is_some(), "import 应返回结果");
        let res = r.unwrap();
        assert_eq!(res.status, 200, "import 应成功: {}", res.body);
        let sid = res.body["sessionId"].as_str().unwrap_or("").to_string();
        assert!(!sid.is_empty(), "应返回 sessionId: {}", res.body);

        // 轮询等待后台导入完成（最多 10 秒）
        let mut final_status = String::new();
        for _ in 0..50 {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            let q = handle(
                "GET",
                "/api/java/import-status",
                &Some(json!({ "sessionId": sid })),
                &None,
            );
            if let Some(qr) = q {
                let st = qr.body["status"].as_str().unwrap_or("").to_string();
                if st == "completed" || st == "error" {
                    final_status = qr.body.to_string();
                    break;
                }
            }
        }
        assert!(final_status.contains("\"completed\""), "导入应完成: {}", final_status);
        // 清理测试写入的条目与目录，避免污染
        if let Some(arr) = load_custom_java().as_array().cloned() {
            let mut kept = Vec::new();
            for e in arr {
                if utils::get_str(&e, "source") == "imported"
                    && utils::get_str(&e, "javaHome").contains("imported-jdk-")
                {
                    let home = utils::get_str(&e, "javaHome");
                    if !home.is_empty() {
                        let _ = std::fs::remove_dir_all(&home);
                    }
                    continue;
                }
                kept.push(e);
            }
            save_custom_java(&kept);
            invalidate_cache();
        }
    }

    /// 验证注册表扫描返回的路径都真实存在。
    /// 不依赖本机是否安装 Java，避免不同 CI / 开发机环境导致测试失败。
    #[cfg(target_os = "windows")]
    #[test]
    fn registry_scan_returns_existing_java_paths() {
        let found = scan_registry_java_paths();
        for p in &found {
            assert!(p.exists(), "注册表扫描返回了不存在的路径: {}", p.display());
        }
        eprintln!("[test] 注册表扫描到 {} 个 Java", found.len());
    }

    /// 删除 Java 的护栏：只允许托管目录内的子目录，系统目录与 `..` 绕行必须拒绝
    #[test]
    fn managed_java_home_detection() {
        let base = std::env::temp_dir().join(format!("verse-java-guard-{}", std::process::id()));
        let root = base.join("data").join("java");
        let inside = root.join("imported-jdk-17");
        let outside = base.join("system-jdk");
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        assert!(is_managed_java_home_under(&root, &inside), "托管目录内的 JDK 应允许删除");
        assert!(!is_managed_java_home_under(&root, &outside), "系统 JDK 不应被判定为托管目录");
        assert!(!is_managed_java_home_under(&root, &root), "托管根目录本身不可删除");

        let traversal = root.join("..").join("system-jdk");
        assert!(
            !is_managed_java_home_under(&root, &traversal),
            "通过 .. 绕出托管目录必须被拒绝"
        );

        let _ = std::fs::remove_dir_all(&base);
    }
}


// 子模块声明与公共导出
mod scan;
pub(crate) use scan::*;
mod version;
pub(crate) use version::*;
mod select;
pub(crate) use select::*;
mod import;
pub(crate) use import::*;
mod install;
pub(crate) use install::*;
