// api/system.rs — 系统信息路由
// 路由清单：
//   GET /api/status                启动器运行状态
//   GET /api/system/memory         系统内存信息
//   GET /api/system/memory-info    内存使用占比概览
//   POST /api/jvm/preheat          预热 JVM（暂占位）
//   POST /api/jvm/generate-cds     生成 CDS 归档（暂占位）
//   GET /api/jvm/cds-status        CDS 状态（暂占位）
//   GET /api/jvm/optimize-args     优化 JVM 启动参数（暂占位）
//   POST /api/cleanup              执行清理任务，释放磁盘空间
//   GET /api/cleanup/scan          扫描可清理空间（不删除）
// 注：/api/java/* 路由在 java.rs 中实现，由 mod.rs 优先分发

use serde_json::{json, Value};
use std::path::Path;

use super::ApiResult;
use crate::storage;

#[path = "system_jvm.rs"]
mod system_jvm;

use system_jvm::{
    handle_jvm_cds_status, handle_jvm_generate_cds, handle_jvm_optimize_args, handle_jvm_preheat,
};

/// 获取系统总内存（KB），仅 Windows 实现简单版本
pub(crate) fn get_system_memory_kb() -> (u64, u64) {
    // Windows：用 GlobalMemoryStatusEx
    #[cfg(target_os = "windows")]
    {
        use std::mem::{size_of, zeroed};
        #[repr(C)]
        struct MemoryStatusEx {
            dw_length: u32,
            dw_memory_load: u32,
            ull_total_phys: u64,
            ull_avail_phys: u64,
            ull_total_page_file: u64,
            ull_avail_page_file: u64,
            ull_total_virtual: u64,
            ull_avail_virtual: u64,
            ull_avail_extended_virtual: u64,
        }
        unsafe extern "system" {
            fn GlobalMemoryStatusEx(lpBuffer: *mut MemoryStatusEx) -> i32;
        }
        unsafe {
            let mut status: MemoryStatusEx = zeroed();
            status.dw_length = size_of::<MemoryStatusEx>() as u32;
            if GlobalMemoryStatusEx(&mut status) != 0 {
                return (status.ull_total_phys, status.ull_avail_phys);
            }
        }
    }
    // Linux：读取 /proc/meminfo（单位 KB）
    #[cfg(target_os = "linux")]
    {
        if let Ok(raw) = std::fs::read_to_string("/proc/meminfo") {
            let mut total = 0u64;
            let mut avail = 0u64;
            for line in raw.lines() {
                let mut parts = line.split_whitespace();
                let key = parts.next().unwrap_or("");
                let value = parts.next().and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
                if key == "MemTotal:" {
                    total = value;
                } else if key == "MemAvailable:" {
                    avail = value;
                }
            }
            if total > 0 {
                // /proc/meminfo 单位是 KB，调用方按字节处理
                return (total.saturating_mul(1024), avail.saturating_mul(1024));
            }
        }
    }
    // macOS：sysctl 取总内存，vm_stat 取空闲/非活跃页
    #[cfg(target_os = "macos")]
    {
        let total_bytes = std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().ok())
            .unwrap_or(0);
        let avail_bytes = std::process::Command::new("vm_stat")
            .output()
            .ok()
            .map(|o| {
                let text = String::from_utf8_lossy(&o.stdout);
                let page_size = text
                    .split("page size of ")
                    .nth(1)
                    .and_then(|s| s.split_whitespace().next())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(4096);
                let mut free_pages = 0u64;
                for line in text.lines() {
                    if line.starts_with("Pages free:")
                        || line.starts_with("Pages inactive:")
                        || line.starts_with("Pages speculative:")
                    {
                        if let Some(v) = line
                            .split(':')
                            .nth(1)
                            .and_then(|s| s.trim().trim_end_matches('.').parse::<u64>().ok())
                        {
                            free_pages += v;
                        }
                    }
                }
                free_pages.saturating_mul(page_size)
            })
            .unwrap_or(0);
        if total_bytes > 0 {
            return (total_bytes, avail_bytes);
        }
    }
    (0, 0)
}

/// 计算自动推荐分配内存（MB）
/// 规则：总内存的 60%，但不超过 8192MB，不少于 1024MB
fn auto_memory_mb(total_mb: u64) -> u64 {
    if total_mb == 0 {
        return 2048;
    }
    let auto_mb = total_mb * 60 / 100;
    auto_mb.clamp(1024, 8192)
}

pub fn handle(method: &str, path: &str, params: &Option<Value>, body: &Option<Value>) -> Option<ApiResult> {
    let key = format!("{} {}", method.to_uppercase(), path);

    match key.as_str() {
        "GET /api/system/memory" => {
            let (total_bytes, avail_bytes) = get_system_memory_kb();
            // Windows 返回的是字节，按 1024 转换
            let free_bytes = avail_bytes;
            let total_mb = total_bytes / 1024 / 1024;
            let free_mb = free_bytes / 1024 / 1024;
            let used_mb = total_mb.saturating_sub(free_mb);
            let total_gb = total_mb / 1024;
            let free_gb = free_mb / 1024;
            let used_gb = used_mb / 1024;
            let auto_mb = auto_memory_mb(total_mb);
            let auto_gb = auto_mb / 1024;

            Some(ApiResult::ok(json!({
                "totalBytes": total_bytes,
                "freeBytes": free_bytes,
                "totalMB": total_mb,
                "freeMB": free_mb,
                "usedMB": used_mb,
                "totalGB": total_gb,
                "freeGB": free_gb,
                "usedGB": used_gb,
                "autoMB": auto_mb,
                "autoGB": auto_gb
            })))
        }

        "GET /api/system/memory-info" => {
            let (total_bytes, avail_bytes) = get_system_memory_kb();
            let total_mb = total_bytes / 1024 / 1024;
            let free_mb = avail_bytes / 1024 / 1024;
            let used_mb = total_mb.saturating_sub(free_mb);
            let usage_percent = (used_mb * 100).checked_div(total_mb).unwrap_or(0);
            Some(ApiResult::ok(json!({
                "totalMB": total_mb,
                "freeMB": free_mb,
                "usedMB": used_mb,
                "usagePercent": usage_percent,
                "loadPercent": usage_percent,
                "total": total_bytes,
                "used": total_bytes.saturating_sub(avail_bytes)
            })))
        }

        // 占位路由（后续逐步迁移）
        "GET /api/status" => Some(ApiResult::ok(json!({
            "running": true,
            "downloadEngine": "tauri-native",
            "version": "1.3.3-tauri"
        }))),

        "POST /api/jvm/preheat" => Some(handle_jvm_preheat(body)),

        "POST /api/jvm/generate-cds" => Some(handle_jvm_generate_cds(body)),

        "GET /api/jvm/cds-status" => Some(handle_jvm_cds_status(params)),

        "GET /api/jvm/optimize-args" => Some(handle_jvm_optimize_args(params)),

        "POST /api/cleanup" => Some(handle_cleanup()),

        // 前端 cleanupScan 通过 POST 调用，保持与 GET 等价（Electron 端为 GET）
        "GET /api/cleanup/scan" | "POST /api/cleanup/scan" => Some(handle_cleanup_scan()),

        "POST /api/memory-optimize" => Some(handle_memory_optimize()),

        _ => None,
    }
}

// ============== 内存优化 ==============

#[cfg(target_os = "windows")]
pub(crate) fn do_memory_optimize_purge() -> Result<(), String> {
    use std::ffi::c_void;

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn RtlAdjustPrivilege(
            privilege: u32,
            enable: i32,
            current_thread: i32,
            enabled: *mut i32,
        ) -> i32;
        fn NtSetSystemInformation(
            system_information_class: i32,
            system_information: *mut c_void,
            system_information_length: i32,
        ) -> i32;
    }

    const SE_INCREASE_QUOTA_PRIVILEGE: u32 = 5;
    const SE_PROFILE_SINGLE_PROCESS_PRIVILEGE: u32 = 13;
    const SYSTEM_MEMORY_LIST_INFORMATION: i32 = 80;
    const SYSTEM_FILE_CACHE_INFORMATION_EX: i32 = 81;
    const SYSTEM_COMBINE_PHYSICAL_MEMORY_INFORMATION: i32 = 130;
    const SYSTEM_REGISTRY_RECONCILIATION_INFORMATION: i32 = 155;

    unsafe {
        // 启用内存优化所需特权
        let mut enabled: i32 = 0;
        for privilege in [SE_INCREASE_QUOTA_PRIVILEGE, SE_PROFILE_SINGLE_PROCESS_PRIVILEGE] {
            let status = RtlAdjustPrivilege(privilege, 1, 0, &mut enabled);
            if status != 0 {
                return Err(format!("启用内存优化权限失败（错误代码：{}）", status));
            }
        }

        // 内存列表操作：清空工作集(2)、刷新修改列表(3)、清理待机列表(4)、清理低优先级待机列表(5)
        for op in [2i32, 3, 4, 5] {
            let op_bytes: [u8; 4] = op.to_ne_bytes();
            let status = NtSetSystemInformation(
                SYSTEM_MEMORY_LIST_INFORMATION,
                op_bytes.as_ptr() as *mut c_void,
                4,
            );
            if status != 0 {
                return Err(format!("内存优化操作 {} 失败（错误代码：{}）", op, status));
            }
        }

        // 刷新系统文件缓存（最小/最大工作集设为 SIZE_MAX 触发缓存收缩）
        #[repr(C)]
        #[derive(Default)]
        struct SystemFileCacheInformation {
            current_size: usize,
            peak_size: usize,
            page_fault_count: usize,
            minimum_working_set: usize,
            maximum_working_set: usize,
            current_size_including_transition_in_pages: usize,
            peak_size_including_transition_in_pages: usize,
            transition_re_purpose_count: usize,
            flags: usize,
        }
        let mut file_cache = SystemFileCacheInformation {
            minimum_working_set: usize::MAX,
            maximum_working_set: usize::MAX,
            ..Default::default()
        };
        let status = NtSetSystemInformation(
            SYSTEM_FILE_CACHE_INFORMATION_EX,
            &mut file_cache as *mut SystemFileCacheInformation as *mut c_void,
            std::mem::size_of::<SystemFileCacheInformation>() as i32,
        );
        if status != 0 {
            return Err(format!("刷新文件缓存失败（错误代码：{}）", status));
        }

        // 注册表内存对账
        let status = NtSetSystemInformation(
            SYSTEM_REGISTRY_RECONCILIATION_INFORMATION,
            std::ptr::null_mut(),
            0,
        );
        if status != 0 {
            return Err(format!("注册表内存对账失败（错误代码：{}）", status));
        }

        // 物理内存合并
        #[repr(C)]
        #[derive(Default)]
        struct MemoryCombineInformationEx {
            handle: *mut c_void,
            pages_combined: usize,
            flags: u32,
        }
        let mut combine = MemoryCombineInformationEx::default();
        let status = NtSetSystemInformation(
            SYSTEM_COMBINE_PHYSICAL_MEMORY_INFORMATION,
            &mut combine as *mut MemoryCombineInformationEx as *mut c_void,
            std::mem::size_of::<MemoryCombineInformationEx>() as i32,
        );
        if status != 0 {
            return Err(format!("合并物理内存失败（错误代码：{}）", status));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn do_memory_optimize_purge() -> Result<(), String> {
    Err("内存优化仅支持 Windows".to_string())
}

/// POST /api/memory-optimize — 执行内存优化
/// 已管理员则直接执行，否则通过提权子进程执行
fn handle_memory_optimize() -> ApiResult {
    let (_, before_avail) = get_system_memory_kb();
    let before_mb = before_avail / 1024 / 1024;

    match crate::promote::run_memory_optimize() {
        Ok(()) => {
            let (_, after_avail) = get_system_memory_kb();
            let after_mb = after_avail / 1024 / 1024;
            let freed_mb = after_mb.saturating_sub(before_mb);
            ApiResult::ok(json!({
                "success": true,
                "freedMB": freed_mb,
                "beforeMB": before_mb,
                "afterMB": after_mb
            }))
        }
        Err(e) => ApiResult::err(500, e.as_str()),
    }
}

// ============== 清理功能 ==============

/// 递归删除目录并统计释放字节数
fn safe_rm_dir(dir: &Path) -> u64 {
    if !dir.exists() {
        return 0;
    }
    let mut bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(meta) = entry.file_type() {
                if meta.is_dir() {
                    bytes += safe_rm_dir(&path);
                } else {
                    if let Ok(m) = std::fs::metadata(&path) {
                        bytes += m.len();
                    }
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
    let _ = std::fs::remove_dir(dir);
    bytes
}

/// 递归扫描目录占用字节数（不删除）
fn scan_dir_size(dir: &Path) -> u64 {
    if !dir.exists() {
        return 0;
    }
    let mut bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(meta) = entry.file_type() {
                if meta.is_dir() {
                    bytes += scan_dir_size(&path);
                } else if let Ok(m) = std::fs::metadata(&path) {
                    bytes += m.len();
                }
            }
        }
    }
    bytes
}

/// 清理各版本目录下的 logs / crash-reports / latest.log
fn clean_version_logs() -> u64 {
    let versions_dir = storage::resolve_data_dir().join("versions");
    if !versions_dir.exists() {
        return 0;
    }
    let mut bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(&versions_dir) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let version_dir = entry.path();
            for sub in &["logs", "crash-reports"] {
                let d = version_dir.join(sub);
                if d.exists() {
                    bytes += safe_rm_dir(&d);
                }
            }
            let mc_log = version_dir.join("latest.log");
            if mc_log.exists() {
                if let Ok(m) = std::fs::metadata(&mc_log) {
                    bytes += m.len();
                }
                let _ = std::fs::remove_file(&mc_log);
            }
        }
    }
    bytes
}

/// 清理临时目录
fn clean_temp_dir() -> u64 {
    let tmp = storage::resolve_data_dir().join("temp");
    if !tmp.exists() {
        return 0;
    }
    safe_rm_dir(&tmp)
}

/// 清理 natives 解压目录
fn clean_natives() -> u64 {
    let natives_dir = storage::resolve_data_dir().join("natives");
    if !natives_dir.exists() {
        return 0;
    }
    let mut bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(&natives_dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.file_type()
                && meta.is_dir() {
                    bytes += safe_rm_dir(&entry.path());
                }
        }
    }
    bytes
}

/// 清理图标缓存目录
fn clean_icon_cache() -> u64 {
    let icon_cache = storage::resolve_data_dir().join("icon-cache");
    if !icon_cache.exists() {
        return 0;
    }
    safe_rm_dir(&icon_cache)
}

/// 清理整合包缓存（.mrpack / .zip）
fn clean_modpack_cache() -> u64 {
    let settings = storage::load_settings();
    let game_dir = crate::utils::get_str(&settings, "gameDir");
    let base = if game_dir.is_empty() {
        storage::resolve_data_dir()
    } else {
        std::path::PathBuf::from(&game_dir)
    };
    let mp_dir = base.join("modpacks");
    if !mp_dir.exists() {
        return 0;
    }
    let mut bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(&mp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext = ext.to_lowercase();
                if ext == "mrpack" || ext == "zip" {
                    if let Ok(m) = std::fs::metadata(&path) {
                        bytes += m.len();
                    }
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
    bytes
}

/// 清理下载缓存目录（保留 .gitkeep）
fn clean_download_cache() -> u64 {
    let cache_dir = storage::resolve_data_dir().join("cache");
    if !cache_dir.exists() {
        return 0;
    }
    let mut bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.file_type()
                && meta.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name == ".gitkeep" {
                        continue;
                    }
                    let path = entry.path();
                    if let Ok(m) = std::fs::metadata(&path) {
                        bytes += m.len();
                    }
                    let _ = std::fs::remove_file(&path);
                }
        }
    }
    bytes
}

/// POST /api/cleanup — 执行清理任务，释放磁盘空间
fn handle_cleanup() -> ApiResult {
    let mut details = serde_json::Map::new();
    let game_logs = clean_version_logs();
    let temp_files = clean_temp_dir();
    let natives = clean_natives();
    let icon_cache = clean_icon_cache();
    let modpack_cache = clean_modpack_cache();
    let download_cache = clean_download_cache();

    details.insert("gameLogs".to_string(), json!(game_logs));
    details.insert("tempFiles".to_string(), json!(temp_files));
    details.insert("natives".to_string(), json!(natives));
    details.insert("iconCache".to_string(), json!(icon_cache));
    details.insert("modpackCache".to_string(), json!(modpack_cache));
    details.insert("downloadCache".to_string(), json!(download_cache));

    let total_bytes = game_logs + temp_files + natives + icon_cache + modpack_cache + download_cache;
    let total_mb = (total_bytes as f64 / (1024.0 * 1024.0) * 100.0).round() / 100.0;

    ApiResult::ok(json!({
        "success": true,
        "freedBytes": total_bytes,
        "freedMB": total_mb,
        "details": details,
        "message": format!("清理完成，释放 {} MB 空间", total_mb)
    }))
}

/// GET /api/cleanup/scan — 扫描可清理空间（不删除）
fn handle_cleanup_scan() -> ApiResult {
    let data_dir = storage::resolve_data_dir();
    let versions_dir = data_dir.join("versions");

    let mut details = serde_json::Map::new();

    // 各版本目录下的 logs / crash-reports
    if versions_dir.exists()
        && let Ok(entries) = std::fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let version_id = entry.file_name().to_string_lossy().to_string();
                for sub in &["logs", "crash-reports"] {
                    let d = entry.path().join(sub);
                    if d.exists() {
                        let size = scan_dir_size(&d);
                        if size > 0 {
                            details.insert(
                                format!("{}/{}", version_id, sub),
                                json!(size),
                            );
                        }
                    }
                }
            }
        }

    let temp_size = scan_dir_size(&data_dir.join("temp"));
    if temp_size > 0 {
        details.insert("temp".to_string(), json!(temp_size));
    }

    let natives_size = scan_dir_size(&data_dir.join("natives"));
    if natives_size > 0 {
        details.insert("natives".to_string(), json!(natives_size));
    }

    let icon_size = scan_dir_size(&data_dir.join("icon-cache"));
    if icon_size > 0 {
        details.insert("iconCache".to_string(), json!(icon_size));
    }

    let cache_size = scan_dir_size(&data_dir.join("cache"));
    if cache_size > 0 {
        details.insert("cache".to_string(), json!(cache_size));
    }

    // 整合包缓存
    let settings = storage::load_settings();
    let game_dir = crate::utils::get_str(&settings, "gameDir");
    let base = if game_dir.is_empty() {
        data_dir
    } else {
        std::path::PathBuf::from(&game_dir)
    };
    let mp_dir = base.join("modpacks");
    if mp_dir.exists() {
        let mut mp_total = 0u64;
        if let Ok(entries) = std::fs::read_dir(&mp_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext = ext.to_lowercase();
                    if (ext == "mrpack" || ext == "zip")
                        && let Ok(m) = std::fs::metadata(&path) {
                            mp_total += m.len();
                        }
                }
            }
        }
        if mp_total > 0 {
            details.insert("modpacks".to_string(), json!(mp_total));
        }
    }

    let total_bytes: u64 = details.values().filter_map(|v| v.as_u64()).sum();
    let total_mb = (total_bytes as f64 / (1024.0 * 1024.0) * 100.0).round() / 100.0;

    ApiResult::ok(json!({
        "success": true,
        "details": details,
        "totalBytes": total_bytes,
        "totalMB": total_mb
    }))
}
