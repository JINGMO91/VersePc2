// versions/diagnose.rs — 版本完整性诊断与文件定位
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::storage;


/// 当前时间戳（毫秒），用于生成唯一会话 ID
pub(crate) fn chrono_now_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// GET /api/version/diagnose — 诊断版本完整性
///
/// 扫描所有库文件，返回缺失和损坏的文件列表
pub(crate) fn handle_diagnose(params: &Option<Value>) -> crate::api::ApiResult {
    use crate::api::ApiResult;

    let version_id = params
        .as_ref()
        .and_then(|p| p.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if version_id.is_empty() {
        return ApiResult::err(400, "Missing versionId");
    }

    let data_dir = storage::resolve_data_dir();
    let versions_dir = data_dir.join("versions");
    let libraries_dir = data_dir.join("libraries");
    let version_dir = versions_dir.join(version_id);

    if !version_dir.exists() {
        return ApiResult::err(404, "版本目录不存在");
    }

    // 解析版本 JSON
    let version_json = match resolve_version_json_recursive(version_id, &versions_dir) {
        Some(j) => j,
        None => return ApiResult::err(400, "版本JSON文件缺失"),
    };

    let mut missing_libs: Vec<String> = Vec::new();
    let mut corrupt_libs: Vec<String> = Vec::new();
    let mut total_libs: u32 = 0;

    if let Some(libs) = version_json.get("libraries").and_then(|v| v.as_array()) {
        for lib in libs {
            let lib_name = match lib.get("name").and_then(|v| v.as_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };

            let suffix = lib_name.split(':').next_back().unwrap_or("");
            if suffix.starts_with("natives-") {
                continue;
            }
            if lib_name.starts_with("net.neoforged:neoforge:") && lib_name.ends_with(":client") {
                continue;
            }

            total_libs += 1;

            let download_artifact = lib.get("downloads").and_then(|d| d.get("artifact"));
            let lib_path = download_artifact
                .and_then(|a| a.get("path"))
                .and_then(|v| v.as_str())
                .map(|p| libraries_dir.join(p))
                .unwrap_or_else(|| resolve_library_path_from_name(&lib_name, &libraries_dir));

            if !lib_path.exists() {
                missing_libs.push(lib_name);
            } else if lib_path.extension().and_then(|e| e.to_str()) == Some("jar") {
                // 简单完整性检查：文件大小 > 1KB
                if let Ok(meta) = std::fs::metadata(&lib_path)
                    && meta.len() < 1024 {
                        corrupt_libs.push(lib_name);
                    }
            }
        }
    }

    // 检查客户端 jar
    let jar_path = version_dir.join(format!("{}.jar", version_id));
    let client_jar_ok = if jar_path.exists() {
        std::fs::metadata(&jar_path).map(|m| m.len() > 0).unwrap_or(false)
    } else {
        false
    };

    ApiResult::ok(json!({
        "versionId": version_id,
        "totalLibs": total_libs,
        "missingLibs": missing_libs,
        "corruptLibs": corrupt_libs,
        "clientJarOk": client_jar_ok,
        "healthy": missing_libs.is_empty() && corrupt_libs.is_empty() && client_jar_ok
    }))
}

/// 递归解析版本 JSON（合并 inheritsFrom 的 libraries）
///
/// 简化版：只合并 libraries 数组，不深度合并其他字段
pub(crate) fn resolve_version_json_recursive(version_id: &str, versions_dir: &Path) -> Option<Value> {
    let json_path = versions_dir.join(version_id).join(format!("{}.json", version_id));
    if !json_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&json_path).ok()?;
    let mut json: Value = serde_json::from_str(&content).ok()?;

    // 合并 inheritsFrom 的 libraries
    if let Some(parent_id) = json.get("inheritsFrom").and_then(|v| v.as_str()).map(|s| s.to_string())
        && let Some(parent_json) = resolve_version_json_recursive(&parent_id, versions_dir) {
            if let (Some(parent_libs), Some(self_libs)) = (
                parent_json.get("libraries").and_then(|v| v.as_array()).cloned(),
                json.get("libraries").and_then(|v| v.as_array()).cloned(),
            ) {
                // 合并：父版本在前，子版本在后（去重）
                let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
                let mut merged: Vec<Value> = Vec::new();
                for lib in parent_libs.iter().chain(self_libs.iter()) {
                    if let Some(name) = lib.get("name").and_then(|v| v.as_str()) {
                        if seen.insert(name.to_string()) {
                            merged.push(lib.clone());
                        }
                    } else {
                        merged.push(lib.clone());
                    }
                }
                if let Some(obj) = json.as_object_mut() {
                    obj.insert("libraries".to_string(), json!(merged));
                }
            }
            // 合并 downloads.client
            if json.get("downloads").and_then(|d| d.get("client")).is_none()
                && let Some(parent_client) = parent_json.get("downloads").and_then(|d| d.get("client"))
                    && let Some(obj) = json.as_object_mut() {
                        let mut downloads = obj.get("downloads").cloned().unwrap_or(json!({}));
                        if let Some(d_obj) = downloads.as_object_mut() {
                            d_obj.insert("client".to_string(), parent_client.clone());
                        }
                        obj.insert("downloads".to_string(), downloads);
                    }
        }

    Some(json)
}

/// 从 Maven 坐标推导库文件路径
///
/// 例：`com.mojang:authlib:1.5.25` → `libraries/com/mojang/authlib/1.5.25/authlib-1.5.25.jar`
pub(crate) fn resolve_library_path_from_name(name: &str, libraries_dir: &Path) -> PathBuf {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return libraries_dir.join("unknown.jar");
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let filename = format!("{}-{}.jar", artifact, version);
    libraries_dir.join(&group).join(artifact).join(version).join(filename)
}

// ============== 导出启动脚本 / 导出整合包 / 读取版本图标 ==============

/// 在资源管理器中打开路径
pub(crate) fn open_in_explorer(path: &Path) -> bool {
    if !path.exists() {
        let _ = std::fs::create_dir_all(path);
    }
    eprintln!("[explorer] opening path={} is_dir={}", path.display(), path.is_dir());
    #[cfg(target_os = "windows")]
    {
        // 直接传原路径，由 Command::arg 自动对含空格路径加引号。
        // 不能补尾部反斜杠：含空格路径的结尾会拼成 \"，被命令行当作转义引号，
        // 导致路径断裂、explorer 回退打开默认位置（如“文档”）。
        if path.is_dir() {
            let p = path.to_string_lossy().to_string();
            eprintln!("[explorer] cmd = explorer.exe {:?}", p);
            std::process::Command::new("explorer.exe").arg(p).spawn().is_ok()
        } else {
            // 文件：用 /select 定位并选中该文件
            let p = path.to_string_lossy().to_string();
            eprintln!("[explorer] cmd = explorer.exe /select, {:?}", p);
            std::process::Command::new("explorer.exe")
                .args(["/select,", &p])
                .spawn()
                .is_ok()
        }
    }
    #[cfg(target_os = "macos")]
    {
        // 文件使用 -R 在 Finder 中定位选中，目录直接打开
        let mut cmd = std::process::Command::new("open");
        if !path.is_dir() {
            cmd.arg("-R");
        }
        cmd.arg(path).spawn().is_ok()
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(if path.is_dir() {
                path.to_path_buf()
            } else {
                path.parent().unwrap_or(path).to_path_buf()
            })
            .spawn()
            .is_ok()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        false
    }
}

/// 送回回收站（Windows 用 PowerShell VisualBasic）
/// `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(..., 'OnlyErrorDialogs', 'SendToRecycleBin')`
/// 相比 Shell.Application 的 InvokeVerb('delete')（异步、不可靠、被占用时静默失败），
/// 该方式同步执行、明确指定 SendToRecycleBin，能正确返回失败状态供上层回退。
#[cfg(target_os = "windows")]
pub(crate) fn send_to_recycle_bin(path: &Path) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // 单引号需转义为两个单引号，避免 PowerShell 字符串提前闭合
    let escaped = path.to_string_lossy().replace('\'', "''");
    let ps_cmd = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('{}', 'OnlyErrorDialogs', 'SendToRecycleBin')",
        escaped
    );
    let status = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
        .creation_flags(CREATE_NO_WINDOW)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(
            format!("回收站操作失败 (exit {:?})", status.code()),
        ))
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn send_to_recycle_bin(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let escaped = path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let script = format!(
            "tell application \"Finder\" to delete POSIX file \"{}\"",
            escaped
        );
        let status = std::process::Command::new("osascript")
            .args(["-e", &script])
            .status()?;
        if status.success() {
            return Ok(());
        }
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "移到废纸篓失败",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        // GNOME 的 gio，其次 trash-cli 的 trash-put
        for cmd in ["gio", "trash-put"] {
            let mut c = std::process::Command::new(cmd);
            if cmd == "gio" {
                c.arg("trash");
            }
            c.arg(path);
            if let Ok(st) = c.status() {
                if st.success() {
                    return Ok(());
                }
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "未找到可用的回收站命令（gio/trash-put）",
        ))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "当前平台暂不支持回收站",
        ))
    }
}

// ============== 版本修复 ==============
