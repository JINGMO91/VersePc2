// game.rs — 由 args_builder.rs 拆分
#![allow(unused_imports)]

// 游戏参数收集、窗口分辨率与去重
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use crate::storage;
use crate::utils;
use super::dep_check;
use crate::launch::memory::{
    resolve_max_memory, resolve_memory_mode, MemoryMode,
};
use super::*;

/// 收集版本 JSON 中的游戏参数
pub(crate) fn collect_game_args_from_json(
    game_args: &mut Vec<String>,
    version_json: &Value,
    variables: &HashMap<String, String>,
    has_custom_resolution: bool,
    has_quick_play: bool,
) {
    let mut sources: Vec<Value> = Vec::new();
    if let Some(arr) = version_json
        .get("arguments")
        .and_then(|v| v.get("game"))
        .and_then(|v| v.as_array())
    {
        sources.extend(arr.iter().cloned());
    }
    if let Some(arr) = version_json
        .get("arguments")
        .and_then(|v| v.get("default-user-game"))
        .and_then(|v| v.as_array())
    {
        sources.extend(arr.iter().cloned());
    }

    for arg in &sources {
        if let Some(s) = arg.as_str() {
            game_args.push(replace_variables(s, variables));
        } else if let Some(value) = arg.get("value") {
            let rules_match = arg
                .get("rules")
                .and_then(|v| v.as_array())
                .map(|rules| dep_check::evaluate_rules(rules, has_custom_resolution, has_quick_play))
                .unwrap_or(true);
            if !rules_match {
                continue;
            }
            if let Some(s) = value.as_str() {
                game_args.push(replace_variables(s, variables));
            } else if let Some(arr) = value.as_array() {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        game_args.push(replace_variables(s, variables));
                    }
                }
            }
        }
    }
}

/// 游戏窗口分辨率修正：减去标题栏+边框，避免窗口铺满屏幕时标题栏被顶出屏幕外。
/// 对所有版本（原版 / Forge / NeoForge / Fabric）统一生效。
pub(crate) fn adjust_window_resolution(res_w: u32, res_h: u32, _game_args: &[String]) -> (u32, u32) {
    // 标题栏/边框修正仅适用于 Windows 窗口
    if !cfg!(target_os = "windows") {
        return (res_w, res_h);
    }
    let (screen_w, screen_h, work_h) = get_screen_size();
    if screen_w == 0 || screen_h == 0 {
        return (res_w, res_h);
    }
    let mut final_w = res_w;
    let mut final_h = res_h;
    // 当用户设置的分辨率接近屏幕分辨率（差距 < 40px）时，窗口客户区等于屏幕大小，
    // 加上标题栏和边框后实际窗口会超出屏幕，导致标题栏被顶到屏幕外不可见。
    // 此时减去标题栏+边框高度（约 39px）和左右边框宽度（约 16px），
    // 让窗口刚好占满屏幕工作区，标题栏正常显示。
    if final_w.abs_diff(screen_w) < 40 {
        final_w = final_w.saturating_sub(16).max(800);
    }
    if final_h.abs_diff(screen_h) < 40 || (work_h > 0 && final_h.abs_diff(work_h) < 40) {
        final_h = final_h.saturating_sub(39).max(600);
    }
    (final_w, final_h)
}

/// 获取主显示器信息：(屏幕宽, 屏幕高, 工作区高)。失败/未知时返回 (0, 0, 0)。
pub(crate) fn get_screen_size() -> (u32, u32, u32) {
    #[cfg(target_os = "windows")]
    {
        #[link(name = "user32")]
        unsafe extern "system" {
            fn GetSystemMetrics(nIndex: i32) -> i32;
        }
        const SM_CXSCREEN: i32 = 0;
        const SM_CYSCREEN: i32 = 1;
        const SM_CYWORKAREA: i32 = 49;
        unsafe {
            let w = GetSystemMetrics(SM_CXSCREEN);
            let h = GetSystemMetrics(SM_CYSCREEN);
            let wh = GetSystemMetrics(SM_CYWORKAREA);
            if w > 0 && h > 0 {
                return (w as u32, h as u32, wh.max(0) as u32);
            }
        }
    }
    // Linux：xrandr 当前分辨率
    #[cfg(target_os = "linux")]
    {
        if let Ok(out) = std::process::Command::new("xrandr").arg("--current").output() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if let Some(pos) = line.find("current ") {
                    let rest = &line[pos + 8..];
                    let nums: Vec<u32> = rest
                        .split(|c: char| c == ' ' || c == 'x' || c == ',')
                        .filter_map(|s| s.trim().parse::<u32>().ok())
                        .collect();
                    if nums.len() >= 2 && nums[0] > 0 && nums[1] > 0 {
                        return (nums[0], nums[1], nums[1]);
                    }
                }
                if line.contains(" connected") {
                    for token in line.split_whitespace() {
                        if let Some(x) = token.find('x') {
                            let (w, rest) = token.split_at(x);
                            let h = rest[1..].split('+').next().unwrap_or("");
                            if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                                return (w, h, h);
                            }
                        }
                    }
                }
            }
        }
    }
    // macOS：system_profiler 读取主显示器分辨率（避免 osascript 触发自动化权限弹窗）
    #[cfg(target_os = "macos")]
    {
        static MAC_SCREEN: std::sync::OnceLock<(u32, u32, u32)> = std::sync::OnceLock::new();
        return *MAC_SCREEN.get_or_init(|| {
            if let Ok(out) = std::process::Command::new("system_profiler")
                .arg("SPDisplaysDataType")
                .output()
            {
                let text = String::from_utf8_lossy(&out.stdout);
                for line in text.lines() {
                    let line = line.trim();
                    if let Some(pos) = line.find("Resolution:") {
                        // 形如 "Resolution: 2560 x 1600 Retina"
                        let rest = &line[pos + 11..];
                        let nums: Vec<u32> = rest
                            .split(|c: char| c == ' ' || c == 'x' || c == ',')
                            .filter_map(|s| s.trim().parse::<u32>().ok())
                            .collect();
                        if nums.len() >= 2 && nums[0] > 0 && nums[1] > 0 {
                            return (nums[0], nums[1], nums[1]);
                        }
                    }
                }
            }
            (0, 0, 0)
        });
    }
    (0, 0, 0)
}

/// 确保 --flag 参数为权威值，并清理被空格拆分残留的路径片段。
/// minecraftArguments 模板用 split_whitespace 拆分，含空格的路径会被拆成多段，
/// 这里删除 flag 之后到下一个 -- 选项之间所有片段，再整体插入权威路径。
pub(crate) fn ensure_flag_arg(game_args: &mut Vec<String>, flag: &str, value: &str) {
    let idx = game_args.iter().position(|a| a == flag);
    if let Some(idx) = idx {
        // 删除 flag 之后直到下一个 -- 选项之间所有片段（可能是含空格路径被拆开）
        let mut end = idx + 1;
        while end < game_args.len() && !game_args[end].starts_with("--") {
            end += 1;
        }
        game_args.drain(idx + 1..end);
        game_args.insert(idx + 1, value.to_string());
    } else {
        game_args.push(flag.to_string());
        game_args.push(value.to_string());
    }
}

/// 游戏参数去重：对单值选项去重，保留首次出现的值
pub(crate) fn deduplicate_game_args(args: &[String]) -> Vec<String> {
    if args.is_empty() {
        return Vec::new();
    }
    const SINGLE_VALUE_OPTIONS: &[&str] = &[
        "--version",
        "--username",
        "--uuid",
        "--accessToken",
        "--userType",
        "--versionType",
        "--gameDir",
        "--assetsDir",
        "--assetIndex",
        "--width",
        "--height",
        "--server",
        "--port",
        "--xuid",
        "--clientId",
        "--launchTarget",
        "--fml.forgeVersion",
        "--fml.mcVersion",
        "--fml.forgeGroup",
        "--fml.mcpVersion",
        "--fml.neoForgeVersion",
        "--fml.neoFormVersion",
        "--fml.fmlVersion",
    ];

    let mut result: Vec<String> = Vec::new();
    let mut seen_options: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];

        if SINGLE_VALUE_OPTIONS.contains(&arg.as_str()) {
            if seen_options.contains(arg) {
                // 跳过当前参数和它的值
                if i + 1 < args.len() && !args[i + 1].starts_with("--") {
                    i += 1;
                }
                i += 1;
                continue;
            }
            seen_options.insert(arg.clone());
            result.push(arg.clone());
            if i + 1 < args.len() && !args[i + 1].starts_with("--") {
                result.push(args[i + 1].clone());
                i += 1;
            }
        } else {
            result.push(arg.clone());
        }
        i += 1;
    }

    result
}
