// api/system_jvm.rs — JVM 预热、CDS 归档与启动参数优化
use serde_json::{json, Value};
use std::path::Path;

use super::ApiResult;
use super::get_system_memory_kb;
use crate::storage;

// ============== JVM 相关功能 ==============

/// 读取 Java 主版本号
fn get_java_major_version(java_path: &str) -> u32 {
    if java_path.is_empty() || !Path::new(java_path).exists() {
        return 0;
    }
    // 先读 release 文件（快）
    let java_home = Path::new(java_path)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());
    if let Some(home) = java_home {
        let release = home.join("release");
        if let Ok(content) = std::fs::read_to_string(&release) {
            for line in content.lines() {
                if let Some(v) = line.strip_prefix("JAVA_VERSION=") {
                    let v = v.trim_matches('"');
                    if let Some(first) = v.split('.').next() {
                        if first == "1" {
                            return v.split('.').nth(1)
                                .and_then(|s| s.parse().ok())
                                .unwrap_or(0);
                        }
                        return first.parse().unwrap_or(0);
                    }
                }
            }
        }
    }
    // 回退：执行 java -version
    #[cfg(target_os = "windows")]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new(java_path);
        c.arg("-version");
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = std::process::Command::new(java_path);
        c.arg("-version");
        c
    };
    if let Ok(out) = cmd.output()
    {
        let text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&out.stderr),
            String::from_utf8_lossy(&out.stdout)
        );
        for line in text.lines() {
            if line.contains("version")
                && let Some(start) = line.find('"')
                    && let Some(end) = line[start + 1..].find('"') {
                        let v = &line[start + 1..start + 1 + end];
                        if let Some(first) = v.split('.').next() {
                            if first == "1" {
                                return v.split('.').nth(1)
                                    .and_then(|s| s.parse().ok())
                                    .unwrap_or(0);
                            }
                            return first.parse().unwrap_or(0);
                        }
                    }
        }
    }
    0
}

/// POST /api/jvm/preheat — 预热 JVM 以加速首次启动
/// 启动一个短生命周期的 Java 进程加载核心类
pub(super) fn handle_jvm_preheat(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let java_path = crate::utils::get_str(&data, "javaPath").to_string();
    let max_mem_mb = data.get("maxMemMB")
        .and_then(|v| v.as_u64())
        .unwrap_or(1024) as u32;

    if java_path.is_empty() || !Path::new(&java_path).exists() {
        return ApiResult::ok(json!({
            "success": false,
            "error": "Java 路径不存在"
        }));
    }

    // 异步启动预热进程（不阻塞响应）
    let java_path_owned = java_path.clone();
    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        let mut cmd = {
            use std::os::windows::process::CommandExt;
            let mut c = std::process::Command::new(&java_path_owned);
            c.args([
                "-Xmx".to_string() + &max_mem_mb.to_string() + "m",
                "-version".to_string(),
            ]);
            c.creation_flags(0x08000000);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = std::process::Command::new(&java_path_owned);
            c.args([
                "-Xmx".to_string() + &max_mem_mb.to_string() + "m",
                "-version".to_string(),
            ]);
            c
        };
        let result = cmd
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        if let Ok(mut child) = result {
            // 等 2 秒让 JVM 加载核心类
            std::thread::sleep(std::time::Duration::from_secs(2));
            let _ = child.kill();
        }
    });

    ApiResult::ok(json!({ "success": true }))
}

/// POST /api/jvm/generate-cds — 为指定版本生成 CDS 类共享归档
pub(super) fn handle_jvm_generate_cds(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let version_id = crate::utils::get_str(&data, "versionId").to_string();
    if version_id.is_empty() {
        return ApiResult::ok(json!({
            "success": false,
            "error": "缺少 versionId 参数"
        }));
    }

    let data_dir = storage::resolve_data_dir();
    let cds_dir = data_dir.join("cds");
    if let Err(e) = std::fs::create_dir_all(&cds_dir) {
        return ApiResult::ok(json!({
            "success": false,
            "error": format!("无法创建 CDS 目录: {}", e)
        }));
    }

    let cds_archive = cds_dir.join(format!("{}.jsa", version_id));

    // 读取版本 JSON 找 Java 路径
    let versions_dir = data_dir.join("versions");
    let version_json_path = versions_dir.join(&version_id).join(format!("{}.json", version_id));
    let version_json: Value = match std::fs::read_to_string(&version_json_path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(v) => v,
            Err(_) => return ApiResult::ok(json!({
                "success": false,
                "error": "版本 JSON 损坏"
            })),
        },
        Err(_) => return ApiResult::ok(json!({
            "success": false,
            "error": "版本 JSON 缺失"
        })),
    };

    let settings = storage::load_settings();
    let java_path = crate::launch::dep_check::select_java_for_version(
        &version_id,
        &settings,
        &version_json,
    );

    if java_path.is_empty() || !Path::new(&java_path).exists() {
        return ApiResult::ok(json!({
            "success": false,
            "error": "Java 未找到"
        }));
    }

    let major_ver = get_java_major_version(&java_path);
    if major_ver < 8 {
        return ApiResult::ok(json!({
            "success": false,
            "error": "CDS 需要 Java 8 或以上版本"
        }));
    }

    // 优先复用 JDK 自带的默认归档
    let java_home = Path::new(&java_path)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());
    if let Some(home) = java_home {
        let default_jsa = home.join("lib").join("server").join("classes.jsa");
        if default_jsa.exists()
            && std::fs::copy(&default_jsa, &cds_archive).is_ok() {
                return ApiResult::ok(json!({
                    "success": true,
                    "archive": cds_archive.to_string_lossy(),
                    "source": "default"
                }));
            }
    }

    // 调用 java -Xshare:dump 生成归档
    let archive_arg = format!("-XX:SharedArchiveFile={}", cds_archive.display());
    #[cfg(target_os = "windows")]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new(&java_path);
        c.args(["-Xshare:dump", &archive_arg]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = std::process::Command::new(&java_path);
        c.args(["-Xshare:dump", &archive_arg]);
        c
    };
    let output = cmd
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    match output {
        Ok(out) => {
            if cds_archive.exists()
                && let Ok(meta) = std::fs::metadata(&cds_archive)
                    && meta.len() > 1024 {
                        return ApiResult::ok(json!({
                            "success": true,
                            "archive": cds_archive.to_string_lossy(),
                            "source": "generated",
                            "sizeKB": meta.len() / 1024
                        }));
                    }
            let err_msg = String::from_utf8_lossy(&out.stderr);
            ApiResult::ok(json!({
                "success": false,
                "error": err_msg.chars().take(300).collect::<String>()
            }))
        }
        Err(e) => ApiResult::ok(json!({
            "success": false,
            "error": format!("执行失败: {}", e)
        })),
    }
}

/// GET /api/jvm/cds-status — 查询指定版本的 CDS 归档状态
pub(super) fn handle_jvm_cds_status(params: &Option<Value>) -> ApiResult {
    let version_id = params
        .as_ref()
        .and_then(|p| p.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if version_id.is_empty() {
        return ApiResult::ok(json!({ "available": false }));
    }

    let archive = storage::resolve_data_dir()
        .join("cds")
        .join(format!("{}.jsa", version_id));

    if archive.exists()
        && let Ok(meta) = std::fs::metadata(&archive) {
            return ApiResult::ok(json!({
                "available": true,
                "archive": archive.to_string_lossy(),
                "sizeKB": meta.len() / 1024,
                "modified": meta.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0)
            }));
        }

    ApiResult::ok(json!({ "available": false }))
}

/// GET /api/jvm/optimize-args — 根据内存与模组数量推算优化后的 JVM 启动参数
pub(super) fn handle_jvm_optimize_args(params: &Option<Value>) -> ApiResult {
    let version_id = params
        .as_ref()
        .and_then(|p| p.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if version_id.is_empty() {
        return ApiResult::err(400, "缺少 versionId 参数");
    }

    // 系统内存（KB → 字节）
    let (total_kb, avail_kb) = get_system_memory_kb();
    let total_mem_bytes = total_kb * 1024;
    let free_mem_bytes = avail_kb * 1024;
    let available_gb = free_mem_bytes as f64 / 1_073_741_824.0;

    // 统计 mods 目录下 jar 文件数量
    let version_dir = storage::resolve_data_dir().join("versions").join(version_id);
    let mods_dir = version_dir.join("mods");
    let mod_count: u32 = if mods_dir.exists() {
        std::fs::read_dir(&mods_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.file_type().map(|t| t.is_file()).unwrap_or(false)
                            && e.path()
                                .extension()
                                .and_then(|x| x.to_str())
                                .map(|x| x.eq_ignore_ascii_case("jar"))
                                .unwrap_or(false)
                    })
                    .count() as u32
            })
            .unwrap_or(0)
    } else {
        0
    };

    // 基于模组数量估算各档内存阈值
    let (t0, t1, t2, t3) = if mod_count > 0 {
        (
            0.5 + mod_count as f64 / 150.0,
            1.5 + mod_count as f64 / 90.0,
            2.7 + mod_count as f64 / 50.0,
            4.5 + mod_count as f64 / 25.0,
        )
    } else {
        (0.5, 1.5, 2.5, 4.0)
    };

    // 按梯度累加可分配内存
    let mut ram_give: f64 = 0.0;
    let mut ram_available = available_gb;

    let mut delta = t1;
    ram_give += ram_available.min(delta);
    ram_available -= delta;

    delta = t2 - t1;
    ram_give += (ram_available * 0.7).min(delta);
    ram_available -= delta / 0.7;

    delta = t3 - t2;
    ram_give += (ram_available * 0.4).min(delta);
    ram_available -= delta / 0.4;

    delta = t3;
    ram_give += (ram_available * 0.15).min(delta);

    ram_give = ram_give.max(t0);
    ram_give = (ram_give * 10.0).round() / 10.0;

    // 不超过系统总内存的 70%
    let max_gb = total_mem_bytes as f64 / 1_073_741_824.0 * 0.7;
    ram_give = ram_give.min(max_gb);

    let total_ram_mb = (ram_give * 1024.0).floor() as u32;
    let new_gen_mb = (total_ram_mb as f64 * 0.15).floor() as u32;

    let args = vec![
        format!("-Xmx{}m", total_ram_mb),
        format!("-Xmn{}m", new_gen_mb),
        "-XX:+UseG1GC".to_string(),
        "-XX:-UseAdaptiveSizePolicy".to_string(),
        "-XX:-OmitStackTraceInFastThrow".to_string(),
        "-Djdk.lang.Process.allowAmbiguousCommands=true".to_string(),
        "-Dfml.ignoreInvalidMinecraftCertificates=True".to_string(),
        "-Dfml.ignorePatchDiscrepancies=True".to_string(),
        "-Dlog4j2.formatMsgNoLookups=true".to_string(),
    ];

    ApiResult::ok(json!({
        "args": args.join(" "),
        "xmxMB": total_ram_mb,
        "xmnMB": new_gen_mb,
        "ramGB": ram_give,
        "modCount": mod_count,
        "totalMemGB": total_mem_bytes as f64 / 1_073_741_824.0,
        "freeMemGB": free_mem_bytes as f64 / 1_073_741_824.0
    }))
}
