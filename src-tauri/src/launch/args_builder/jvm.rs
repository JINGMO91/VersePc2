// jvm.rs — 由 args_builder.rs 拆分
#![allow(unused_imports)]

// JVM 参数清理、GC、用户参数、模块路径与注入
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

/// 清理 JVM 参数：过滤当前 Java 版本不支持的参数、trim 系统属性值
pub(crate) fn sanitize_jvm_args(args: &mut Vec<String>) {
    // 已知问题参数：
    // --sun-misc-unsafe-memory-access=allow 是 Java 24+ 参数，低版本会报 "Unrecognized option"
    let unsupported_options: Vec<&str> = vec![
        "--sun-misc-unsafe-memory-access=allow",
    ];

    for arg in args.iter_mut() {
        // trim -Dkey=value 的值部分（如 -DFabricMcEmu= xxx ）
        if let Some(pos) = arg.find("-D")
            && let Some(eq_pos) = arg[pos..].find('=') {
                let abs_eq = pos + eq_pos;
                let key = &arg[..abs_eq];
                let value = arg[abs_eq + 1..].trim();
                *arg = format!("{}={}", key, value);
            }
    }

    args.retain(|a| !unsupported_options.iter().any(|u| a.trim() == *u));
}

/// 替换字符串中的 ${var} 和 $var 变量
pub(crate) fn replace_variables(input: &str, vars: &HashMap<String, String>) -> String {
    let mut result = input.to_string();
    for (key, value) in vars {
        // ${var}
        let pattern1 = format!("${{{}}}", key);
        result = result.replace(&pattern1, value);
        // $var（后跟非字母数字下划线边界）
        let pattern2 = format!("${}", key);
        replace_dollar_var(&mut result, key, value);
        let _ = pattern2; // 已通过 replace_dollar_var 处理
    }
    result
}

/// 替换 $var（非 ${var}）形式，避免误匹配 $varXXX
pub(crate) fn replace_dollar_var(s: &mut String, key: &str, value: &str) {
    let token = format!("${}", key);
    let mut idx = 0;
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    while idx < bytes.len() {
        if bytes[idx] == b'$' && s[idx..].starts_with(&token) {
            let end = idx + token.len();
            // 边界检查：后面字符必须是非 [a-zA-Z0-9_]
            let after = s.as_bytes().get(end).copied();
            let is_boundary = match after {
                None => true,
                Some(c) => !(c.is_ascii_alphanumeric() || c == b'_'),
            };
            if is_boundary {
                out.push_str(value);
                idx = end;
                continue;
            }
        }
        // 复制一个 UTF-8 字符
        let ch_len = utf8_char_len(bytes[idx]);
        out.push_str(&s[idx..idx + ch_len]);
        idx += ch_len;
    }
    *s = out;
}

/// 获取 UTF-8 字符长度
pub(crate) fn utf8_char_len(b: u8) -> usize {
    if b < 0x80 {
        1
    } else if b >> 5 == 0b110 {
        2
    } else if b >> 4 == 0b1110 {
        3
    } else {
        4
    }
}

/// 推送 GC 参数（按内存大小与 mod 数量选择）
pub(crate) fn push_gc_args(jvm_args: &mut Vec<String>, max_mem_mb: u64, mod_count: u64) {
    if max_mem_mb <= 1024 {
        jvm_args.push("-XX:+UseSerialGC".to_string());
    } else {
        let cpu_count = num_cpus();
        let parallel_gc_threads = if cpu_count <= 4 {
            2
        } else {
            std::cmp::max(2, (cpu_count * 5) / 8)
        };
        let conc_gc_threads = std::cmp::max(1, parallel_gc_threads / 2);
        jvm_args.push("-XX:+UnlockExperimentalVMOptions".to_string());
        jvm_args.push("-XX:+UseG1GC".to_string());
        jvm_args.push("-XX:MaxGCPauseMillis=100".to_string());
        jvm_args.push("-XX:+AlwaysPreTouch".to_string());
        jvm_args.push("-XX:G1NewSizePercent=40".to_string());
        jvm_args.push("-XX:G1ReservePercent=20".to_string());
        jvm_args.push("-XX:SurvivorRatio=32".to_string());
        jvm_args.push(format!("-XX:ParallelGCThreads={}", parallel_gc_threads));
        jvm_args.push(format!("-XX:ConcGCThreads={}", conc_gc_threads));
        jvm_args.push("-XX:+PerfDisableSharedMem".to_string());
        if max_mem_mb >= 4096 {
            let region_size = if max_mem_mb >= 8192 { "32m" } else { "16m" };
            jvm_args.push(format!("-XX:G1HeapRegionSize={}", region_size));
        }
        if mod_count > 50 {
            jvm_args.push("-XX:G1MixedGCCountTarget=16".to_string());
            jvm_args.push("-XX:G1HeapWastePercent=5".to_string());
        }
    }
    jvm_args.push("-XX:+DisableExplicitGC".to_string());
}

/// 获取 CPU 核数
pub(crate) fn num_cpus() -> u32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4)
}

/// 获取物理内存总量（MB）
pub(crate) fn total_physical_memory_mb() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.total_memory() / (1024 * 1024)
}

/// 获取当前可用物理内存（MB）
pub(crate) fn free_physical_memory_mb() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.available_memory() / (1024 * 1024)
}

/// 推送用户自定义 JVM 参数（去重）
pub(crate) fn push_user_jvm_args(jvm_args: &mut Vec<String>, java_args: &str) {
    let user_args: Vec<String> = java_args
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    for arg in user_args {
        let base_arg = arg.split('=').next().unwrap_or(&arg).to_string();
        let has_conflict = jvm_args.iter().any(|existing| existing.starts_with(&base_arg));
        // GC 参数冲突检测
        let gc_patterns = ["-XX:+Use", "-XX:-Use"];
        let is_gc_arg = gc_patterns.iter().any(|p| arg.starts_with(p));
        if is_gc_arg {
            let has_gc_conflict = jvm_args
                .iter()
                .any(|existing| gc_patterns.iter().any(|p| existing.starts_with(p)));
            if has_gc_conflict {
                continue;
            }
        }
        if !has_conflict {
            jvm_args.push(arg);
        }
    }
}

/// JPMS 模块开放标志（Java 9+，Forge/NeoForge）
pub(crate) fn push_jpms_flags(jvm_args: &mut Vec<String>) {
    let flags: &[(&str, &str)] = &[
        ("--add-exports", "java.base/sun.security.util=ALL-UNNAMED"),
        ("--add-exports", "java.base/sun.security.x509=ALL-UNNAMED"),
        ("--add-opens", "java.base/java.lang=ALL-UNNAMED"),
        ("--add-opens", "java.base/java.lang.invoke=ALL-UNNAMED"),
        ("--add-opens", "java.base/java.lang.reflect=ALL-UNNAMED"),
        ("--add-opens", "java.base/java.io=ALL-UNNAMED"),
        ("--add-opens", "java.base/java.nio=ALL-UNNAMED"),
        ("--add-opens", "java.base/java.util=ALL-UNNAMED"),
        ("--add-opens", "java.base/java.util.concurrent=ALL-UNNAMED"),
        ("--add-opens", "java.base/java.util.concurrent.atomic=ALL-UNNAMED"),
        ("--add-opens", "java.base/java.util.concurrent.locks=ALL-UNNAMED"),
        ("--add-opens", "java.base/sun.nio.ch=ALL-UNNAMED"),
        ("--add-opens", "java.base/sun.nio.fs=ALL-UNNAMED"),
        ("--add-opens", "java.base/sun.security.action=ALL-UNNAMED"),
        ("--add-opens", "java.base/sun.security.provider=ALL-UNNAMED"),
        ("--add-opens", "java.base/jdk.internal.loader=ALL-UNNAMED"),
        ("--add-opens", "java.base/jdk.internal.ref=ALL-UNNAMED"),
        ("--add-opens", "java.base/jdk.internal.reflect=ALL-UNNAMED"),
        ("--add-opens", "java.base/jdk.internal.math=ALL-UNNAMED"),
        ("--add-opens", "java.base/jdk.internal.misc=ALL-UNNAMED"),
        ("--add-opens", "java.base/jdk.internal.util=ALL-UNNAMED"),
        ("--add-opens", "java.management/sun.management=ALL-UNNAMED"),
        ("--add-opens", "java.management/com.sun.jmx.mbeanserver=ALL-UNNAMED"),
        ("--add-opens", "jdk.management/com.sun.management.internal=ALL-UNNAMED"),
        ("--add-opens", "java.rmi/sun.rmi.registry=ALL-UNNAMED"),
        ("--add-opens", "java.rmi/sun.rmi.server=ALL-UNNAMED"),
        ("--add-opens", "java.desktop/java.awt=ALL-UNNAMED"),
        ("--add-opens", "java.desktop/java.awt.font=ALL-UNNAMED"),
        ("--add-opens", "java.desktop/java.awt.peer=ALL-UNNAMED"),
        ("--add-opens", "java.desktop/javax.swing=ALL-UNNAMED"),
        ("--add-opens", "java.desktop/sun.awt=ALL-UNNAMED"),
        ("--add-opens", "java.desktop/sun.java2d=ALL-UNNAMED"),
        ("--add-opens", "java.desktop/sun.font=ALL-UNNAMED"),
        ("--add-opens", "jdk.unsupported/sun.misc=ALL-UNNAMED"),
    ];
    for (flag, value) in flags {
        let exists = jvm_args.iter().enumerate().any(|(idx, a)| {
            a == flag
                && idx + 1 < jvm_args.len()
                && jvm_args[idx + 1] == *value
        });
        if !exists {
            jvm_args.push(flag.to_string());
            jvm_args.push(value.to_string());
        }
    }
}

/// 收集版本 JSON 中的 JVM 参数
pub(crate) fn collect_jvm_args_from_json(
    jvm_args: &mut Vec<String>,
    version_json: &Value,
    variables: &HashMap<String, String>,
    has_custom_resolution: bool,
    has_quick_play: bool,
) {
    // 收集 jvm 参数来源：标准 jvm 组 + default-user-jvm 组
    let mut sources: Vec<Value> = Vec::new();
    if let Some(arr) = version_json
        .get("arguments")
        .and_then(|v| v.get("jvm"))
        .and_then(|v| v.as_array())
    {
        sources.extend(arr.iter().cloned());
    }
    if let Some(arr) = version_json
        .get("arguments")
        .and_then(|v| v.get("default-user-jvm"))
        .and_then(|v| v.as_array())
    {
        sources.extend(arr.iter().cloned());
    }

    if sources.is_empty() {
        return;
    }

    let mut prev_was_cp = false;
    let mut i = 0;
    while i < sources.len() {
        let arg = &sources[i];
        if let Some(s) = arg.as_str() {
            let replaced = replace_variables(s, variables);
            if replaced == "-cp" {
                prev_was_cp = true;
                i += 1;
                continue;
            }
            if prev_was_cp {
                prev_was_cp = false;
                i += 1;
                continue;
            }
            prev_was_cp = false;
            if is_multi_value_flag_str(&replaced) {
                i = push_multi_value_flag(jvm_args, &sources, i, variables);
                continue;
            }
            push_ordinary_jvm_arg(jvm_args, &replaced);
        } else if let Some(value) = arg.get("value") {
            let rules_match = arg
                .get("rules")
                .and_then(|v| v.as_array())
                .map(|rules| dep_check::evaluate_rules(rules, has_custom_resolution, has_quick_play))
                .unwrap_or(true);
            if !rules_match {
                i += 1;
                continue;
            }
            if let Some(s) = value.as_str() {
                let replaced = replace_variables(s, variables);
                if is_multi_value_flag_str(&replaced) {
                    i = push_multi_value_flag(jvm_args, &sources, i, variables);
                    continue;
                }
                push_ordinary_jvm_arg(jvm_args, &replaced);
            } else if let Some(arr) = value.as_array() {
                let mut j = 0;
                while j < arr.len() {
                    if let Some(s) = arr[j].as_str() {
                        let replaced = replace_variables(s, variables);
                        if is_multi_value_flag_str(&replaced) {
                            j = push_multi_value_flag(jvm_args, arr, j, variables);
                            continue;
                        }
                        push_ordinary_jvm_arg(jvm_args, &replaced);
                    }
                    j += 1;
                }
            }
        }
        i += 1;
    }

    // 修复 Forge JSON 中常见的参数排列缺陷：
    // --add-opens/--add-exports 后面可能跟多个 value，但第二个 value 缺少前缀，
    // 导致 JVM 把它误识别为主类。这里自动为裸的 module/package=target 参数补充前缀。
    normalize_module_flags(jvm_args);
}

/// 判断字符串是否像 module/package=target 格式的 JPMS 值
pub(crate) fn looks_like_module_value(s: &str) -> bool {
    !s.starts_with('-') && s.contains('/') && s.contains('=')
}

/// 规范化 JPMS 模块标志：为缺少前缀的 module/package=target 参数
/// 自动补充前面最近出现的 --add-opens 或 --add-exports
pub(crate) fn normalize_module_flags(jvm_args: &mut Vec<String>) {
    let mut last_flag: Option<String> = None;
    let mut i = 0;
    while i < jvm_args.len() {
        let arg = &jvm_args[i];
        if arg == "--add-opens" || arg == "--add-exports" {
            last_flag = Some(arg.clone());
            // 正常情况下 flag 后面跟 value，跳过两个
            if i + 1 < jvm_args.len() {
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }
        // 检测裸的 module value（不是 flag，且格式像 module/package=target）
        if looks_like_module_value(arg)
            && let Some(flag) = &last_flag {
                let _value = arg.clone();
                jvm_args.insert(i, flag.clone());
                i += 2;
                continue;
            }
        i += 1;
    }
}

pub(crate) fn is_multi_value_flag_str(s: &str) -> bool {
    matches!(
        s,
        "--add-opens" | "--add-exports" | "--add-reads" | "--add-modules" | "--patch-module" | "-javaagent"
    )
}

pub(crate) fn push_ordinary_jvm_arg(jvm_args: &mut Vec<String>, replaced: &str) {
    if is_gc_arg(replaced) && has_garbage_collector_arg(jvm_args) {
        return;
    }
    if replaced.starts_with("-Xmx") || replaced.starts_with("-Xms") {
    } else if !jvm_args.iter().any(|existing| existing == replaced) {
        jvm_args.push(replaced.to_string());
    }
}

pub(crate) fn push_multi_value_flag(
    jvm_args: &mut Vec<String>,
    source: &[Value],
    idx: usize,
    variables: &HashMap<String, String>,
) -> usize {
    let mut flags: Vec<String> = Vec::new();
    let mut k = idx;
    let mut value: Option<String> = None;
    while k < source.len() {
        if let Some(s) = source[k].as_str() {
            let replaced = replace_variables(s, variables);
            if is_multi_value_flag_str(&replaced) {
                flags.push(replaced);
                k += 1;
                continue;
            }
            if replaced == "-cp" {
                break;
            }
            value = Some(replaced);
            k += 1;
            break;
        }
        break;
    }
    if let Some(val) = value {
        for f in &flags {
            let exists = jvm_args.iter().enumerate().any(|(p, a)| {
                a == f && p + 1 < jvm_args.len() && jvm_args[p + 1] == val
            });
            if !exists {
                jvm_args.push(f.clone());
                jvm_args.push(val.clone());
            }
        }
    } else {
        for f in flags {
            if !jvm_args.iter().any(|a| a == &f) {
                jvm_args.push(f);
            }
        }
    }
    k
}

/// 判断是否为 GC 参数
pub(crate) fn is_gc_arg(s: &str) -> bool {
    s.starts_with("-XX:+Use") || s.starts_with("-XX:-Use")
}

/// 检测是否已存在 GC 参数
pub(crate) fn has_garbage_collector_arg(args: &[String]) -> bool {
    args.iter().any(|a| {
        // -XX:+Use<XXX>GC / -XX:-Use<XXX>GC / -XX:+Use<XXX>Collector / -XX:-Use<XXX>Collector
        if let Some(rest) = a.strip_prefix("-XX:+Use") {
            rest.ends_with("GC") || rest.ends_with("Collector")
        } else if let Some(rest) = a.strip_prefix("-XX:-Use") {
            rest.ends_with("GC") || rest.ends_with("Collector")
        } else {
            false
        }
    })
}

/// 修复 java.library.path 参数（确保变量已替换）
pub(crate) fn fix_library_path(jvm_args: &mut Vec<String>, natives_dir: &Path) {
    let natives_str = natives_dir.to_string_lossy().to_string();
    let idx = jvm_args.iter().position(|a| a.contains("java.library.path"));
    if let Some(idx) = idx {
        let val = &jvm_args[idx];
        if val.contains("${natives_directory}") || val.contains("$natives_directory") {
            let replaced = val
                .replace("${natives_directory}", &natives_str)
                .replace("$natives_directory", &natives_str);
            jvm_args[idx] = replaced;
        }
    } else {
        jvm_args.push(format!("-Djava.library.path={}", natives_str));
    }
}

/// 确保指定的主 Jar 文件名被加入 ignoreList。
/// BootstrapLauncher 的 ignoreList 按"文件名前缀"匹配，漏掉会导致客户端 jar 被重复加载为模块。
pub(crate) fn ensure_main_jar_in_ignore_list(jvm_args: &mut Vec<String>, main_jar_path: &Path) {
    let file_name = match main_jar_path.file_name().and_then(|n| n.to_str()) {
        Some(n) if !n.is_empty() => n,
        _ => return,
    };
    let il_idx = jvm_args.iter().position(|a| a.starts_with("-DignoreList="));
    if let Some(il_idx) = il_idx {
        let existing: Vec<String> = jvm_args[il_idx]
            .strip_prefix("-DignoreList=")
            .unwrap_or("")
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        if existing.iter().any(|e| e == file_name) {
            return;
        }
        let mut all = existing;
        all.push(file_name.to_string());
        jvm_args[il_idx] = format!("-DignoreList={}", all.join(","));
    } else {
        jvm_args.push(format!("-DignoreList={}", file_name));
    }
}

/// 更新 module-path 中的引导 JAR 加入 ignoreList
pub(crate) fn update_ignore_list_for_module_path(jvm_args: &mut Vec<String>) {
    let p_idx = jvm_args
        .iter()
        .position(|a| a == "-p" || a == "--module-path");
    if let Some(idx) = p_idx {
        if idx + 1 >= jvm_args.len() {
            return;
        }
        let module_path_str = jvm_args[idx + 1].clone();
        let sep = if cfg!(target_os = "windows") { ';' } else { ':' };
        let module_jars: Vec<&str> = module_path_str
            .split(sep)
            .filter(|p| p.ends_with(".jar"))
            .collect();
        let mut prefixes: Vec<String> = Vec::new();
        for jar_path in &module_jars {
            let basename = std::path::Path::new(jar_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            // 提取前缀：到第一个 -<数字> 之前
            let prefix = if let Some(idx) = basename.rfind("-") {
                let after = &basename[idx + 1..];
                if after.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                    &basename[..idx]
                } else {
                    basename
                }
            } else {
                basename
            };
            if !prefix.is_empty() && !prefixes.contains(&prefix.to_string()) {
                prefixes.push(prefix.to_string());
            }
        }
        if prefixes.is_empty() {
            return;
        }
        let il_idx = jvm_args
            .iter()
            .position(|a| a.starts_with("-DignoreList="));
        if let Some(il_idx) = il_idx {
            let existing: Vec<&str> = jvm_args[il_idx]
                .strip_prefix("-DignoreList=")
                .unwrap_or("")
                .split(',')
                .filter(|s| !s.is_empty())
                .collect();
            let mut all: Vec<String> = existing.iter().map(|s| s.to_string()).collect();
            for pf in &prefixes {
                if !all.iter().any(|it| it == pf) {
                    all.push(pf.clone());
                }
            }
            jvm_args[il_idx] = format!("-DignoreList={}", all.join(","));
        } else {
            jvm_args.push(format!("-DignoreList={}", prefixes.join(",")));
        }
    }
}

/// 注入 authlib-injector javaagent
pub(crate) fn inject_authlib_agent(jvm_args: &mut Vec<String>, data_dir: &Path, server_url: &str) {
    let ai_dir = data_dir.join("authlib-injector");
    if !ai_dir.exists() {
        return;
    }
    let mut jars: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&ai_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".jar") {
                jars.push(name);
            }
        }
    }
    jars.sort();
    if let Some(latest) = jars.last() {
        let ai_path = ai_dir.join(latest);
        // 去除 serverUrl 中的 @@@ / @@ 分隔符
        let clean_url = server_url.split("@@@").next().unwrap_or(server_url);
        let clean_url = clean_url.split("@@").next().unwrap_or(clean_url);
        let has_javaagent = jvm_args.iter().any(|a| a.starts_with("-javaagent:"));
        if !has_javaagent {
            jvm_args.insert(0, format!("-javaagent:{}={}", ai_path.to_string_lossy(), clean_url));
        }
    }
}

/// 下载并注入 log4j2 配置文件
pub(crate) fn inject_log4j_config(
    jvm_args: &mut Vec<String>,
    version_json: &Value,
    version_id: &str,
    versions_dir: &Path,
) {
    let argument = version_json
        .get("logging")
        .and_then(|v| v.get("client"))
        .and_then(|v| v.get("argument"))
        .and_then(|v| v.as_str());
    let file_id = version_json
        .get("logging")
        .and_then(|v| v.get("client"))
        .and_then(|v| v.get("file"))
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str());
    let (argument, file_id) = match (argument, file_id) {
        (Some(a), Some(f)) => (a.to_string(), f.to_string()),
        _ => return,
    };
    let log_config_path = versions_dir.join(version_id).join(&file_id);
    if !log_config_path.exists() {
        // 异步下载由调用方处理，这里跳过
        return;
    }
    let arg = argument.replace("${path}", &log_config_path.to_string_lossy());
    let has_log_arg = jvm_args.iter().any(|a| {
        a.contains("log4j2") || a.contains("Log4j") || a.contains("log4j.configurationFile")
    });
    if !has_log_arg {
        jvm_args.push(arg);
    }
}

/// 读取启动器存储中的内存配置
pub(crate) fn resolve_memory_settings(
    settings: &Value,
    version_id: &str,
    data_dir: &Path,
) -> (MemoryMode, Option<u64>) {
    // 优先级 1：版本独立设置（version-settings.json 的 memoryMode/memoryValue）
    let ver_settings = storage::load_version_settings(version_id, false);
    let ver_mode = utils::get_str(&ver_settings, "memoryMode");
    let ver_value = ver_settings.get("memoryValue").and_then(|v| v.as_u64());
    if ver_mode == "custom" {
        return (MemoryMode::Custom(ver_value.unwrap_or(4096)), None);
    }
    if ver_mode == "auto" {
        return (MemoryMode::Auto, None);
    }

    // 优先级 2：前端 launch_settings（store.json 中的 versepc_launch_settings）
    let store_path = data_dir.join("store.json");
    if store_path.exists()
        && let Ok(content) = std::fs::read_to_string(&store_path)
            && let Ok(store) = serde_json::from_str::<Value>(&content)
                && let Some(launch_str) = store.get("versepc_launch_settings").and_then(|v| v.as_str())
                    && let Ok(launch_settings) = serde_json::from_str::<Value>(launch_str) {
                        let launch_mode = utils::get_str(&launch_settings, "memoryMode");
                        let launch_value = launch_settings.get("memoryValue").and_then(|v| v.as_u64());
                        if launch_mode == "custom" {
                            return (MemoryMode::Custom(launch_value.unwrap_or(4096)), None);
                        }
                        if launch_mode == "auto" {
                            return (MemoryMode::Auto, None);
                        }
                        // 启动设置存在但无明确模式 → 走 resolve_memory_mode 决策
                        let settings_max = settings.get("maxMemory").and_then(|v| v.as_u64()).unwrap_or(4096);
                        let mode = resolve_memory_mode(settings_max, true, Some("auto"), launch_value);
                        return (mode, None);
                    }

    // 优先级 3：通过 resolve_memory_mode 决策
    let settings_max = settings.get("maxMemory").and_then(|v| v.as_u64()).unwrap_or(4096);
    let mode = resolve_memory_mode(settings_max, false, None, None);
    (mode, None)
}
