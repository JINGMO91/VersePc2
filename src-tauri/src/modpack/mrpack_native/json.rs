// modpack/mrpack_native/json.rs — 版本 JSON 合并与 JVM 参数整理
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Semaphore};

use crate::modpack::curseforge_shared as cf_shared;
use super::{emit_progress, emit_progress_with_files, normalize_version_id, versions_dir};
use crate::modloaders::shared as ml_shared;
use crate::storage;

use super::{MrpackManifest, MrpackDependencies, MrpackFile, CleanupAbort, LoaderKind, MAX_DOWNLOAD_ROUNDS};

/// 创建版本 JSON（合并加载器 JSON 到原版 JSON 之上）
pub(crate) fn create_version_json_with_merge(
    version_id: &str,
    version_dir: &Path,
    mc_version: &str,
    loader_version_id: Option<&str>,
) {
    if let Some(lv_id) = loader_version_id {
        let lv_json_path = versions_dir().join(lv_id).join(format!("{}.json", lv_id));
        let mut merged_json: Option<Value> = None;

        if lv_json_path.exists() {
            let lv_json: Value = match std::fs::read_to_string(&lv_json_path) {
                Ok(s) => serde_json::from_str(&s).unwrap_or(json!({})),
                Err(_) => json!({}),
            };

            if !mc_version.is_empty() {
                let vanilla_json_path = versions_dir().join(mc_version).join(format!("{}.json", mc_version));
                if vanilla_json_path.exists() {
                    if let Ok(vanilla_str) = std::fs::read_to_string(&vanilla_json_path) {
                        if let Ok(base_json) = serde_json::from_str::<Value>(&vanilla_str) {
                            merged_json = Some(merge_version_json(&base_json, &lv_json, version_id));
                        }
                    }
                }
            }

            if merged_json.is_none() {
                // 无原版 JSON：直接用加载器 JSON
                let mut j = lv_json.clone();
                if let Some(obj) = j.as_object_mut() {
                    obj.remove("inheritsFrom");
                    obj.remove("_comment_");
                    obj.remove("jar");
                    obj.insert("id".to_string(), json!(version_id));
                    obj.insert("time".to_string(), json!(cf_shared::now_iso()));
                    obj.insert("releaseTime".to_string(), json!(cf_shared::now_iso()));
                }
                merged_json = Some(j);
            }

            // 补充 clientVersion
            if let Some(ref mut mj) = merged_json {
                if mj.get("clientVersion").is_none() && !mc_version.is_empty() {
                    if let Some(obj) = mj.as_object_mut() {
                        obj.insert("clientVersion".to_string(), json!(mc_version));
                    }
                }
            }
        }

        let version_json = merged_json.unwrap_or_else(|| {
            json!({
                "id": version_id,
                "type": "release",
                "time": cf_shared::now_iso(),
                "releaseTime": cf_shared::now_iso()
            })
        });

        // JVM 参数去重
        let version_json = dedup_jvm_args_in_json(version_json);

        // [CRITICAL] 直接写入 mergedJson，不能从文件重新读取
        let _ = std::fs::write(
            version_dir.join(format!("{}.json", version_id)),
            serde_json::to_string_pretty(&version_json).unwrap_or_default(),
        );

        // 复制主 jar 到版本目录
        // [关键修复] 必须检查 targetJar 是否存在且大小 > 0
        let vanilla_jar = versions_dir().join(mc_version).join(format!("{}.jar", mc_version));
        let target_jar = version_dir.join(format!("{}.jar", version_id));
        let mut need_copy = true;
        if target_jar.exists() {
            if let Ok(stat) = std::fs::metadata(&target_jar) {
                if stat.len() > 0 {
                    need_copy = false;
                }
            }
        }
        if need_copy && vanilla_jar.exists() {
            if let Err(e) = std::fs::copy(&vanilla_jar, &target_jar) {
                eprintln!("[mrpack] 复制版本jar失败: {}", e);
            } else if let Ok(stat) = std::fs::metadata(&vanilla_jar) {
                eprintln!(
                    "[mrpack] 已复制 vanilla client.jar 到版本目录: {}.jar ({} bytes)",
                    version_id,
                    stat.len()
                );
            }
        }

        // 删除加载器文件夹（libraries 已合并到版本 JSON）
        let loader_dir = versions_dir().join(lv_id);
        if loader_dir.exists() && loader_dir != version_dir {
            if let Err(e) = std::fs::remove_dir_all(&loader_dir) {
                eprintln!("[mrpack] 删除加载器文件夹失败: {}", e);
            }
        }
    } else {
        // 无加载器：创建简单版本 JSON
        let version_json = json!({
            "id": version_id,
            "inheritsFrom": if mc_version.is_empty() { Value::Null } else { json!(mc_version) },
            "type": "release",
            "mainClass": "net.minecraft.client.main.Main",
            "time": cf_shared::now_iso(),
            "releaseTime": cf_shared::now_iso()
        });
        let _ = std::fs::write(
            version_dir.join(format!("{}.json", version_id)),
            serde_json::to_string_pretty(&version_json).unwrap_or_default(),
        );
    }
}

/// 重新合并版本 JSON（existingJson 仍有 inheritsFrom 时）
pub(crate) fn remerge_version_json(
    version_json_path: &Path,
    version_id: &str,
    mc_version: &str,
    loader_version_id: &str,
) {
    let lv_json_path = versions_dir()
        .join(loader_version_id)
        .join(format!("{}.json", loader_version_id));
    if !lv_json_path.exists() {
        return;
    }

    let lv_json: Value = match std::fs::read_to_string(&lv_json_path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(json!({})),
        Err(_) => return,
    };

    let mut new_json: Option<Value> = None;

    if !mc_version.is_empty() {
        let vanilla_json_path = versions_dir().join(mc_version).join(format!("{}.json", mc_version));
        if vanilla_json_path.exists() {
            if let Ok(vanilla_str) = std::fs::read_to_string(&vanilla_json_path) {
                if let Ok(base_json) = serde_json::from_str::<Value>(&vanilla_str) {
                    new_json = Some(merge_version_json(&base_json, &lv_json, version_id));
                }
            }
        }
    }

    if new_json.is_none() {
        let mut j = lv_json.clone();
        if let Some(obj) = j.as_object_mut() {
            obj.remove("inheritsFrom");
            obj.remove("_comment_");
            obj.remove("jar");
            obj.insert("id".to_string(), json!(version_id));
            obj.insert("time".to_string(), json!(cf_shared::now_iso()));
            obj.insert("releaseTime".to_string(), json!(cf_shared::now_iso()));
        }
        new_json = Some(j);
    }

    if let Some(ref mut nj) = new_json {
        // 补充 clientVersion
        if nj.get("clientVersion").is_none() && !mc_version.is_empty() {
            if let Some(obj) = nj.as_object_mut() {
                obj.insert("clientVersion".to_string(), json!(mc_version));
            }
        }
        // JVM 参数去重
        let nj_dedup = dedup_jvm_args_in_json(nj.clone());
        *nj = nj_dedup;
        let _ = std::fs::write(
            version_json_path,
            serde_json::to_string_pretty(nj).unwrap_or_default(),
        );
    }
}

/// 创建 fallback 版本 JSON
pub(crate) fn create_fallback_version_json(
    version_id: &str,
    version_dir: &Path,
    mc_version: &str,
    loader_version_id: Option<&str>,
) {
    let mut fallback_json = json!({
        "id": version_id,
        "type": "release",
        "mainClass": "net.minecraft.client.main.Main",
        "time": cf_shared::now_iso(),
        "releaseTime": cf_shared::now_iso()
    });

    if let Some(lv_id) = loader_version_id {
        if !mc_version.is_empty() {
            let lv_p = versions_dir().join(lv_id).join(format!("{}.json", lv_id));
            if lv_p.exists() {
                if let Ok(lv_str) = std::fs::read_to_string(&lv_p) {
                    if let Ok(lv_j) = serde_json::from_str::<Value>(&lv_str) {
                        let vanilla_json_path = versions_dir().join(mc_version).join(format!("{}.json", mc_version));
                        let base_json: Option<Value> = std::fs::read_to_string(&vanilla_json_path)
                            .ok()
                            .and_then(|s| serde_json::from_str(&s).ok());
                        if let Some(base) = base_json {
                            fallback_json = merge_version_json(&base, &lv_j, version_id);
                        } else {
                            let mut j = lv_j;
                            if let Some(obj) = j.as_object_mut() {
                                obj.remove("inheritsFrom");
                                obj.remove("_comment_");
                                obj.remove("jar");
                                obj.insert("id".to_string(), json!(version_id));
                                obj.insert("time".to_string(), json!(cf_shared::now_iso()));
                                obj.insert("releaseTime".to_string(), json!(cf_shared::now_iso()));
                            }
                            fallback_json = j;
                        }
                        // 补充 clientVersion
                        if let Some(obj) = fallback_json.as_object_mut() {
                            if obj.get("clientVersion").is_none() {
                                obj.insert("clientVersion".to_string(), json!(mc_version));
                            }
                        }
                    }
                }
            }
        }
    }

    let fallback_json = dedup_jvm_args_in_json(fallback_json);
    let _ = std::fs::write(
        version_dir.join(format!("{}.json", version_id)),
        serde_json::to_string_pretty(&fallback_json).unwrap_or_default(),
    );
}

// ============== mergeVersionJson ==============
// 将加载器 JSON 合并到原版 JSON 之上

/// 合并版本 JSON：baseJson（原版）+ loaderJson（加载器）→ merged
///
/// 逻辑：
/// 1. 以 baseJson 为基础
/// 2. libraries: loaderLibs 在前，vanillaLibs 在后去重
///    - 同名库但 vanilla 含 natives/classifiers 且 existing 不含 → 替换
/// 3. arguments: 合并 game + jvm（--add-opens 等多值标志展开后去重）
/// 4. 其他字段：loaderJson 覆盖（空对象不覆盖非空对象）
/// 5. 删除 inheritsFrom、_comment_、jar
/// 6. 设置 id、time、releaseTime
pub(crate) fn merge_version_json(base_json: &Value, loader_json: &Value, version_id: &str) -> Value {
    let mut merged = base_json.clone();
    // 确保是对象类型，避免 unwrap_or(&mut Map::new()) 的临时值生命周期问题
    if !merged.is_object() {
        merged = json!({});
    }
    let merged_obj = merged.as_object_mut().expect("已确保为对象");

    let vanilla_libs = base_json
        .get("libraries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let loader_libs = loader_json
        .get("libraries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 收集 loaderLibs 的 name → bool
    let mut seen_names: HashSet<String> = HashSet::new();
    for lib in &loader_libs {
        if let Some(name) = lib.get("name").and_then(|v| v.as_str()) {
            seen_names.insert(name.to_string());
        }
    }

    // 收集 loaderLibs 中含 natives/classifiers 的库名
    let mut names_with_natives: HashSet<String> = HashSet::new();
    for lib in &loader_libs {
        if let Some(name) = lib.get("name").and_then(|v| v.as_str()) {
            let has_natives = lib.get("natives").is_some()
                || lib
                    .get("downloads")
                    .and_then(|d| d.get("classifiers"))
                    .is_some();
            if has_natives {
                names_with_natives.insert(name.to_string());
            }
        }
    }

    // mergedLibs = [...loaderLibs]
    let mut merged_libs: Vec<Value> = loader_libs.clone();

    // 遍历 vanillaLibs，去重添加
    for vl in &vanilla_libs {
        let vl_name = match vl.get("name").and_then(|v| v.as_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let vl_has_natives = vl.get("natives").is_some()
            || vl
                .get("downloads")
                .and_then(|d| d.get("classifiers"))
                .is_some();

        if !seen_names.contains(&vl_name) {
            // 新库：直接添加
            merged_libs.push(vl.clone());
            seen_names.insert(vl_name.clone());
            if vl_has_natives {
                names_with_natives.insert(vl_name);
            }
        } else if vl_has_natives && !names_with_natives.contains(&vl_name) {
            // 同名库但含 natives/classifiers，且现有同名条目不含 natives：替换
            if let Some(pos) = merged_libs.iter().position(|l| {
                l.get("name").and_then(|v| v.as_str()) == Some(&vl_name)
            }) {
                merged_libs[pos] = vl.clone();
            } else {
                merged_libs.push(vl.clone());
            }
            names_with_natives.insert(vl_name);
        }
        // 否则（已有同名带 natives 的条目）：跳过，避免重复
    }

    merged_obj.insert("libraries".to_string(), json!(merged_libs));

    // 遍历 loaderJson 的其他字段
    if let Some(loader_obj) = loader_json.as_object() {
        for (key, loader_val) in loader_obj {
            if key == "libraries" || key == "inheritsFrom" || key == "jar" {
                continue;
            }

            if key == "arguments" && loader_val.get("arguments").is_some() && base_json.get("arguments").is_some() {
                // arguments 合并：game + jvm
                let base_args = base_json.get("arguments").unwrap();
                let loader_args = loader_val;

                // 合并 game 参数（去重）
                let mut merged_game: Vec<Value> = base_args
                    .get("game")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let loader_game = loader_args
                    .get("game")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                for ge in &loader_game {
                    let ge_str = value_to_arg_string(ge);
                    let exists = merged_game.iter().any(|mg| value_to_arg_string(mg) == ge_str);
                    if !exists {
                        merged_game.push(ge.clone());
                    }
                }

                // 展开 loader jvm 中的 --add-opens 等多值标志
                let loader_jvm = loader_args
                    .get("jvm")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let expanded_loader_jvm = expand_multi_value_flags(&loader_jvm);

                // 合并 jvm 参数：以“flag+值”成对为单位去重，避免把同名成对 flag(如 --add-opens)折叠
                let mut merged_jvm: Vec<Value> = base_args
                    .get("jvm")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                {
                    let base_groups = group_jvm_tokens(&merged_jvm);
                    for g in group_jvm_tokens(&expanded_loader_jvm) {
                        let same: Vec<String> = g.iter().map(value_to_arg_string).collect();
                        let exists = base_groups.iter().any(|bg| {
                            bg.iter().map(value_to_arg_string).collect::<Vec<String>>() == same
                        });
                        if !exists {
                            for it in &g {
                                merged_jvm.push(it.clone());
                            }
                        }
                    }
                }

                let mut args_obj = Map::new();
                args_obj.insert("game".to_string(), json!(merged_game));
                args_obj.insert("jvm".to_string(), json!(merged_jvm));
                merged_obj.insert("arguments".to_string(), json!(args_obj));
            } else {
                // 跳过空对象（如果 base 有非空对象）
                let is_empty_obj = loader_val.is_object()
                    && !loader_val.is_array()
                    && loader_val.as_object().map(|o| o.is_empty()).unwrap_or(false);
                let base_non_empty = base_json
                    .get(key)
                    .map(|v| {
                        v.is_object()
                            && !v.is_array()
                            && v.as_object().map(|o| !o.is_empty()).unwrap_or(false)
                    })
                    .unwrap_or(false);
                if is_empty_obj && base_non_empty {
                    continue;
                }
                merged_obj.insert(key.clone(), loader_val.clone());
            }
        }
    }

    // 删除 inheritsFrom、_comment_、jar
    merged_obj.remove("inheritsFrom");
    merged_obj.remove("_comment_");
    merged_obj.remove("jar");

    // 设置 id、time、releaseTime
    merged_obj.insert("id".to_string(), json!(version_id));
    merged_obj.insert("time".to_string(), json!(cf_shared::now_iso()));
    merged_obj.insert("releaseTime".to_string(), json!(cf_shared::now_iso()));

    merged
}

/// 将 Value 转换为参数字符串（用于比较）
/// 字符串直接返回，非字符串序列化为 JSON
pub(crate) fn value_to_arg_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        _ => v.to_string(),
    }
}

/// 展开多值标志（--add-opens/--add-exports/--add-reads/--add-modules）
/// 对应 modrinth.js mergeVersionJson 中的 expandedLoaderJvm 逻辑
pub(crate) fn expand_multi_value_flags(args: &[Value]) -> Vec<Value> {
    let multi_value_flags = ["--add-opens", "--add-exports", "--add-reads", "--add-modules"];
    let mut expanded: Vec<Value> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let arg = &args[i];
        let is_multi = arg
            .as_str()
            .map(|s| multi_value_flags.contains(&s))
            .unwrap_or(false);
        if is_multi {
            let mut values: Vec<Value> = Vec::new();
            while i + 1 < args.len() {
                if let Some(next) = args[i + 1].as_str() {
                    if !next.starts_with('-') {
                        i += 1;
                        values.push(args[i].clone());
                        continue;
                    }
                }
                break;
            }
            if values.is_empty() {
                expanded.push(arg.clone());
            } else {
                for val in &values {
                    expanded.push(arg.clone());
                    expanded.push(val.clone());
                }
            }
        } else {
            expanded.push(arg.clone());
        }
        i += 1;
    }
    expanded
}

// ============== deduplicateJvmArgs ==============

/// 把参数数组按“flag + 紧随其后的非 - 值”分组。
/// 用于保证 --add-opens/--add-exports 等成对参数在合并去重时不会把 flag 单独折叠掉，
/// 避免 flag 与值数量错配（漏掉成对 flag）。
pub(crate) fn group_jvm_tokens(args: &[Value]) -> Vec<Vec<Value>> {
    let mut groups: Vec<Vec<Value>> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let cur = &args[i];
        if let Some(s) = cur.as_str() {
            if s.starts_with('-') {
                // flag：收集其后紧邻的非 '-' 值，作为一个成对组
                let mut group: Vec<Value> = vec![cur.clone()];
                let mut j = i + 1;
                while j < args.len() {
                    if let Some(ns) = args[j].as_str() {
                        if !ns.starts_with('-') {
                            group.push(args[j].clone());
                            j += 1;
                            continue;
                        }
                    }
                    break;
                }
                groups.push(group);
                i = j;
            } else {
                groups.push(vec![cur.clone()]);
                i += 1;
            }
        } else {
            groups.push(vec![cur.clone()]);
            i += 1;
        }
    }
    groups
}

/// JVM 参数去重：先展开多值标志（--add-opens 等），再去重 -D/-X/-XX 开头的重复参数
pub(crate) fn deduplicate_jvm_args(args: &[Value]) -> Vec<Value> {
    if args.is_empty() {
        return Vec::new();
    }

    // 先展开多值标志
    let expanded = expand_multi_value_flags(args);

    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<Value> = Vec::new();

    for arg in &expanded {
        match arg {
            Value::String(s) => {
                if s.starts_with("-D") || s.starts_with("-X") || s.starts_with("-XX") {
                    if seen.contains(s) {
                        continue;
                    }
                    seen.insert(s.clone());
                    result.push(arg.clone());
                } else {
                    result.push(arg.clone());
                }
            }
            _ => {
                result.push(arg.clone());
            }
        }
    }

    result
}

/// 对版本 JSON 中的 arguments.jvm 进行去重
pub(crate) fn dedup_jvm_args_in_json(mut json: Value) -> Value {
    if let Some(jvm) = json
        .get("arguments")
        .and_then(|a| a.get("jvm"))
        .and_then(|v| v.as_array())
        .cloned()
    {
        let deduped = deduplicate_jvm_args(&jvm);
        if let Some(args) = json.get_mut("arguments").and_then(|a| a.as_object_mut()) {
            args.insert("jvm".to_string(), json!(deduped));
        }
    }
    json
}

// ============== overrides 解压 ==============
