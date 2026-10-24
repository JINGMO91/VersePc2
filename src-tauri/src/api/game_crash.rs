// api/game_crash.rs — 退出分析、崩溃报告读取与自动崩溃分析
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::api::ApiResult;
use crate::launch;
use crate::launch::game_session;
use crate::storage;
use crate::utils;

use super::clean_external_marker;

/// GET /api/game/exit-analysis — 返回上次游戏退出分析结果
/// 数据由 process_manager 在游戏进程退出时写入全局缓存（game_session::set_exit_analysis），
pub(super) fn handle_exit_analysis() -> ApiResult {
    let analysis = game_session::get_exit_analysis();
    ApiResult::ok(json!({
        "analysis": analysis,
    }))
}

/// GET /api/game/crash-log — 获取最近一次崩溃报告
/// 参数：versionId（可选）
pub(super) fn handle_crash_log(params: &Option<Value>) -> ApiResult {
    let version_id = params
        .as_ref()
        .and_then(|p| p.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut search_dirs: Vec<PathBuf> = Vec::new();

    // 版本隔离目录
    if !version_id.is_empty() {
        let versions_dir = storage::resolve_data_dir().join("versions");
        let clean_id = clean_external_marker(version_id);
        search_dirs.push(versions_dir.join(&clean_id).join("crash-reports"));
    }

    // 全局游戏目录
    let settings = storage::load_settings();
    let game_dir = utils::get_str(&settings, "gameDir");
    if !game_dir.is_empty() {
        search_dirs.push(PathBuf::from(&game_dir).join("crash-reports"));
    } else {
        search_dirs.push(storage::resolve_data_dir().join("crash-reports"));
    }

    for dir in &search_dirs {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            let mut crash_files: Vec<_> = entries
                .flatten()
                .filter(|e| {
                    e.file_name()
                        .to_str()
                        .map(|n| n.ends_with(".txt"))
                        .unwrap_or(false)
                })
                .collect();
            // 按修改时间倒序排序
            crash_files.sort_by(|a, b| {
                b.metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .cmp(&a.metadata().and_then(|m| m.modified()).ok())
            });
            if let Some(file) = crash_files.first() {
                let path = file.path();
                if let Ok(content) = std::fs::read_to_string(&path) {
                    let truncated = if content.len() > 10000 {
                        content[..10000].to_string()
                    } else {
                        content
                    };
                    let file_name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();
                    return ApiResult::ok(json!({
                        "crashLog": {
                            "file": file_name,
                            "content": truncated,
                            "path": path.to_string_lossy()
                        }
                    }));
                }
            }
        }
    }

    ApiResult::ok(json!({ "crashLog": null }))
}

/// GET /api/game/crash-analyze — 自动崩溃分析
/// 参数：versionId（可选，用于定位版本目录的日志）
/// 流程：调用 CrashAnalyzer.collect → prepare → analyze → 返回结构化结果
pub(super) fn handle_crash_analyze(params: &Option<Value>) -> ApiResult {
    let version_id = params
        .as_ref()
        .and_then(|p| p.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // 确定游戏目录：按版本解析真实游戏根目录（与启动逻辑一致），
    // 替代固定 ~/.minecraft，避免读取到其它版本/旧日志导致误判
    let settings = storage::load_settings();
    let clean_id = clean_external_marker(version_id);

    let minecraft_dir = if clean_id.is_empty() {
        let game_dir = utils::get_str(&settings, "gameDir");
        if !game_dir.is_empty() {
            std::path::PathBuf::from(&game_dir)
        } else {
            crate::crash_analyzer::constants::default_minecraft_dir()
        }
    } else {
        let data_dir = storage::resolve_data_dir();
        let versions_dir = data_dir.join("versions");
        launch::args_builder::resolve_game_dir(
            &clean_id,
            None,
            None,
            &settings,
            &versions_dir,
            &data_dir,
        )
    };

    let analyzer = crate::crash_analyzer::CrashAnalyzer::new(
        if clean_id.is_empty() { None } else { Some(clean_id.clone()) },
        Some(minecraft_dir.clone()),
    );

    let output = analyzer.analyze(&clean_id);

    // 如果分析到崩溃原因，取第一条作为主要结果
    let (found, reason_str, solution) = if let Some((reason, _)) = output.crash_reasons.first() {
        let _mod_name = output
            .crash_reasons
            .first()
            .and_then(|(_, additional)| additional.first())
            .cloned();
        (
            true,
            reason.as_str().to_string(),
            output.detail.clone(),
        )
    } else {
        (false, String::new(), String::new())
    };

    // 取主日志文件的摘录（用于前端展示）
    let log_excerpt: Vec<Value> = {
        let mut excerpt = Vec::new();
        // 从崩溃报告 / 游戏日志 / hs_err 提取关键行（最多 20 行）
        let sources = [
            ("crash-report", &output.log_crash),
            ("latest.log", &output.log_mc),
            ("hs_err", &output.log_hs),
        ];
        for (src_label, content_opt) in &sources {
            if let Some(content) = content_opt {
                for line in content.lines().take(80) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    excerpt.push(json!({
                        "source": src_label,
                        "line": trimmed
                    }));
                    if excerpt.len() >= 20 {
                        break;
                    }
                }
                if excerpt.len() >= 20 {
                    break;
                }
            }
        }
        excerpt
    };

    let mod_name = output
        .crash_reasons
        .first()
        .and_then(|(_, additional)| additional.first())
        .cloned();

    // 找到参与分析的日志文件路径
    let log_file = output.files.first().cloned().unwrap_or_default();

    // 严重程度评估
    let severity = output
        .crash_reasons
        .first()
        .map(|(reason, _)| {
            use crate::crash_analyzer::constants::CrashReason::*;
            match reason {
                // 严重：Mod 崩溃、内存不足、驱动崩溃等
                ModCrashed | OutOfMemory | IntelDriverCrash | AMDDriverCrash | NVidiaDriverCrash
                | PixelFormatNotAccelerated | NativeLinkError | InvalidPath => "high",
                // 中等：版本不兼容、缺失前置等
                JavaVersionTooHigh | JavaTooOld | ModRequiresJava11 | ModMissingDependency
                | ModIncompatible | ModDuplicateModFiles | ModIdConflict | ModMixinError
                | ModFileExtracted | ForgeMissing | ModLoaderVersionIncompatible => "medium",
                // 低：其他问题
                _ => "low",
            }
        })
        .unwrap_or("low")
        .to_string();

    let reason = if found {
        reason_str
    } else {
        "未分析出崩溃原因".to_string()
    };

    // 最终回退：文件系统找不到崩溃日志时（游戏秒崩来不及写 crash-reports），
    // 用后端收集的 lastGameExitAnalysis 数据（进程退出码分析 + stdout/stderr logBuffer）
    let (final_found, final_reason, final_solution, final_log_excerpt, final_crash_desc, final_log_file, final_mod_name, final_severity) = if found {
        (
            found,
            reason.clone(),
            solution.clone(),
            log_excerpt,
            output.detail.clone(),
            log_file,
            mod_name,
            severity,
        )
    } else if let Some(ea) = game_session::get_exit_analysis() {
        if ea.get("isCrash").and_then(|v| v.as_bool()).unwrap_or(false) {
            let ea_code = ea.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
            let ea_reason = ea.get("reason").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let ea_sugg = ea.get("suggestion").and_then(|v| v.as_str()).unwrap_or("").to_string();

            // 从进程输出提取错误相关行构造崩溃描述
            let mut fallback_desc = String::new();
            let mut fallback_excerpt: Vec<Value> = Vec::new();
            let mut error_lines: Vec<String> = Vec::new();
            if let Some(buf) = ea.get("logBuffer").and_then(|v| v.as_array()) {
                for line in buf {
                    if let Some(s) = line.as_str() {
                        let trimmed = s.trim().to_string();
                        if trimmed.is_empty() {
                            continue;
                        }
                        fallback_excerpt.push(json!({
                            "source": if trimmed.starts_with("[VersePC]") { "launcher" } else { "latest.log" },
                            "line": trimmed
                        }));
                        if trimmed.contains("Exception")
                            || trimmed.contains("Error")
                            || trimmed.contains("error")
                            || trimmed.contains("ERROR")
                            || trimmed.contains("Failed")
                            || trimmed.contains("failed")
                            || trimmed.contains("at ")
                            || trimmed.contains("Caused by")
                        {
                            error_lines.push(trimmed);
                        }
                    }
                }
            }
            if !error_lines.is_empty() {
                let tail: Vec<String> = error_lines.iter().rev().take(25).rev().cloned().collect();
                fallback_desc = format!("【进程错误输出】\n{}", tail.join("\n"));
            }
            let mut proc_info = format!("【进程信息】\n退出码: {}", ea_code);
            if !ea_reason.is_empty() {
                proc_info.push_str(&format!("\n退出原因: {}", ea_reason));
            }
            if !fallback_desc.is_empty() {
                fallback_desc.push_str(&format!("\n\n{}", proc_info));
            } else {
                fallback_desc = proc_info;
            }

            let fallback_sev = if ea_code == 0 {
                "low"
            } else if ea_code == 137 || ea_reason.contains("内存") || ea_reason.contains("OOM") || ea_reason.contains("OutOfMemory") {
                "high"
            } else {
                "medium"
            };

            if error_lines.is_empty() && fallback_excerpt.is_empty() {
                (found, reason.clone(), solution.clone(), log_excerpt, output.detail.clone(), log_file, mod_name, severity)
            } else {
                (
                 true,
                 if !ea_reason.is_empty() {
                     ea_reason
                 } else {
                     format!("游戏异常退出（退出码: {}）", ea_code)
                 },
                 if !ea_sugg.is_empty() {
                     ea_sugg
                 } else {
                     "请查看日志获取更多信息，或尝试重新启动游戏。".to_string()
                 },
                 fallback_excerpt,
                 fallback_desc,
                 if log_file.is_empty() { "(进程输出)".to_string() } else { log_file },
                 None,
                 fallback_sev.to_string(),
                )
            }
        } else {
            (found, reason.clone(), solution.clone(), log_excerpt, output.detail.clone(), log_file, mod_name, severity)
        }
    } else {
        (found, reason.clone(), solution.clone(), log_excerpt, output.detail.clone(), log_file, mod_name, severity)
    };

    ApiResult::ok(json!({
        "found": final_found,
        "reason": final_reason,
        "solution": final_solution,
        "modName": final_mod_name,
        "logFile": final_log_file,
        "severity": final_severity,
        "logExcerpt": final_log_excerpt,
        "crashDescription": final_crash_desc,
        "files": output.files,
        "crashReasons": output.crash_reasons.iter().map(|(r, a)| json!({
            "reason": r.as_str(),
            "additional": a
        })).collect::<Vec<_>>()
    }))
}
