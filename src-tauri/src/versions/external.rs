// versions/external.rs — 外部游戏文件夹与版本目录定位
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::storage;
use crate::utils;

use super::scan::scan_versions_in_dir;


/// 清洗外部版本标记 "xxx [外部N]" → "xxx"
pub(crate) fn clean_external_marker(version_id: &str) -> String {
    if let Some(idx) = version_id.find(" [外部") {
        version_id[..idx].to_string()
    } else if let Some(idx) = version_id.find("[外部") {
        version_id[..idx].trim_end().to_string()
    } else {
        version_id.to_string()
    }
}

/// 判断版本是否属于某个外部文件夹
/// 不依赖 " [外部N]" 后缀：只要该版本 ID 在 external-folders.json 的任一
/// 外部文件夹下存在版本目录，就判定为外部版本。
pub(crate) fn resolve_external_version_dir(version_id: &str) -> Option<String> {
    let folders = storage::load_external_folders();
    let clean_id = clean_external_marker(version_id);
    for folder in &folders {
        let path_str = utils::get_str(folder, "path");
        if path_str.is_empty() {
            continue;
        }
        let folder_path = PathBuf::from(&path_str);
        if !folder_path.exists() {
            continue;
        }
        // 检查 versions/<clean_id> 子目录
        let ver_dir = folder_path.join("versions").join(&clean_id);
        if ver_dir.is_dir() {
            return Some(ver_dir.to_string_lossy().to_string());
        }
        // 检查直接以版本 ID 命名的子目录
        let direct_dir = folder_path.join(&clean_id);
        if direct_dir.is_dir() {
            return Some(direct_dir.to_string_lossy().to_string());
        }
    }
    None
}

/// 是否外部版本（通过 external-folders 配置匹配，而非仅看 id 后缀）
pub(crate) fn is_external_version(version_id: &str) -> bool {
    resolve_external_version_dir(version_id).is_some()
}

/// 获取版本的游戏目录（考虑隔离）
pub(crate) fn get_version_game_dir(version_id: &str, is_external: bool) -> PathBuf {
    let settings = storage::load_settings();
    let version_isolation = settings.get("versionIsolation").and_then(|v| v.as_bool()).unwrap_or(true);

    let data_dir = storage::resolve_data_dir();
    let versions_dir = data_dir.join("versions");

    if is_external {
        // 外部版本：在外部文件夹的 versions/<id> 下
        // 简化：直接用 versions_dir/<id>
        versions_dir.join(version_id)
    } else if version_isolation {
        versions_dir.join(version_id)
    } else {
        // 不隔离：用全局 gameDir
        let game_dir = utils::get_str(&settings, "gameDir");
        if game_dir.is_empty() {
            default_minecraft_dir(data_dir.clone())
        } else {
            PathBuf::from(game_dir)
        }
    }
}

/// 平台默认的 .minecraft 目录（macOS 使用 Application Support）
pub(crate) fn default_minecraft_dir(fallback: PathBuf) -> PathBuf {
    storage::default_minecraft_dir(fallback)
}

/// 跨驱动器深度扫描，找出包含 versions 子目录的 Minecraft 版本文件夹
/// （用于"一键识别版本文件夹"，返回候选列表供前端逐个添加）
pub(crate) fn auto_detect_external_folders() -> Vec<Value> {
    let mut found: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // 常见默认位置直接检查（避免漏掉 AppData 深层目录，默认 .minecraft 在 %APPDATA%）
    for var in ["APPDATA", "LOCALAPPDATA", "USERPROFILE"] {
        if let Ok(base) = std::env::var(var) {
            let p = PathBuf::from(&base).join(".minecraft");
            if p.join("versions").is_dir() {
                let s = p.to_string_lossy().to_string();
                if seen.insert(s.clone()) {
                    found.push(s);
                }
            }
        }
    }
    // macOS/Linux 默认目录
    if let Some(home) = dirs::home_dir() {
        #[cfg(target_os = "macos")]
        let candidates = vec![home
            .join("Library")
            .join("Application Support")
            .join("minecraft")];
        #[cfg(not(target_os = "macos"))]
        let candidates = vec![home.join(".minecraft"), home.join(".local").join("share").join("minecraft")];
        for p in candidates {
            if p.join("versions").is_dir() {
                let s = p.to_string_lossy().to_string();
                if seen.insert(s.clone()) {
                    found.push(s);
                }
            }
        }
    }

    // Windows 驱动器枚举 A:\..Z:\；macOS 扫描挂载卷；Linux 扫描常见挂载点
    #[cfg(target_os = "windows")]
    let roots: Vec<String> = (b'A'..=b'Z').map(|c| format!("{}:\\", c as char)).collect();
    #[cfg(target_os = "macos")]
    let roots: Vec<String> = vec!["/Volumes".to_string()];
    #[cfg(target_os = "linux")]
    let roots: Vec<String> = vec![
        "/home".to_string(),
        "/mnt".to_string(),
        "/media".to_string(),
    ];
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let roots: Vec<String> = Vec::new();

    // 需要跳过的系统级/无关大目录，避免扫描过慢
    fn is_skip(name: &str) -> bool {
        let lower = name.to_lowercase();
        lower == "windows"
            || lower == "$recycle.bin"
            || lower == "system volume information"
            || lower == "program files"
            || lower == "program files (x86)"
            || lower == "programdata"
            || lower == "appdata"
            || lower == "node_modules"
            || lower == ".git"
            || lower == ".cache"
            || lower == "recovery"
            || lower == "perflogs"
            || lower == "config.msi"
            || lower == "msocache"
            || lower == "intel"
            || lower == "amd"
            || lower == "nvidia"
            || lower == "drivers"
            || lower == "python"
            || lower == "anaconda"
            || lower == "miniconda"
            || lower == "golang"
            || lower == "rustup"
            || lower == ".cargo"
            || lower == ".npm"
            || lower == ".yarn"
            || lower == "tmp"
            || lower == "temp"
            || lower == "winnt"
            || lower == "boot"
            || lower == "sources"
            || lower == "installer"
            || lower == "msbuild"
            || lower == "common files"
            || lower == "dotnet"
            || lower == "uninstall information"
            || lower == "oracle"
            || lower == "vmware"
            || lower == "docker"
            || lower == "xampp"
            || lower == "wamp64"
            || lower == "llvm"
            || lower == "qt"
            || lower == "cmake"
            || lower == "vcpkg"
            || lower == "nuget"
            || lower == "packages"
            || lower == "references"
            || lower == "assemblies"
            || lower == "microsoft"
            || lower == "microsoft.net"
            || lower == "microsoft shared"
            || lower == "microsoft sdks"
            || lower == "microsoft analysis services"
            || lower == "adobe"
            || lower == "google"
            || lower == "mozilla"
            || lower == "apple"
            || lower == "steam"
            || lower == "epic games"
            || lower == "wps office"
            || lower == "kingsoft"
            || lower == "tencent"
            || lower == "qq"
            || lower == "wechat"
            || lower == "baidu"
            || lower == "aliyun"
            || lower == "alibaba"
            || lower == "jdk"
            || lower == "jre"
            || lower == "gradle"
            || lower == "maven"
            || lower == "ruby"
            || lower == "perl"
            || lower == ".thumbnails"
            || lower == ".trash"
            || lower == ".local"
            || lower == ".config"
            || lower == ".flatpak"
            || lower == "snap"
    }

    // 在单个目录下做有限深度搜索：本目录含 versions 子目录即为命中，否则继续向下
    fn scan(dir: &Path, depth: usize, max_depth: usize, found: &mut Vec<String>, skip_names: &[&str]) {
        if depth > max_depth {
            return;
        }
        if dir.join("versions").is_dir() {
            found.push(dir.to_string_lossy().to_string());
            return; // 命中后不再深入，避免嵌套游戏目录重复
        }
        // 检查目录名本身是否应跳过（根目录级）
        let dir_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !dir_name.is_empty() && skip_names.contains(&dir_name) {
            return;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let ft = match entry.file_type() {
                    Ok(t) => t,
                    Err(_) => continue,
                };
                if !ft.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if is_skip(&name) {
                    continue;
                }
                scan(&entry.path(), depth + 1, max_depth, found, skip_names);
            }
        }
    }

    // 根目录跳过列表（避免扫描整个系统盘根目录级大目录）
    let root_skip: &[&str] = &[
        "Windows", "Program Files", "Program Files (x86)", "ProgramData",
        "System Volume Information", "$Recycle.Bin", "Recovery", "Boot",
        "PerfLogs", "Documents and Settings", "DRIVERS", "Intel", "AMD",
        "MSOCache", "Config.Msi", "Temp", "tmp",
    ];

    for root in roots {
        let root_path = PathBuf::from(&root);
        if !root_path.exists() {
            continue;
        }
        // 跳过空驱动器（如软驱、光驱无盘）
        if std::fs::read_dir(&root_path).is_err() {
            continue;
        }
        scan(&root_path, 0, 3, &mut found, root_skip);
    }

    // 去重并转 JSON
    let mut result: Vec<Value> = Vec::new();
    for path_str in found {
        let path = PathBuf::from(&path_str);
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("外部")
            .to_string();
        let version_count =
            scan_versions_in_dir(&path.join("versions"), true, Some(&path)).len() as u64;
        result.push(json!({
            "path": path_str,
            "name": name,
            "versionCount": version_count
        }));
    }
    result
}
