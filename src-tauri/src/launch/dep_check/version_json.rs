// version_json.rs — 由 dep_check.rs 拆分
#![allow(unused_imports)]

// 版本 JSON 解析、继承链、规则与 Java 版本匹配
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use regex::Regex;
use crate::java;
use crate::storage;
use crate::utils;
use super::*;

/// 获取当前平台名（windows/osx/linux）
pub(crate) fn current_platform_name() -> String {
    crate::platform::rules_os_name().to_string()
}

/// 获取当前架构名（与版本 JSON rules 中的 os.arch 取值一致）
pub(crate) fn current_arch_name() -> &'static str {
    crate::platform::rules_arch_name()
}

/// 沿目录树向上查找外部根（同时有 versions/ 和 libraries/ 或 assets/ 的目录）
pub(crate) fn find_external_root(version_dir: &Path) -> Option<PathBuf> {
    let mut dir = version_dir.to_path_buf();
    for _ in 0..8 {
        if dir.join("versions").exists() && dir.join("libraries").exists() {
            return Some(dir);
        }
        if dir.join("versions").exists() && dir.join("assets").exists() {
            return Some(dir);
        }
        if dir.join("versions").exists() {
            return Some(dir);
        }
        if let Some(parent) = dir.parent() {
            if parent == dir {
                break;
            }
            dir = parent.to_path_buf();
        } else {
            break;
        }
    }
    None
}

/// 沿外部根目录或本地 versions/ 查找版本 JSON
pub(crate) fn resolve_version_json(version_id: &str, external_version_dir: Option<&Path>) -> Option<PathBuf> {
    // 1. 优先：外部版本目录
    if let Some(ext_dir) = external_version_dir {
        let p = ext_dir.join(format!("{}.json", version_id));
        if p.exists() {
            return Some(p);
        }
        // 外部根的 versions/<id>/<id>.json
        if let Some(root) = find_external_root(ext_dir) {
            let p = root.join("versions").join(version_id).join(format!("{}.json", version_id));
            if p.exists() {
                return Some(p);
            }
        }
    }
    // 2. 本地 versions/<id>/<id>.json
    let data_dir = storage::resolve_data_dir();
    let local_path = data_dir.join("versions").join(version_id).join(format!("{}.json", version_id));
    if local_path.exists() {
        return Some(local_path);
    }
    // 3. 兜底扫描：本地或外部目录中找任意 .json 含 mainClass/libraries/inheritsFrom
    let scan_dir = external_version_dir
        .map(|d| d.to_path_buf())
        .unwrap_or_else(|| data_dir.join("versions").join(version_id));
    if let Ok(entries) = std::fs::read_dir(&scan_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&p)
                && (content.contains("mainClass")
                    || content.contains("libraries")
                    || content.contains("inheritsFrom")
                    || content.contains("minecraftArguments")
                    || content.contains("arguments"))
                {
                    return Some(p);
                }
        }
    }
    None
}

/// 仅查找版本 JSON 路径（不读取内容），用于前置版本存在性判断
pub(crate) fn find_version_json_path(version_id: &str, external_version_dir: Option<&Path>) -> Option<PathBuf> {
    resolve_version_json(version_id, external_version_dir)
}

/// 递归读取并合并版本 JSON 的继承链
/// 父版本提供 libraries / arguments / natives 等，当前版本覆盖同名字段
pub(crate) fn merge_version_json_chain(
    version_id: &str,
    external_version_dir: Option<&Path>,
) -> Option<Value> {
    let path = resolve_version_json(version_id, external_version_dir)?;
    let content = std::fs::read_to_string(&path).ok()?;
    let mut current: Value = serde_json::from_str(&content).ok()?;

    // 先把 id 设对（有些 inheritsFrom 子 JSON 没 id）
    if current.get("id").is_none()
        && let Value::Object(ref mut m) = current {
            m.insert("id".to_string(), Value::String(version_id.to_string()));
        }

    let inherits_from = utils::get_str(&current, "inheritsFrom");
    if inherits_from.is_empty() {
        return Some(current);
    }

    // 递归合并父版本
    let parent = merge_version_json_chain(&inherits_from, external_version_dir)?;
    Some(merge_two_version_jsons(parent, current))
}

/// 合并两个版本 JSON：base 是父版本，child 是当前版本
/// 深度合并全部字段（对象递归、数组按 Newtonsoft MergeArrayHandling.Concat 拼接、
/// 其余 scalar 由子版本覆盖），libraries 单独处理为"子版本在前、父版本在后"，
/// 继承标记在合并链中已消费后移除。
pub(crate) fn merge_two_version_jsons(base: Value, child: Value) -> Value {
    let child_libs = child.get("libraries").cloned();
    let parent_libs = base.get("libraries").cloned();

    let mut result = deep_merge_json(&base, &child);

    if child_libs.is_some() || parent_libs.is_some() {
        let mut libs = child_libs.and_then(|v| v.as_array().cloned()).unwrap_or_default();
        if let Some(pl) = parent_libs.and_then(|v| v.as_array().cloned()) {
            libs.extend(pl);
        }
        if let Value::Object(ref mut m) = result {
            m.insert("libraries".to_string(), Value::Array(libs));
        }
    }

    if let Value::Object(ref mut m) = result {
        m.remove("inheritsFrom");
    }

    result
}

/// 递归深度合并两个 JSON：两值都是对象则按 key 递归合并；
/// 两值都是数组则拼接（父在前面）；否则子版本值覆盖父版本。
pub(crate) fn deep_merge_json(parent: &Value, child: &Value) -> Value {
    match (parent, child) {
        (Value::Object(p), Value::Object(c)) => {
            let mut out = p.clone();
            for (k, cv) in c {
                match out.get_mut(k) {
                    Some(pv) if pv.is_object() && cv.is_object() => {
                        *pv = deep_merge_json(pv, cv);
                    }
                    Some(pv) if pv.is_array() && cv.is_array() => {
                        let mut arr = pv.as_array().cloned().unwrap_or_default();
                        arr.extend(cv.as_array().cloned().unwrap_or_default());
                        *pv = Value::Array(arr);
                    }
                    _ => {
                        out.insert(k.clone(), cv.clone());
                    }
                }
            }
            Value::Object(out)
        }
        _ => child.clone(),
    }
}

/// 沿多路径搜索主 JAR
pub(crate) fn find_main_jar(version_json: &Value, version_id: &str, external_version_dir: Option<&Path>) -> Option<PathBuf> {
    let data_dir = storage::resolve_data_dir();
    let versions_dir = data_dir.join("versions");

    let actual_id = if !version_id.is_empty() {
        version_id.to_string()
    } else {
        utils::get_str(version_json, "id")
    };
    let jar_field = utils::get_str(version_json, "jar");
    let inherits_from = utils::get_str(version_json, "inheritsFrom");
    let _jar_name = if !jar_field.is_empty() {
        jar_field.clone()
    } else if !inherits_from.is_empty() {
        inherits_from.clone()
    } else {
        actual_id.clone()
    };

    let external_root = external_version_dir.and_then(find_external_root);

    let mut search_paths: Vec<PathBuf> = Vec::new();

    // jar 字段优先
    if !jar_field.is_empty() {
        if let Some(root) = &external_root {
            search_paths.push(root.join("versions").join(&jar_field).join(format!("{}.jar", jar_field)));
        }
        search_paths.push(versions_dir.join(&jar_field).join(format!("{}.jar", jar_field)));
    }

    if external_version_dir.is_some() {
        if let Some(root) = &external_root {
            search_paths.push(root.join("versions").join(&actual_id).join(format!("{}.jar", actual_id)));
        }
        if let Some(ext_dir) = external_version_dir {
            search_paths.push(ext_dir.join(format!("{}.jar", actual_id)));
            let dir_name = ext_dir.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            search_paths.push(ext_dir.join(format!("{}.jar", dir_name)));
            if let Some(root) = &external_root
                && dir_name != actual_id {
                    search_paths.push(root.join("versions").join(&dir_name).join(format!("{}.jar", dir_name)));
                }
        }
    }

    search_paths.push(versions_dir.join(&actual_id).join(format!("{}.jar", actual_id)));

    if !inherits_from.is_empty() {
        if let Some(root) = &external_root {
            search_paths.push(root.join("versions").join(&inherits_from).join(format!("{}.jar", inherits_from)));
        }
        if let Some(ext_dir) = external_version_dir
            && let Some(parent) = ext_dir.parent() {
                search_paths.push(parent.join(&inherits_from).join(format!("{}.jar", inherits_from)));
            }
        search_paths.push(versions_dir.join(&inherits_from).join(format!("{}.jar", inherits_from)));
    }

    for p in &search_paths {
        if p.exists() {
            return Some(p.clone());
        }
    }

    // 外部根目录下扫描第一个含 jar 的版本目录
    if let Some(root) = &external_root {
        for jar_id in &[&jar_field, &inherits_from, &actual_id] {
            if jar_id.is_empty() {
                continue;
            }
            let ver_dir = root.join("versions").join(jar_id);
            if ver_dir.exists()
                && let Ok(entries) = std::fs::read_dir(&ver_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.extension().and_then(|e| e.to_str()) == Some("jar") {
                            return Some(p);
                        }
                    }
                }
        }
    }

    // 沿继承链递归查找主 JAR。
    // 传入的 version_json 可能是合并后的（inheritsFrom/jar 已被移除），
    // 因此这里重新读取当前版本的原始 JSON，恢复继承链并逐级向下查找。
    // 例：RLCraft → 1.12.2-forge-14.23.5.2860 → 1.12.2，最终命中 1.12.2.jar
    let mut chain_id = if inherits_from.is_empty() {
        actual_id.clone()
    } else {
        inherits_from.clone()
    };
    let mut depth = 0;
    while depth < 32 && !chain_id.is_empty() {
        depth += 1;

        // 尝试当前层级的 jar 是否存在
        let mut hit = versions_dir.join(&chain_id).join(format!("{}.jar", chain_id));
        if hit.exists() {
            return Some(hit);
        }
        if let Some(root) = &external_root {
            hit = root.join("versions").join(&chain_id).join(format!("{}.jar", chain_id));
            if hit.exists() {
                return Some(hit);
            }
        }

        // 读取父版本 JSON，跟随其 jar / inheritsFrom
        if let Some(json_path) = resolve_version_json(&chain_id, external_version_dir)
            && let Ok(content) = std::fs::read_to_string(&json_path)
                && let Ok(parent_json) = serde_json::from_str::<Value>(&content) {
                    let parent_jar = utils::get_str(&parent_json, "jar");
                    let parent_inherits = utils::get_str(&parent_json, "inheritsFrom");
                    // 若父版本显式声明 jar，则下一层级直接检查该 jar
                    if !parent_jar.is_empty() {
                        let jp = versions_dir.join(&parent_jar).join(format!("{}.jar", parent_jar));
                        if jp.exists() {
                            return Some(jp);
                        }
                        if let Some(root) = &external_root {
                            let jp2 = root.join("versions").join(&parent_jar).join(format!("{}.jar", parent_jar));
                            if jp2.exists() {
                                return Some(jp2);
                            }
                        }
                    }
                    chain_id = parent_inherits;
                    continue;
                }
        break;
    }

    None
}

/// 评估版本 JSON 的 rules 数组
/// `has_custom_resolution` 特性
pub(crate) fn evaluate_rules(
    rules: &Vec<Value>,
    has_custom_resolution: bool,
    has_quick_play: bool,
) -> bool {
    if rules.is_empty() {
        return true;
    }
    let mut allowed: Option<bool> = None;
    let mut has_allow_rule = false;
    let current_os = current_platform_name();
    let current_arch = current_arch_name();

    for rule in rules {
        let action = utils::get_str(rule, "action");
        if action == "allow" {
            has_allow_rule = true;
        }
        let mut rule_matched = true;

        if let Some(os) = rule.get("os").and_then(|v| v.as_object()) {
            if let Some(os_name) = os.get("name").and_then(|v| v.as_str()) {
                rule_matched = os_name == current_os;
            }
            if let Some(os_arch) = os.get("arch").and_then(|v| v.as_str()) {
                rule_matched = rule_matched && os_arch == current_arch;
            }
            if let Some(os_ver) = os.get("version").and_then(|v| v.as_str())
                && !os_ver.is_empty() {
                    rule_matched = rule_matched && os_version_matches(os_ver);
                }
        }

        if let Some(features) = rule.get("features").and_then(|v| v.as_object()) {
            if features.contains_key("is_demo_user") {
                rule_matched = false;
            }
            if features.contains_key("has_custom_resolution") {
                rule_matched = rule_matched && has_custom_resolution;
            }
            // quick play：单机快速进世界是否启用由 has_quick_play 决定
            if features.contains_key("has_quick_plays_support") {
                rule_matched = rule_matched && has_quick_play;
            }
            if features.contains_key("is_quick_play_singleplayer") {
                rule_matched = rule_matched && has_quick_play;
            }
            if features.contains_key("is_quick_play_multiplayer")
                || features.contains_key("is_quick_play_realms")
            {
                rule_matched = false;
            }
        }

        if rule.get("os").is_none() && rule.get("features").is_none() {
            rule_matched = true;
        }

        if rule_matched {
            allowed = Some(action == "allow");
        }
    }

    allowed.unwrap_or(!has_allow_rule)
}

/// 获取 Java 主版本范围（综合 JSON 声明、MC 版本、加载器约束）
pub(crate) fn get_java_version_range_from_json(version_id: &str, version_json: &Value) -> (u32, u32) {
    let mut min: u32 = 8;
    let mut max: u32 = 999;

    // 0. 清理外部版本标记：外部版本在列表中显示为 "26.2 [外部1]"，解析基础 MC 版本前需去掉后缀
    let clean_version_id = if version_id.contains(" [外部") {
        version_id.split(" [外部").next().unwrap_or(version_id).trim()
    } else if version_id.contains("[外部") {
        version_id.split("[外部").next().unwrap_or(version_id).trim()
    } else {
        version_id
    };

    // 1. JSON 明确要求的 javaVersion.majorVersion（优先级最高，作为下限）
    if let Some(jv) = version_json.get("javaVersion")
        && let Some(major) = jv.get("majorVersion").and_then(|v| v.as_u64()) {
            let major = major as u32;
            if major > 8 {
                min = min.max(major);
            }
        }

    // 2. 解析基础 MC 版本：优先 inheritsFrom，其次版本 id / version_id
    let inherits_from = utils::get_str(version_json, "inheritsFrom");
    let base_mc = if !inherits_from.is_empty() {
        extract_mc_version(&inherits_from)
    } else {
        let id = utils::get_str(version_json, "id");
        let from_id = if !id.is_empty() { id } else { clean_version_id.to_string() };
        extract_mc_version(&from_id)
    };
    let (major, minor, patch) = parse_version_triple(&base_mc);

    // 3. 按 MC 版本设定 Java 下限
    if major >= 2 {
        // 新版本号体系（如 26.2）：需要 Java 25+（Java 25 为长期支持版本）
        min = min.max(25);
    } else if major == 1 && minor >= 20 && patch >= 5 {
        min = min.max(21); // 1.20.5+ → Java 21
    } else if major == 1 && minor >= 18 {
        min = min.max(17); // 1.18+ → Java 17
    } else if major == 1 && minor == 17 {
        min = min.max(16); // 1.17 → Java 16
    }

    // 4. Forge / NeoForge 且 MC ≤1.12.2：必须 Java 8（launchwrapper 与 Java 9+ 不兼容）
    let version_id_lower = version_id.to_lowercase();
    let inherits_lower = inherits_from.to_lowercase();
    let is_neo = inherits_lower.contains("neoforge") || inherits_lower.contains("neoforged")
        || version_json.to_string().to_lowercase().contains("neoforged");
    let is_forge = (version_id_lower.contains("forge")
        || inherits_lower.contains("forge")
        || version_json.to_string().to_lowercase().contains("minecraftforge"))
        && !is_neo;
    if is_forge && (major == 1 && minor <= 12) {
        min = min.max(8);
        max = max.min(8);
    }

    // 5. Forge 1.18-1.20.4：官方推荐 Java 17，最高兼容到 Java 21。
    //    Java 22+ 会触发 modlauncher 模块导出冲突（如 "Modules ... and minecraft export
    //    package ... to module fancymenu"）导致启动崩溃，因此把上限限制在 21，
    //    避免误选过新的 Java。
    if is_forge && (major == 1 && minor >= 18 && (minor < 20 || (minor == 20 && patch <= 4))) {
        max = max.min(21);
    }

    // 6. launchwrapper 主类：与 Java 9+ 不兼容，强制最高 Java 8（最高优先级安全约束）
    let main_class = utils::get_str(version_json, "mainClass").to_lowercase();
    if main_class == "net.minecraft.launchwrapper.launch" || main_class.contains("launchwrapper") {
        max = max.min(8);
    }

    if min > max {
        max = min;
    }
    (min, max)
}

/// 从版本 ID 提取 Minecraft 版本号（如 "1.20.1-Forge-47.3.0" → "1.20.1"）
pub(crate) fn extract_mc_version(version_id: &str) -> String {
    for part in version_id.split('-') {
        let segs: Vec<&str> = part.split('.').collect();
        if segs.len() >= 2
            && segs[0].parse::<u32>().is_ok() && segs[1].parse::<u32>().is_ok() {
                return part.to_string();
            }
    }
    String::new()
}

/// 解析版本号三元组 (major, minor, patch)，缺省为 0
pub(crate) fn parse_version_triple(version: &str) -> (u32, u32, u32) {
    let parts: Vec<&str> = version.split('.').collect();
    let major = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let patch = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    (major, minor, patch)
}

/// 选择适合版本要求的 Java 路径
/// 简化版：优先版本独立 javaPath，其次全局 javaPath，最后从检测列表中匹配
/// 设置中的路径如果无法检测版本，会自动回退到检测列表
///
/// 匹配策略（与主流启动器一致）：
/// 以版本 JSON 声明的 javaVersion.majorVersion 为"精确目标版本"，优先选完全一致
/// 的 Java；找不到时再就近选不低于需求、不高于上限的版本，避免误选过高版本
/// 触发模块系统冲突（如 Forge 用 Java 25 启动 1.20.1 崩溃）。
pub(crate) fn select_java_for_version(version_id: &str, settings: &Value, version_json: &Value) -> String {
    let (req_min, req_max) = get_java_version_range_from_json(version_id, version_json);

    // 版本独立设置：指定的 Java 必须满足版本要求，否则回退
    let is_external = version_id.contains(" [外部");
    let clean_id = if is_external {
        version_id.split(" [外部").next().unwrap_or(version_id).to_string()
    } else {
        version_id.to_string()
    };
    let ver_settings = storage::load_version_settings(&clean_id, is_external);
    let ver_java = utils::get_str(&ver_settings, "javaPath");
    if !ver_java.is_empty()
        && let Some((_, major)) = inspect_java_version(&ver_java)
            && major >= req_min && major <= req_max {
                return ver_java;
            }
    // 全局设置：指定的 Java 必须满足版本要求，否则回退
    let global_java = utils::get_str(settings, "javaPath");
    if !global_java.is_empty()
        && let Some((_, major)) = inspect_java_version(&global_java)
            && major >= req_min && major <= req_max {
                return global_java;
            }
    // 检测列表中找满足范围的最高版本 Java
    let java_list = java::detect_all();
    eprintln!(
        "[select_java_for_version] 需求范围 {}~{}，检测到 {} 个 Java",
        req_min,
        req_max,
        java_list.len()
    );
    for j in &java_list {
        let mv = j.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0);
        let p = utils::get_str(j, "path");
        eprintln!("[select_java_for_version]   候选: major={} path={}", mv, p);
    }
    // 以版本 JSON 声明的 javaVersion.majorVersion 为精确目标版本：
    // 优先选与目标完全一致的 Java；找不到时再就近选不低于需求、不高于上限的版本，
    // 始终受 [req_min, req_max] 范围约束，避免误选过高版本。
    let target_major = version_json
        .get("javaVersion")
        .and_then(|jv| jv.get("majorVersion"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .filter(|v| *v > 8)
        .unwrap_or(req_min);

    let mut exact: Option<(&Value, u32)> = None;
    let mut nearest: Option<(&Value, i64)> = None; // (candidate, |major - target|)
    for j in &java_list {
        let mv = j.get("majorVersion").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        if mv < req_min || mv > req_max {
            continue;
        }
        if mv == target_major {
            exact = Some((j, mv));
            break;
        }
        let dist = (mv as i64 - target_major as i64).abs();
        if nearest.as_ref().map(|(_, d)| dist < *d).unwrap_or(true) {
            nearest = Some((j, dist));
        }
    }
    if let Some((j, _)) = exact.or_else(|| nearest.map(|(j, _)| (j, 0))) {
        return utils::get_str(j, "path");
    }
    String::new()
}

/// 解析版本字符串中的主版本号
pub(crate) fn parse_java_major(version: &str) -> u32 {
    if version.starts_with("1.") {
        version.split('.').nth(1).and_then(|s| s.parse().ok()).unwrap_or(8)
    } else {
        version.split('.').next().and_then(|s| s.parse().ok()).unwrap_or(0)
    }
}

/// 执行 java -version 获取版本字符串和主版本号
/// 优先读取 <javaHome>/release 文件（更快、更稳），失败再执行 java -version
pub(crate) fn inspect_java_version(java_path: &str) -> Option<(String, u32)> {
    use std::process::Command;

    let path = PathBuf::from(java_path);
    // 1. 优先读 release 文件，避免某些 runtime 执行 java -version 失败导致误判
    if let Some(java_home) = path.parent().and_then(|p| p.parent()) {
        let release = java_home.join("release");
        if let Ok(content) = std::fs::read_to_string(&release) {
            for line in content.lines() {
                if line.starts_with("JAVA_VERSION=") {
                    let version = line.trim_start_matches("JAVA_VERSION=").trim_matches('"');
                    let major = parse_java_major(version);
                    return Some((version.to_string(), major));
                }
            }
        }
    }

    // 2. 回退到执行 java -version
    #[cfg(target_os = "windows")]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new(java_path);
        c.arg("-version");
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new(java_path);
        c.arg("-version");
        c
    };
    let out = cmd.output().ok()?;
    // javaw.exe 通常没有 stderr/stdout 输出，若命令成功但无输出，尝试用 java.exe 同目录再测一次
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    let combined = format!("{}\n{}", stderr, stdout);

    // 解析 version "x.y.z"
    let mut version = String::new();
    for line in combined.lines() {
        if line.contains("version")
            && let Some(start) = line.find('"')
                && let Some(end) = line[start + 1..].find('"') {
                    version = line[start + 1..start + 1 + end].to_string();
                    break;
                }
    }
    if version.is_empty() {
        return None;
    }
    let major = parse_java_major(&version);
    Some((version, major))
}
