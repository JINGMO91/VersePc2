// 原版与加载器版本 JSON 合并。
use serde_json::{json, Value};
use super::shared::jstr;

/// 将原版 JSON 与加载器 JSON 合并为单一独立版本 JSON。
/// 结果删除 inheritsFrom 与 jar，自含原版全部内容与加载器内容，id 替换为目标版本名。
pub(super) fn merge_version_json(vanilla: &Value, loader: &Value, output_id: &str) -> Value {
    let mut out = vanilla.clone();

    let _vanilla_libs: Vec<Value> = vanilla
        .get("libraries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let loader_libs: Vec<Value> = loader
        .get("libraries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 合并 libraries：以原版为底，追加加载器库，按 name 去重（name 在前者更优先）
    if let Some(arr) = out.get_mut("libraries").and_then(|v| v.as_array_mut()) {
        let mut existing: Vec<String> = arr
            .iter()
            .filter_map(|l| {
                let name = jstr(l, "name");
                if name.is_empty() { None } else { Some(name) }
            })
            .collect();
        for lib in &loader_libs {
            let name = jstr(lib, "name");
            if name.is_empty() {
                arr.push(lib.clone());
            } else if !existing.iter().any(|e| e == &name) {
                arr.push(lib.clone());
                existing.push(name);
            }
        }
    } else if let Some(obj) = out.as_object_mut() {
        obj.insert("libraries".to_string(), json!(loader_libs));
    }

    // 合并 minecraftArguments（旧格式参数）
    let vanilla_args = jstr(vanilla, "minecraftArguments");
    let loader_args = jstr(loader, "minecraftArguments");
    if !loader_args.is_empty() {
        let combined = if vanilla_args.is_empty() {
            loader_args
        } else {
            format!("{} {}", vanilla_args, loader_args)
        };
        out["minecraftArguments"] = json!(combined);
    }

    // 合并 arguments 对象中的数组字段（game / jvm），按值去重
    if let (Some(out_args), Some(ld_args)) = (
        out.get_mut("arguments").and_then(|v| v.as_object_mut()),
        loader.get("arguments").and_then(|v| v.as_object()),
    ) {
        for (k, v) in ld_args {
            if let Some(ld_arr) = v.as_array()
                && (k == "game" || k == "jvm") {
                    let existing = out_args
                        .get(k)
                        .and_then(|e| e.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let mut seen: Vec<String> = existing
                        .iter()
                        .filter_map(|i| i.as_str())
                        .map(|s| s.to_string())
                        .collect();
                    let mut merged = existing;
                    for item in ld_arr {
                        let s = item.as_str().map(|s| s.to_string()).unwrap_or_default();
                        if s.is_empty() {
                            merged.push(item.clone());
                        } else if !seen.iter().any(|x| x == &s) {
                            merged.push(item.clone());
                            seen.push(s);
                        }
                    }
                    out_args.insert(k.clone(), json!(merged));
                }
        }
    }

    // mainClass：加载器优先，否则保留原版
    let loader_main = jstr(loader, "mainClass");
    if !loader_main.is_empty() {
        out["mainClass"] = json!(loader_main);
    }

    // 清理与修正：删除继承字段，id 设为输出版本名
    if let Some(obj) = out.as_object_mut() {
        obj.remove("inheritsFrom");
        obj.remove("jar");
        obj.remove("_comment_");
        obj.insert("id".to_string(), json!(output_id));
        obj.insert("type".to_string(), json!("release"));
    }

    out
}
