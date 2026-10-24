// import.rs — 由 java.rs 拆分
#![allow(unused_imports)]

// 外部 Java 导入与压缩包解压
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use crate::modloaders::shared;
use crate::storage;
use crate::utils;
use super::*;

/// 递归查找目录下第一个 bin/java.exe（导入解压目录中定位 javaHome 用）
pub(crate) fn find_java_exe_recursive(dir: &Path, depth: u32) -> Option<PathBuf> {
    if depth == 0 || !dir.is_dir() {
        return None;
    }
    let direct = dir.join("bin").join(java_bin_name());
    if direct.exists() {
        return Some(direct);
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir()
                && let Some(found) = find_java_exe_recursive(&p, depth - 1) {
                    return Some(found);
                }
        }
    }
    None
}

/// 后台执行 Java 导入任务（压缩包或文件夹），边执行边写 java-import-{sessionId}.json
pub(crate) async fn import_java_async(session_id: &str, import_type: &str, source_path: &str) {
    let report = |status: &str, progress: u32, message: &str| {
        write_java_import_status(
            session_id,
            &json!({
                "status": status,
                "progress": progress,
                "message": message,
                "sessionId": session_id,
            }),
        );
    };

    report("importing", 5, "正在准备导入...");

    // 校验源路径存在
    if source_path.is_empty() {
        report("error", 0, "缺少导入路径");
        return;
    }
    let source = PathBuf::from(source_path);
    if !source.exists() {
        report("error", 0, &format!("文件不存在: {}", source_path));
        return;
    }

    let data_dir = storage::resolve_data_dir();
    let java_dir = data_dir.join("java");
    if let Err(e) = std::fs::create_dir_all(&java_dir) {
        report("error", 0, &format!("创建 Java 目录失败: {}", e));
        return;
    }

    // 导入的 Java 最终落位：java/imported-jdk-{major}-{timestamp}
    let import_root = java_dir.join(format!("_import_{}", chrono::Local::now().timestamp_millis()));
    let java_exe: Option<PathBuf>;
    let mut found_home: Option<PathBuf> = None;

    if import_type == "archive" {
        let name_lower = source.to_string_lossy().to_lowercase();
        if !(name_lower.ends_with(".zip")
            || name_lower.ends_with(".tar.gz")
            || name_lower.ends_with(".tgz"))
        {
            report("error", 0, "目前支持 .zip / .tar.gz / .tgz 格式的 Java 压缩包");
            return;
        }

        report("importing", 15, "正在解压压缩包...");
        // 解压到临时目录（spawn_blocking 避免阻塞 tokio worker）
        let src = source.clone();
        let tmp = import_root.clone();
        let extract_result = tokio::task::spawn_blocking(move || extract_java_archive(&src, &tmp)).await;
        match extract_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = std::fs::remove_dir_all(&import_root);
                report("error", 0, &format!("解压失败: {}", e));
                return;
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&import_root);
                report("error", 0, &format!("解压任务异常: {}", e));
                return;
            }
        }

        report("importing", 50, "正在查找 Java 可执行文件...");
        java_exe = find_java_exe_recursive(&import_root, 5);
        if let Some(ref exe) = java_exe {
            found_home = exe.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf());
        }
    } else if import_type == "directory" {
        // 文件夹导入：源目录应是 javaHome（含 bin/java），若用户选了 bin 目录则上移一级
        let java_exe_name = java_bin_name();
        let mut src_dir = source.clone();
        // macOS 用户通常选择 .jdk / .app 包目录，真正的 javaHome 在 Contents/Home
        #[cfg(target_os = "macos")]
        {
            let bundle_home = src_dir.join("Contents").join("Home");
            if bundle_home.join("bin").join(java_exe_name).exists() {
                src_dir = bundle_home;
            }
        }
        if !src_dir.join("bin").join(java_exe_name).exists() {
            let parent_exe = src_dir
                .parent()
                .map(|p| p.join("bin").join(java_exe_name));
            if let Some(pe) = parent_exe {
                if pe.exists() {
                    src_dir = src_dir.parent().unwrap_or(src_dir.as_path()).to_path_buf();
                } else {
                    report("error", 0, &format!("该目录不是有效的 Java 安装目录（缺少 bin/{}）", java_exe_name));
                    return;
                }
            } else {
                report("error", 0, &format!("该目录不是有效的 Java 安装目录（缺少 bin/{}）", java_exe_name));
                return;
            }
        }
        found_home = Some(src_dir.clone());
        java_exe = Some(src_dir.join("bin").join(java_exe_name));
    } else {
        report("error", 0, "type 必须是 archive 或 directory");
        return;
    }

    let java_exe = match java_exe {
        Some(p) => p,
        None => {
            let _ = std::fs::remove_dir_all(&import_root);
            report("error", 0, &format!("未找到有效的 Java（缺少 bin/{}）", java_bin_name()));
            return;
        }
    };
    ensure_executable(&java_exe);

    report("importing", 70, "正在验证 Java...");
    let info = inspect_java(&java_exe);
    let (version, major, is64) = match info {
        Some(v) => v,
        None => {
            let _ = std::fs::remove_dir_all(&import_root);
            report("error", 0, "Java 无法运行或识别失败");
            return;
        }
    };

    let found_home = found_home.unwrap_or_else(|| {
        java_exe
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| java_exe.clone())
    });

    // 确定最终目录：压缩包导入时需要把找到的 javaHome 移到最终位置；
    // 文件夹导入时把源目录复制到最终位置
    let final_dir_name = format!("imported-jdk-{}-{}", major, chrono::Local::now().timestamp_millis());
    let final_dir = java_dir.join(&final_dir_name);

    if import_type == "archive" {
        report("importing", 80, "正在整理 Java 目录...");
        // 把找到的 javaHome 移到最终目录；跨盘失败时用 copy
        if found_home.as_path() != import_root.as_path() {
            let _ = std::fs::create_dir_all(final_dir.parent().unwrap_or(&java_dir));
            match std::fs::rename(&found_home, &final_dir) {
                Ok(_) => {}
                Err(_) => {
                    let _ = copy_dir_recursive(&found_home, &final_dir);
                }
            }
        } else {
            // javaHome 就是解压根目录
            let _ = std::fs::create_dir_all(final_dir.parent().unwrap_or(&java_dir));
            match std::fs::rename(&import_root, &final_dir) {
                Ok(_) => {}
                Err(_) => {
                    let _ = copy_dir_recursive(&import_root, &final_dir);
                }
            }
        }
        let _ = std::fs::remove_dir_all(&import_root);
    } else {
        report("importing", 80, "正在复制 Java 到启动器目录...");
        let _ = std::fs::create_dir_all(&java_dir);
        if let Err(e) = copy_dir_recursive(&found_home, &final_dir) {
            let _ = std::fs::remove_dir_all(&final_dir);
            report("error", 0, &format!("复制 Java 目录失败: {}", e));
            return;
        }
    }

    // 最终 java.exe 路径
    let final_java_exe = if import_type == "archive" {
        // 压缩包导入后 javaHome 已移到 final_dir，java.exe 在 final_dir/bin/java.exe
        final_dir.join("bin").join(java_bin_name())
    } else {
        final_dir.join("bin").join(java_bin_name())
    };

    // 校验最终 java.exe 存在
    if !final_java_exe.exists() {
        let _ = std::fs::remove_dir_all(&final_dir);
        report("error", 0, "导入后未找到 java.exe");
        return;
    }

    report("importing", 90, "正在保存到列表...");
    let entry = json!({
        "path": final_java_exe.to_string_lossy().to_string(),
        "javaHome": final_dir.to_string_lossy().to_string(),
        "source": "imported",
        "addedAt": chrono::Local::now().to_rfc3339(),
        "majorVersion": major,
        "minorVersion": 0,
        "version": version,
        "isJdk": final_dir.join("bin").join(javac_bin_name()).exists(),
        "is64Bit": is64
    });

    // 去重后保存到 custom-java-list.json
    let mut custom = load_custom_java();
    if let Some(arr) = custom.as_array_mut() {
        let norm_new = entry
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase()
            .replace('\\', "/");
        let dup = arr
            .iter()
            .any(|v| utils::get_str(v, "path").to_lowercase().replace('\\', "/") == norm_new);
        if dup {
            let _ = std::fs::remove_dir_all(&final_dir);
            report("error", 0, "该 Java 已在列表中");
            return;
        }
        arr.push(entry.clone());
    } else {
        custom = Value::Array(vec![entry.clone()]);
    }
    save_custom_java(&custom.as_array().cloned().unwrap_or_default());
    invalidate_cache();

    report("completed", 100, &format!("导入成功: Java {}", major));
    eprintln!("[java] 导入 Java {}: {}", major, final_java_exe.display());
}

/// 递归复制目录（文件夹导入 Java 用）
pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Err(format!("源目录不存在: {}", src.display()));
    }
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败: {}", e))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("读取源目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}

/// 解压 Java 压缩包：zip / tar.gz / tgz
pub(crate) fn extract_java_archive(path: &Path, dest_dir: &Path) -> Result<(), String> {
    let lower = path.to_string_lossy().to_lowercase();
    if lower.ends_with(".zip") {
        return extract_zip(path, dest_dir);
    }
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        std::fs::create_dir_all(dest_dir).map_err(|e| format!("创建目录失败: {}", e))?;
        let status = std::process::Command::new("tar")
            .arg("-xzf")
            .arg(path)
            .arg("-C")
            .arg(dest_dir)
            .status();
        return match status {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("tar 解压失败（退出码 {:?}）", s.code())),
            Err(e) => Err(format!("无法启动 tar 解压: {}", e)),
        };
    }
    Err("仅支持 .zip / .tar.gz / .tgz".to_string())
}

/// 确保文件可执行（macOS/Linux）
#[cfg(unix)]
pub(crate) fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        perms.set_mode(perms.mode() | 0o111);
        let _ = std::fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
pub(crate) fn ensure_executable(_path: &Path) {}

/// 解压 ZIP 文件到目标目录（含 ZipSlip 保护）
pub(crate) fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("打开 ZIP 失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读取 ZIP 失败: {}", e))?;

    std::fs::create_dir_all(dest_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("读取条目失败: {}", e))?;
        let name = entry.name().to_string();
        let normalized = name.replace('\\', "/");

        // ZipSlip 保护：跳过包含 .. 的路径，以及绝对路径（/x、C:/x）
        if normalized.split('/').any(|c| c == "..")
            || normalized.starts_with('/')
            || normalized.as_bytes().get(1) == Some(&b':')
        {
            eprintln!("[java] 跳过可疑路径: {}", name);
            continue;
        }

        let out_path = dest_dir.join(&normalized);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
            }
            let mut out_file =
                std::fs::File::create(&out_path).map_err(|e| format!("创建文件失败: {}", e))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("写入文件失败: {}", e))?;
            #[cfg(unix)]
            if let Some(mode) = entry.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &out_path,
                    std::fs::Permissions::from_mode(mode),
                );
            }
        }
    }

    Ok(())
}

/// 在解压目录中查找真正的 javaHome
/// 有些 ZIP 解压后 extract_dir 本身就是 javaHome，有些则包含一个子目录
#[allow(dead_code)]
pub(crate) fn find_java_home(extract_dir: &Path) -> PathBuf {
    // extract_dir/bin/java.exe 存在，直接用
    let direct = extract_dir.join("bin").join(java_bin_name());
    if direct.exists() {
        return extract_dir.to_path_buf();
    }

    // 否则查找子目录
    if let Ok(entries) = std::fs::read_dir(extract_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let java_exe = p.join("bin").join(java_bin_name());
                if java_exe.exists() {
                    return p;
                }
            }
        }
    }

    extract_dir.to_path_buf()
}
