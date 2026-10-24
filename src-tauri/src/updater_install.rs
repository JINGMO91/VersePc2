// updater_install.rs — 更新提示文件与全量替换重启
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::json;
use tauri::AppHandle;

pub(super) fn pending_notice_path() -> PathBuf {
    crate::storage::resolve_data_dir().join("pending-update-notice.json")
}

pub(super) fn write_pending_notice(version: &str, notes: &str) {
    let data = json!({
        "version": version,
        "notes": notes,
        "updatedAt": chrono::Local::now().to_rfc3339()
    });
    let path = pending_notice_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, serde_json::to_string_pretty(&data).unwrap_or_else(|_| "{}".to_string()));
}

pub(super) fn install_and_restart(app: &AppHandle, new_pkg: &Path) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = current_exe
        .parent()
        .ok_or("无法定位安装目录")?
        .to_path_buf();
    let exe_name = current_exe
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        let script = dir.join("_versepc_update.bat");
        let n = new_pkg.to_string_lossy().replace('/', "\\");
        let c = current_exe.to_string_lossy().replace('/', "\\");
        // 等待当前实例退出（约8秒）→ 若后台残留则强制结束 → 替换 exe → 启动 exe → 删除脚本
        // 说明：关窗后进程可能仍在后台占用 exe（导致 move 改名失败），必须兜底 taskkill 强制结束再替换。
        // 加固：替换后先校验 exe 是否真的存在（替换可能被安全软件拦截删除），
        // 存在才启动；若主 exe 丢失则回退启动更新包原件，避免「Windows 找不到文件」原生报错。
        let content = format!(
            "@echo off\r\n\
             chcp 65001 >nul\r\n\
             set \"NEW={new}\"\r\n\
             set \"CUR={cur}\"\r\n\
             set /a tries=0\r\n\
             :wait\r\n\
             tasklist /fi \"imagename eq {exe}\" 2>nul | find /i \"{exe}\" >nul\r\n\
             if errorlevel 1 goto replace\r\n\
             set /a tries+=1\r\n\
             if %tries% geq 8 goto kill\r\n\
             timeout /t 1 /nobreak >nul\r\n\
             goto wait\r\n\
             :kill\r\n\
             taskkill /f /im \"{exe}\" >nul 2>nul\r\n\
             timeout /t 2 /nobreak >nul\r\n\
             :replace\r\n\
             move /y \"%NEW%\" \"%CUR%\" >nul 2>nul\r\n\
             if not exist \"%CUR%\" (\r\n\
               taskkill /f /im \"{exe}\" >nul 2>nul\r\n\
               timeout /t 2 /nobreak >nul\r\n\
               move /y \"%NEW%\" \"%CUR%\" >nul 2>nul\r\n\
             )\r\n\
             if not exist \"%CUR%\" copy /y \"%NEW%\" \"%CUR%\" >nul 2>nul\r\n\
             if exist \"%CUR%\" (\r\n\
               start \"\" \"%CUR%\"\r\n\
             ) else (\r\n\
               if exist \"%NEW%\" start \"\" \"%NEW%\"\r\n\
               if not exist \"%NEW%\" echo [VersePC] update failed: exe missing > \"%~dp0_versepc_update_error.txt\"\r\n\
             )\r\n\
             :done\r\n\
             del /q \"%~f0\"\r\n",
            exe = exe_name, new = n, cur = c
        );
        fs::write(&script, content).map_err(|e| format!("无法写入更新脚本: {}", e))?;
        let script_str = script.to_string_lossy().replace('/', "\\");
        Command::new("cmd")
            .args(["/c", "start", "", "/min", &script_str])
            .spawn()
            .map_err(|e| format!("无法启动更新脚本: {}", e))?;
        app.exit(0);
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        // new_pkg 是单个可执行文件：替换当前二进制后重启
        let script = dir.join("_versepc_update.sh");
        let n = new_pkg.to_string_lossy();
        let c = current_exe.to_string_lossy();
        let content = format!(
            "#!/bin/sh\n\
             while pgrep -f \"{c}\" >/dev/null 2>&1; do sleep 1; done\n\
             cp \"{n}\" \"{c}\" && chmod +x \"{c}\"\n\
             nohup \"{c}\" >/dev/null 2>&1 &\n\
             rm -f \"$0\"\n"
        );
        fs::write(&script, content).map_err(|e| format!("无法写入更新脚本: {}", e))?;
        Command::new("/bin/sh").arg(&script).spawn().map_err(|e| format!("无法启动更新脚本: {}", e))?;
        app.exit(0);
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        // new_pkg 是含 VersePC2.app 的 zip：解压后整包替换旧 .app，再 open 新 app
        let app_bundle = current_exe
            .ancestors()
            .find(|p| p.file_name().map(|f| f == "VersePC2.app").unwrap_or(false))
            .map(|p| p.to_path_buf())
            .unwrap_or(dir.clone());
        let parent = app_bundle
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| dir.clone());
        let script = parent.join("_versepc_update.sh");
        let zip = new_pkg.to_string_lossy();
        let ab = app_bundle.to_string_lossy();
        let content = format!(
            "#!/bin/sh\n\
             while pgrep -f \"{ab}/Contents/MacOS/VersePC2\" >/dev/null 2>&1; do sleep 1; done\n\
             TMP=\"$(mktemp -d)\"\n\
             cd \"$TMP\" && unzip -o -q \"{zip}\" || exit 1\n\
             rm -rf \"{ab}\"\n\
             mv \"$TMP/VersePC2.app\" \"{ab}\"\n\
             chmod +x \"{ab}/Contents/MacOS/VersePC2\"\n\
             open \"{ab}\"\n\
             rm -rf \"$TMP\"\n\
             rm -f \"$0\"\n"
        );
        fs::write(&script, content).map_err(|e| format!("无法写入更新脚本: {}", e))?;
        Command::new("/bin/sh").arg(&script).spawn().map_err(|e| format!("无法启动更新脚本: {}", e))?;
        app.exit(0);
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = (exe_name, dir);
        Err("当前平台暂不支持自动更新".to_string())
    }
}

