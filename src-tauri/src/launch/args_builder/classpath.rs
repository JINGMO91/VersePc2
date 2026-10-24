// classpath.rs — 由 args_builder.rs 拆分
#![allow(unused_imports)]

// Classpath 构建与依赖去重
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

/// 构建完整 classpath
/// 简化版：遍历 libraries，根据 rules 过滤，根据 downloads.artifact.path 拼接路径
/// 不实现 natives 处理、模块化库处理等复杂逻辑（natives 由 extract_natives_dir 单独处理）
pub fn build_classpath(
    version_json: &Value,
    external_version_dir: Option<&Path>,
    libraries_dir: &Path,
) -> Vec<String> {
    // 同一 group:artifact 只保留版本最高的一个。
    // 典型场景：原版 1.21.10 带 asm 9.6，Fabric 带 asm 9.10.1，
    // 两个 jar 同时进入 classpath 会让 Fabric 校验报
    // "duplicate ASM classes found on classpath" 并以退出码 1 结束。
    let mut entries: Vec<ClasspathEntry> = Vec::new();
    let libraries = version_json
        .get("libraries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 搜索路径：外部根的 libraries 优先，其次本地 libraries
    let mut search_bases: Vec<PathBuf> = Vec::new();
    if let Some(ext_dir) = external_version_dir
        && let Some(root) = dep_check::find_external_root(ext_dir) {
            search_bases.push(root.join("libraries"));
        }
    search_bases.push(libraries_dir.to_path_buf());

    let current_os = dep_check::current_platform_name();
    let current_arch = dep_check::current_arch_name();

    for lib in &libraries {
        // rules 过滤
        if let Some(rules) = lib.get("rules").and_then(|v| v.as_array())
            && !dep_check::evaluate_rules(rules, false, false) {
                continue;
            }

        let name = utils::get_str(lib, "name");
        // 跳过 natives 库（它们通过 -Djava.library.path 加载）
        if is_native_library(lib, &current_os) {
            continue;
        }

        // NeoForge: neoforge:*:client 是虚拟库记录（官方 Maven 返回 404，不可直接下载），
        // 不把 patched/universal jar 加入 classpath。这些 jar 由 FML 的
        // ProductionClientProviderLocator 通过 -DlibraryDirectory + --fml.neoForgeVersion
        // 参数自动查找并加载。若手动加入 classpath 会让 FML 误判为 DEV 模式，
        // 报 "Couldn't find NeoForgeMod.class" 与 "The patched Minecraft jar is missing"。
        if name.starts_with("net.neoforged:neoforge:") && name.ends_with(":client") {
            continue;
        }

        let mut resolved_path: Option<String> = None;

        // 优先用 downloads.artifact.path
        if let Some(artifact) = lib.get("downloads").and_then(|d| d.get("artifact"))
            && let Some(path) = artifact.get("path").and_then(|p| p.as_str())
                && !path.is_empty() {
                    resolved_path = find_lib_in_bases(&search_bases, path);
                }

        // 回退：从 maven name 解析路径
        if resolved_path.is_none() && !name.is_empty()
            && let Some(rel_path) = maven_name_to_path(&name) {
                resolved_path = find_lib_in_bases(&search_bases, &rel_path);
            }

        // 最后回退：扫描目录
        if resolved_path.is_none() && !name.is_empty() {
            resolved_path = find_lib_by_fallback(&name, &search_bases);
        }

        if let Some(path) = resolved_path {
            push_classpath_entry(&mut entries, &name, path);
        }
    }

    let _ = (current_os, current_arch); // 标记变量已用
    entries.into_iter().map(|e| e.path).collect()
}

/// classpath 中的一条库记录
pub(crate) struct ClasspathEntry {
    /// group:artifact（用于同名库去重）
    pub(crate) key: Option<String>,
    pub(crate) version: String,
    pub(crate) path: String,
}

/// 加入 classpath；同一 group:artifact 已存在时保留版本更高的那个
pub(crate) fn push_classpath_entry(entries: &mut Vec<ClasspathEntry>, name: &str, path: String) {
    // 同一路径只保留一次
    if entries.iter().any(|e| e.path == path) {
        return;
    }
    let key = lib_artifact_key(name);
    let version = lib_version_of(name, &path);
    if let Some(k) = key.as_deref()
        && let Some(existing) = entries
            .iter_mut()
            .find(|e| e.key.as_deref() == Some(k))
        {
            if compare_lib_version(&version, &existing.version) == std::cmp::Ordering::Greater {
                existing.version = version;
                existing.path = path;
            }
            return;
        }
    entries.push(ClasspathEntry {
        key,
        version,
        path,
    });
}

/// 从 Maven 坐标取 group:artifact 作为去重键
pub(crate) fn lib_artifact_key(name: &str) -> Option<String> {
    let mut parts = name.split(':');
    let group = parts.next()?.trim();
    let artifact = parts.next()?.trim();
    if group.is_empty() || artifact.is_empty() {
        return None;
    }
    Some(format!("{}:{}", group, artifact))
}

/// 从 Maven 坐标或文件路径取库版本号
pub(crate) fn lib_version_of(name: &str, path: &str) -> String {
    if let Some(v) = name.split(':').nth(2) {
        let v = v.trim();
        if !v.is_empty() {
            return v.to_string();
        }
    }
    Path::new(path)
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string()
}

/// 库版本比较：按 `.`/`-`/`_`/`+` 分段，数字段按数值比较，其余按字符串比较
pub(crate) fn compare_lib_version(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let split = |s: &str| {
        s.split(['.', '-', '_', '+'])
            .map(|p| p.to_string())
            .collect::<Vec<_>>()
    };
    let av = split(a);
    let bv = split(b);
    for i in 0..av.len().max(bv.len()) {
        let x = av.get(i).map(|s| s.as_str()).unwrap_or("0");
        let y = bv.get(i).map(|s| s.as_str()).unwrap_or("0");
        let ord = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(nx), Ok(ny)) => nx.cmp(&ny),
            _ => x.cmp(y),
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    Ordering::Equal
}

/// Maven 名称转相对路径
/// 例：`com.google.code.gson:gson:2.10` → `com/google/code/gson/gson/2.10/gson-2.10.jar`
pub(crate) fn maven_name_to_path(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group_path = parts[0].replace('.', "/");
    let artifact_id = parts[1];
    let version = parts[2];
    let classifier = if parts.len() >= 4 {
        format!("-{}", parts[3])
    } else {
        String::new()
    };
    let jar_name = format!("{}-{}{}.jar", artifact_id, version, classifier);
    Some(format!("{}/{}/{}/{}", group_path, artifact_id, version, jar_name))
}

/// 在多个搜索基目录中查找文件
pub(crate) fn find_lib_in_bases(bases: &[PathBuf], rel_path: &str) -> Option<String> {
    for base in bases {
        let p = base.join(rel_path);
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

/// 兜底：扫描目录找到匹配的 JAR
pub(crate) fn find_lib_by_fallback(name: &str, bases: &[PathBuf]) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group_path = parts[0].replace('.', std::path::MAIN_SEPARATOR_STR);
    let artifact_id = parts[1];
    let version = parts[2];
    let classifier = if parts.len() >= 4 { Some(parts[3]) } else { None };

    for base in bases {
        let dir = base.join(&group_path).join(artifact_id).join(version);
        if !dir.exists() {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let mut jars: Vec<String> = Vec::new();
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.ends_with(".jar")
                && !fname.ends_with("-sources.jar")
                && !fname.ends_with("-javadoc.jar")
            {
                jars.push(fname);
            }
        }
        if jars.is_empty() {
            continue;
        }
        if let Some(cls) = classifier {
            let preferred = format!("{}-{}-{}.jar", artifact_id, version, cls);
            if let Some(m) = jars.iter().find(|f| *f == &preferred) {
                return Some(dir.join(m).to_string_lossy().to_string());
            }
        }
        let preferred = format!("{}-{}.jar", artifact_id, version);
        if let Some(m) = jars.iter().find(|f| *f == &preferred) {
            return Some(dir.join(m).to_string_lossy().to_string());
        }
        return Some(dir.join(&jars[0]).to_string_lossy().to_string());
    }
    None
}
