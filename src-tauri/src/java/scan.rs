// scan.rs — 由 java.rs 拆分
#![allow(unused_imports)]

// Java 扫描：常见目录、注册表、子目录与候选路径
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use crate::modloaders::shared;
use crate::storage;
use crate::utils;
use super::*;

/// 扫描常见 Java 安装路径
pub(crate) fn scan_common_java_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut found: std::collections::HashSet<String> = std::collections::HashSet::new();

    /// 添加并去重（路径规范化为小写 + 正斜杠）
    fn add(paths: &mut Vec<PathBuf>, found: &mut std::collections::HashSet<String>, p: PathBuf) {
        if !p.exists() {
            return;
        }
        let key = p.to_string_lossy().to_lowercase().replace('\\', "/");
        if found.insert(key) {
            paths.push(p);
        }
    }

    // 1. JAVA_HOME / JDK_HOME 环境变量
    for var in &["JAVA_HOME", "JDK_HOME"] {
        if let Ok(home) = std::env::var(var) {
            let home = home.trim_matches(|c| c == '"' || c == '\\').to_string();
            if !home.is_empty() {
                let java_exe = PathBuf::from(&home).join("bin").join(java_bin_name());
                add(&mut paths, &mut found, java_exe);
            }
        }
    }

    // 2. PATH 环境变量逐个目录详细查找（不仅 where java，还会对含 java/jdk 关键字的 PATH 目录检查父级 bin/java）
    #[cfg(target_os = "windows")]
    if let Ok(path_env) = std::env::var("PATH") {
        let sep = if path_env.contains(';') { ';' } else { ':' };
        for dir in path_env.split(sep) {
            let trimmed = dir.trim().trim_matches('"');
            if trimmed.is_empty() {
                continue;
            }
            let dir_path = PathBuf::from(trimmed);
            // 直接查 PATH 目录下的 java.exe
            let direct = dir_path.join(java_bin_name());
            add(&mut paths, &mut found, direct);
            // 如果 PATH 目录名包含 java/jdk 关键字，很可能是 .../bin，父目录就是 javaHome
            let dir_lower = trimmed.to_lowercase();
            if (dir_lower.contains("java") || dir_lower.contains("jdk"))
                && let Some(parent) = dir_path.parent() {
                    let parent_java = PathBuf::from(parent).join("bin").join(java_bin_name());
                    add(&mut paths, &mut found, parent_java);
                }
        }
    }

    // 2b. 非 Windows：PATH 以冒号分隔，直接查找 java
    #[cfg(not(target_os = "windows"))]
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in path_env.split(':') {
            let trimmed = dir.trim();
            if trimmed.is_empty() {
                continue;
            }
            add(&mut paths, &mut found, PathBuf::from(trimmed).join(java_bin_name()));
        }
    }

    // 3. Program Files 下的常见 Java 目录
    if let Ok(pf) = std::env::var("ProgramFiles") {
        scan_java_subdirs(&pf, &mut paths, &mut found, add);
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        scan_java_subdirs(&pf86, &mut paths, &mut found, add);
    }

    // 4. AppData / LocalAppData：广义 2 层深度扫描（含任何 java/jdk 关键字的目录都能命中，不局限于特定启动器）
    if let Ok(appdata) = std::env::var("APPDATA") {
        scan_java_subdirs_depth(&PathBuf::from(&appdata), 2, &mut paths, &mut found, add);
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        scan_java_subdirs_depth(&PathBuf::from(&localappdata), 2, &mut paths, &mut found, add);

        // JetBrains JBR（整个 JetBrains 目录深搜，兼容 Toolbox 与其他安装方式）
        let jetbrains = PathBuf::from(&localappdata).join("JetBrains");
        if jetbrains.exists() {
            scan_java_subdirs_depth(&jetbrains, 3, &mut paths, &mut found, add);
        }
    }

    // 4. .minecraft/runtime（Minecraft 自带）— 用 APPDATA 而非 home_dir
    let appdata = std::env::var("APPDATA").ok();
    let localappdata = std::env::var("LOCALAPPDATA").ok();
    let userprofile = std::env::var("USERPROFILE").ok();

    if let Some(ref appdata) = appdata {
        let mc_runtime = PathBuf::from(appdata).join(".minecraft").join("runtime");
        if mc_runtime.exists() {
            scan_java_subdirs_depth(&mc_runtime, 3, &mut paths, &mut found, add);
        }
    }

    // 5. 用户目录：广义 2 层深度扫描（任何 java/jdk 关键字目录都会命中）
    if let Some(ref home) = userprofile {
        scan_java_subdirs_depth(&PathBuf::from(home), 2, &mut paths, &mut found, add);

        let user_java = PathBuf::from(home).join("Java");
        scan_java_subdirs(&user_java.to_string_lossy(), &mut paths, &mut found, add);
        let user_jdks = PathBuf::from(home).join(".jdks");
        scan_java_subdirs(&user_jdks.to_string_lossy(), &mut paths, &mut found, add);
        // scoop / sdkman
        let scoop = PathBuf::from(home).join("scoop").join("apps").join("openjdk");
        scan_java_subdirs_depth(&scoop, 3, &mut paths, &mut found, add);
        let sdkman = PathBuf::from(home).join(".sdkman").join("candidates").join("java");
        scan_java_subdirs_depth(&sdkman, 3, &mut paths, &mut found, add);
    }
    if let Some(ref appdata) = appdata {
        // HMCL 运行时
        let hmcl_rt = PathBuf::from(appdata).join(".hmcl").join("runtime");
        scan_java_subdirs_depth(&hmcl_rt, 3, &mut paths, &mut found, add);
        // HMCL Java 目录
        let hmcl_java = PathBuf::from(appdata).join(".hmcl").join("java");
        scan_java_subdirs_depth(&hmcl_java, 3, &mut paths, &mut found, add);
        // Prism Launcher 运行时
        let prism_java = PathBuf::from(appdata).join("PrismLauncher").join("java");
        scan_java_subdirs_depth(&prism_java, 3, &mut paths, &mut found, add);
        // Modrinth App 运行时
        let modrinth_java = PathBuf::from(appdata).join("ModrinthApp").join("meta").join("java_versions");
        scan_java_subdirs_depth(&modrinth_java, 3, &mut paths, &mut found, add);
        // ATLauncher 运行时
        let at_launcher = PathBuf::from(appdata).join("ATLauncher").join("runtimes").join("minecraft");
        scan_java_subdirs_depth(&at_launcher, 3, &mut paths, &mut found, add);
        // CurseForge 运行时（AppData 目录）
        let curseforge = PathBuf::from(appdata).join("curseforge").join("minecraft").join("Install").join("runtime");
        scan_java_subdirs_depth(&curseforge, 3, &mut paths, &mut found, add);
    }
    if let Some(ref userprofile) = userprofile {
        // CurseForge 运行时（用户目录）
        let curseforge_user = PathBuf::from(userprofile).join("curseforge").join("minecraft").join("Install").join("runtime");
        scan_java_subdirs_depth(&curseforge_user, 3, &mut paths, &mut found, add);
    }
    if let Some(ref localappdata) = localappdata {
        // BakaXL 运行时
        let bakaxl = PathBuf::from(localappdata).join("BakaXL").join("JavaRuntime");
        scan_java_subdirs_depth(&bakaxl, 3, &mut paths, &mut found, add);
        // FTB 运行时
        let ftba = PathBuf::from(localappdata).join(".ftba").join("bin").join("runtime");
        scan_java_subdirs_depth(&ftba, 3, &mut paths, &mut found, add);
        // Microsoft Store 版 Minecraft 自带 runtime
        let ms_base = PathBuf::from(localappdata)
            .join("Packages")
            .join("Microsoft.4297127D64EC6_8wekyb3d8bbwe")
            .join("LocalCache")
            .join("Local")
            .join("runtime");
        scan_java_subdirs_depth(&ms_base, 4, &mut paths, &mut found, add);
        // Microsoft Store 版本额外的特定子路径（gamma/gold 架构子目录）
        let ms_gamma = ms_base.join("java-runtime-gamma").join("windows-x64");
        scan_java_subdirs_depth(&ms_gamma, 3, &mut paths, &mut found, add);
        let ms_gold = ms_base.join("java-runtime-gold").join("windows-x64");
        scan_java_subdirs_depth(&ms_gold, 3, &mut paths, &mut found, add);
        // Programs 目录
        let programs = PathBuf::from(localappdata).join("Programs");
        scan_java_subdirs(&programs.to_string_lossy(), &mut paths, &mut found, add);
    }
    // Program Files 下的 Minecraft Launcher / Minecraft 运行时
    if let Ok(pf) = std::env::var("ProgramFiles") {
        let pf = PathBuf::from(pf);
        scan_java_subdirs_depth(&pf.join("Minecraft Launcher").join("runtime"), 3, &mut paths, &mut found, add);
        scan_java_subdirs_depth(&pf.join("Minecraft").join("runtime"), 3, &mut paths, &mut found, add);
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        let pf86 = PathBuf::from(pf86);
        scan_java_subdirs_depth(&pf86.join("Minecraft Launcher").join("runtime"), 3, &mut paths, &mut found, add);
        scan_java_subdirs_depth(&pf86.join("Minecraft").join("runtime"), 3, &mut paths, &mut found, add);
    }
    // 文档目录下的 CurseForge 运行时
    if let Some(ref home) = userprofile {
        let curse_docs = PathBuf::from(home).join("Documents").join("Curse").join("Minecraft").join("Install").join("runtime");
        scan_java_subdirs_depth(&curse_docs, 3, &mut paths, &mut found, add);
    }

    // 6. 启动器下载/自带的 Java（数据目录 java，兼容旧路径 ~/.versepc/java）
    let dl_java = storage::resolve_data_dir().join("java");
    scan_java_subdirs_depth(&dl_java, 3, &mut paths, &mut found, add);
    if let Some(ref home) = userprofile {
        let vrt = PathBuf::from(home).join(".versepc").join("java");
        scan_java_subdirs_depth(&vrt, 3, &mut paths, &mut found, add);
    }
    // 同时扫 jre 子目录（JDK 8 自带 jre）
    // scan_java_subdirs_depth 找到 bin/java.exe 后 continue 不再深入，
    // 这里对每个已找到的 jdk 目录补扫 jre/bin/java.exe
    let extra: Vec<PathBuf> = paths.iter()
        .filter_map(|p| p.parent().and_then(|b| b.parent()).map(|h| h.join("jre").join("bin").join(java_bin_name())))
        .collect();
    for e in extra {
        if e.exists() {
            add(&mut paths, &mut found, e);
        }
    }

    // 7. 盘符根目录下的常见 Java 目录（用户直接解压到盘根的情况）
    //    先用 wmic 枚举实际存在的盘符（避免漏了 I:、J: 等移动硬盘 / U 盘）
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut drives: Vec<String> = Vec::new();
        if let Ok(out) = Command::new("wmic")
            .args(["logicaldisk", "get", "caption", "/value"])
            .creation_flags(0x08000000)
            .output()
            && out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Ok(re) = regex::Regex::new(r"Caption=(\w:)") {
                    for cap in re.captures_iter(&stdout) {
                        if let Some(m) = cap.get(1) {
                            drives.push(m.as_str().to_string());
                        }
                    }
                }
            }
        if drives.is_empty() {
            // wmic 失败时回退到常见盘符
            for d in &["C:", "D:", "E:", "F:", "G:", "H:", "I:", "J:"] {
                drives.push(d.to_string());
            }
        }
        let dir_names = [
            "Java", "JDK", "JRE", "Runtime",
            "Javas", "JDKs", "JREs", "Runtimes",
            "OpenJDK", "jdk", "jre", "runtime",
            ".jdks", ".jre", ".java",
            "Temurin", "Corretto", "Zulu",
            "Microsoft", "GraalVM", "Liberica", "Dragonwell",
        ];
        for drive in &drives {
            // 先读盘根目录，枚举命中 java/jdk/jre/runtime 关键字的目录（与 Electron 版逻辑一致）
            let root = PathBuf::from(format!("{}\\", drive));
            if let Ok(entries) = std::fs::read_dir(&root) {
                for entry in entries.flatten() {
                    if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        continue;
                    }
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    let hit = ["java", "jdk", "jre", "runtime"]
                        .iter()
                        .any(|k| name == *k || name == format!("{}s", k));
                    if hit {
                        scan_java_subdirs_depth(&entry.path(), 2, &mut paths, &mut found, add);
                    }
                }
            }
            // 同时保留常见目录名精确匹配
            for dir_name in &dir_names {
                let p = PathBuf::from(format!("{}\\{}", drive, dir_name));
                scan_java_subdirs(&p.to_string_lossy(), &mut paths, &mut found, add);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // macOS：系统 JVM 目录、Homebrew OpenJDK、java_home 与 Minecraft 自带运行时
        #[cfg(target_os = "macos")]
        {
            for p in [
                "/Library/Java/JavaVirtualMachines",
                "/System/Library/Java/JavaVirtualMachines",
            ] {
                scan_java_subdirs_depth(Path::new(p), 5, &mut paths, &mut found, add);
            }
            for p in ["/opt/homebrew/opt", "/usr/local/opt"] {
                if let Ok(entries) = std::fs::read_dir(p) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_lowercase();
                        if name.starts_with("openjdk") {
                            // Homebrew: openjdk@21/libexec/openjdk.jdk/Contents/Home/bin/java
                            scan_java_subdirs_depth(&entry.path(), 5, &mut paths, &mut found, add);
                        }
                    }
                }
            }
            if let Ok(out) = Command::new("/usr/libexec/java_home").output() {
                if out.status.success() {
                    let home = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !home.is_empty() {
                        add(
                            &mut paths,
                            &mut found,
                            PathBuf::from(&home).join("bin").join(java_bin_name()),
                        );
                    }
                }
            }
            if let Some(home) = dirs::home_dir() {
                for rel in [
                    "Library/Java/JavaVirtualMachines",
                    "Library/Application Support/minecraft/runtime",
                ] {
                    scan_java_subdirs_depth(
                        &home.join(rel),
                        5,
                        &mut paths,
                        &mut found,
                        add,
                    );
                }
            }
        }
        // Linux：发行版包目录、SDKMAN 与 Minecraft 自带运行时
        #[cfg(target_os = "linux")]
        {
            for p in [
                "/usr/lib/jvm",
                "/usr/java",
                "/opt/java",
                "/opt/jdk",
                "/opt/openjdk",
            ] {
                scan_java_subdirs_depth(Path::new(p), 4, &mut paths, &mut found, add);
            }
            if let Some(home) = dirs::home_dir() {
                for rel in [
                    ".jdks",
                    ".sdkman/candidates/java",
                    ".minecraft/runtime",
                    ".local/share/minecraft/runtime",
                ] {
                    scan_java_subdirs_depth(
                        &home.join(rel),
                        4,
                        &mut paths,
                        &mut found,
                        add,
                    );
                }
            }
        }
    }
    // ProgramData\Oracle\Java（Windows）
    #[cfg(target_os = "windows")]
    {
        if let Ok(pd) = std::env::var("ProgramData") {
            let oracle = PathBuf::from(pd).join("Oracle").join("Java");
            scan_java_subdirs(&oracle.to_string_lossy(), &mut paths, &mut found, add);
        } else {
            let oracle = PathBuf::from("C:\\ProgramData\\Oracle\\Java");
            scan_java_subdirs(&oracle.to_string_lossy(), &mut paths, &mut found, add);
        }
    }

    // 8. where / which java（PATH 里的 java）
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("where");
        c.arg("java");
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("which");
        c.arg("java");
        c
    };
    if let Ok(out) = cmd.output()
        && out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let p = PathBuf::from(line.trim());
                if p.exists() {
                    add(&mut paths, &mut found, p);
                }
            }
        }

    // 9. Windows 注册表 JavaSoft（用户用安装器装的 Java 会写入注册表，但可能不在 PATH/常见目录）
    //    避免"装了 Java 却检测不到"
    #[cfg(target_os = "windows")]
    {
        for java_exe in scan_registry_java_paths() {
            add(&mut paths, &mut found, java_exe);
        }
    }

    paths
}

/// 扫描 Windows 注册表 JavaSoft 键下的 JavaHome，返回 java.exe 路径
/// 覆盖 32/64 位注册表视图与 JRE/JDK/Java Development Kit 各键
#[cfg(target_os = "windows")]
pub(crate) fn scan_registry_java_paths() -> Vec<PathBuf> {
    use std::os::windows::process::CommandExt;
    let mut result: Vec<PathBuf> = Vec::new();
    let keys = [
        r"HKLM\SOFTWARE\JavaSoft\Java Runtime Environment",
        r"HKLM\SOFTWARE\JavaSoft\JDK",
        r"HKLM\SOFTWARE\JavaSoft\Java Development Kit",
        r"HKLM\SOFTWARE\Wow6432Node\JavaSoft\Java Runtime Environment",
        r"HKLM\SOFTWARE\Wow6432Node\JavaSoft\JDK",
        r"HKLM\SOFTWARE\Wow6432Node\JavaSoft\Java Development Kit",
        r"HKCU\SOFTWARE\JavaSoft\Java Runtime Environment",
        r"HKCU\SOFTWARE\JavaSoft\JDK",
        r"HKCU\SOFTWARE\JavaSoft\Java Development Kit",
    ];
    for key in keys {
        let mut cmd = Command::new("reg");
        cmd.args(["query", key, "/s"]);
        cmd.creation_flags(0x08000000);
        if let Ok(out) = cmd.output() {
            if !out.status.success() {
                continue;
            }
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let line = line.trim();
                // 形如 "   JavaHome    REG_SZ    C:\Program Files\Java\jdk-17"
                if let Some(home_idx) = line.find("JavaHome") {
                    let after = &line[home_idx..];
                    if let Some(sz_idx) = after.find("REG_SZ") {
                        let home = after[sz_idx + "REG_SZ".len()..]
                            .trim()
                            .trim_matches('"')
                            .trim_end_matches('\\');
                        if !home.is_empty() {
                            let java_exe = PathBuf::from(home).join("bin").join(java_bin_name());
                            if java_exe.exists() {
                                let norm = java_exe
                                    .to_string_lossy()
                                    .to_lowercase()
                                    .replace('\\', "/");
                                if !result.iter().any(|p| {
                                    p.to_string_lossy().to_lowercase().replace('\\', "/") == norm
                                }) {
                                    result.push(java_exe);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    result
}

/// 在 dir 下扫描一层包含 java/jdk/jre 关键字的子目录，找到 java.exe
pub(crate) fn scan_java_subdirs(
    dir: &str,
    paths: &mut Vec<PathBuf>,
    found: &mut std::collections::HashSet<String>,
    add: fn(&mut Vec<PathBuf>, &mut std::collections::HashSet<String>, PathBuf),
) {
    let dir_path = PathBuf::from(dir);
    if !dir_path.exists() {
        return;
    }
    // 关键点：如果 dir 本身就是 Java Home（C:\Java\bin\java.exe 存在），直接匹配，
    // 这样用户把 JDK 解压成单层 C:\Java 的情况也能识别
    let self_java = dir_path.join("bin").join(java_bin_name());
    if self_java.exists() {
        add(paths, found, self_java);
    }
    let keywords = [
        "java", "jdk", "jre", "adopt", "temurin", "corretto", "zulu", "amazon",
        "microsoft", "sapmachine", "bellsoft", "graalvm", "dragonwell", "openjdk",
        "liberica", "jbr", "jetbrains",
    ];

    let entries = match std::fs::read_dir(&dir_path) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_lowercase(),
            None => continue,
        };
        if !keywords.iter().any(|k| name.contains(k)) {
            continue;
        }
        // 找到 java/jdk 目录，深入一层找 bin/java.exe
        let java_exe = path.join("bin").join(java_bin_name());
        if java_exe.exists() {
            add(paths, found, java_exe);
            continue;
        }
        // 再深入一层
        if let Ok(sub_entries) = std::fs::read_dir(&path) {
            for sub in sub_entries.flatten() {
                let sub_java = sub.path().join("bin").join(java_bin_name());
                if sub_java.exists() {
                    add(paths, found, sub_java);
                }
            }
        }
    }
}

/// 深度扫描
pub(crate) fn scan_java_subdirs_depth(
    dir: &Path,
    depth: u32,
    paths: &mut Vec<PathBuf>,
    found: &mut std::collections::HashSet<String>,
    add: fn(&mut Vec<PathBuf>, &mut std::collections::HashSet<String>, PathBuf),
) {
    if depth == 0 || !dir.exists() {
        return;
    }
    // 先检查 dir 本身是不是 Java Home（用户直接解压到盘根目录的单层 Java Home）
    let self_java = dir.join("bin").join(java_bin_name());
    if self_java.exists() {
        add(paths, found, self_java);
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let java_exe = path.join("bin").join(java_bin_name());
        if java_exe.exists() {
            add(paths, found, java_exe);
            continue;
        }
        scan_java_subdirs_depth(&path, depth - 1, paths, found, add);
    }
}

/// 候选文件夹列表：包含完整 Java 的常见目录，扫描到其中的 Java 会获得更高排序优先级
pub(crate) fn candidate_folders() -> Vec<String> {
    let mut folders: Vec<String> = Vec::new();
    let mut push = |p: Option<String>| {
        if let Some(s) = p
            && !s.is_empty() {
                folders.push(s);
            }
    };

    let appdata = std::env::var("APPDATA").ok();
    let localappdata = std::env::var("LOCALAPPDATA").ok();
    let userprofile = std::env::var("USERPROFILE").ok();
    let pf = std::env::var("ProgramFiles").ok();
    let pf86 = std::env::var("ProgramFiles(x86)").ok();
    let documents = std::env::var("USERPROFILE").ok().map(|h| format!("{}\\Documents", h));

    push(appdata.as_ref().map(|a| format!("{}\\.minecraft\\runtime\\", a)));
    push(appdata.as_ref().map(|a| format!("{}\\.hmcl\\java\\", a)));
    push(appdata.as_ref().map(|a| format!("{}\\ATLauncher\\runtimes\\minecraft\\", a)));
    push(appdata.as_ref().map(|a| format!("{}\\ModrinthApp\\meta\\java_versions\\", a)));
    push(appdata.as_ref().map(|a| format!("{}\\PrismLauncher\\java\\", a)));
    push(userprofile.as_ref().map(|u| format!("{}\\curseforge\\minecraft\\Install\\runtime\\", u)));
    push(userprofile.as_ref().map(|u| format!("{}\\.jdks\\", u)));
    push(userprofile.as_ref().map(|u| format!("{}\\.sdkman\\candidates\\java\\", u)));
    push(localappdata.as_ref().map(|l| format!("{}\\.ftba\\bin\\runtime\\", l)));
    push(localappdata.as_ref().map(|l| {
        format!(
            "{}\\Packages\\Microsoft.4297127D64EC6_8wekyb3d8bbwe\\LocalCache\\Local\\runtime\\",
            l
        )
    }));
    push(pf86.as_ref().map(|p| format!("{}\\Minecraft Launcher\\runtime\\", p)));
    push(pf86.as_ref().map(|p| format!("{}\\Minecraft\\runtime\\", p)));
    push(documents.as_ref().map(|d| format!("{}\\Curse\\Minecraft\\Install\\runtime\\", d)));
    push(pf.as_ref().map(|p| format!("{}\\Java\\", p)));
    push(pf.as_ref().map(|p| format!("{}\\Eclipse Adoptium\\", p)));
    push(pf.as_ref().map(|p| format!("{}\\Amazon Corretto\\", p)));
    push(pf.as_ref().map(|p| format!("{}\\Zulu\\", p)));

    // macOS/Linux 常见 JDK 位置（用于排序优先级）
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir();
        push(Some("/Library/Java/JavaVirtualMachines/".to_string()));
        push(Some("/opt/homebrew/opt/".to_string()));
        push(Some("/usr/local/opt/".to_string()));
        push(home.as_ref().map(|h| {
            format!(
                "{}/Library/Application Support/minecraft/runtime/",
                h.to_string_lossy()
            )
        }));
        push(home.as_ref().map(|h| format!("{}/Library/Java/JavaVirtualMachines/", h.to_string_lossy())));
    }
    #[cfg(target_os = "linux")]
    {
        let home = dirs::home_dir();
        push(Some("/usr/lib/jvm/".to_string()));
        push(Some("/usr/java/".to_string()));
        push(home.as_ref().map(|h| format!("{}/.sdkman/candidates/java/", h.to_string_lossy())));
        push(home.as_ref().map(|h| {
            format!(
                "{}/.local/share/minecraft/runtime/",
                h.to_string_lossy()
            )
        }));
    }

    folders
}

/// 判断 java 可执行文件所在目录是否属于候选文件夹（父目录前缀匹配）
pub(crate) fn is_in_candidate_folder(java_exe: &Path, candidates: &[String]) -> bool {
    let java_folder = java_exe
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/").to_lowercase())
        .unwrap_or_default();
    candidates.iter().any(|f| {
        let f = f.replace('\\', "/").to_lowercase();
        java_folder.starts_with(&f)
    })
}

/// 检查路径是否包含重解析点（符号链接 / junction）
/// 仅在 Windows 上过滤；macOS/Linux 的 JDK 常用符号链接管理，不能据此排除
#[cfg(not(target_os = "windows"))]
pub(crate) fn has_reparse_point(_java_exe: &Path) -> bool {
    false
}

#[cfg(target_os = "windows")]
pub(crate) fn has_reparse_point(java_exe: &Path) -> bool {
    let lower = java_exe.to_string_lossy().to_lowercase();
    if lower.contains(".minecraft\\runtime") || lower.contains(".minecraft/runtime") {
        return false;
    }
    // 从 java.exe 所在目录向上逐级检查是否为符号链接
    let mut cur = java_exe.parent().map(|p| p.to_path_buf());
    while let Some(dir) = cur {
        match std::fs::symlink_metadata(&dir) {
            Ok(md) => {
                if md.file_type().is_symlink() {
                    return true;
                }
            }
            Err(_) => return false,
        }
        cur = dir.parent().map(|p| p.to_path_buf());
    }
    false
}

/// 检查路径是否为特殊路径（Java 8 自动更新链接 / system32 等）
pub(crate) fn is_special_path(java_exe: &Path) -> bool {
    let lower = java_exe.to_string_lossy().to_lowercase();
    // macOS 的 /usr/bin/java 只是系统占位程序，执行时会弹出安装提示，不能作为候选
    #[cfg(target_os = "macos")]
    if lower == "/usr/bin/java" {
        return true;
    }
    lower.contains("java8path_target_")
        || lower.contains("javapath_target_")
        || lower.contains("javatmp")
        || lower.contains("\\system32\\")
}

/// 执行完整 Java 检测（带缓存）
pub fn detect_all() -> Vec<Value> {
    // 检查缓存（10 分钟内有效）
    {
        let cache = JAVA_CACHE.lock().unwrap();
        if let Some(c) = cache.as_ref() {
            return c.java_list.clone();
        }
    }

    let candidates = scan_common_java_paths();
    println!("[java] 扫描到 {} 个候选路径", candidates.len());
    for c in &candidates {
        println!("[java]   候选: {}", c.display());
    }
    let mut java_list: Vec<Value> = Vec::new();

    for java_exe in candidates {
        // 排除 finalshell / paranoia 等
        let path_str = java_exe.to_string_lossy().to_lowercase();
        if path_str.contains("finalshell") || path_str.contains("paranoia") {
            continue;
        }
        // 排除重解析点与特殊路径
        if has_reparse_point(&java_exe) || is_special_path(&java_exe) {
            continue;
        }

        if let Some((version, major, is64)) = inspect_java(&java_exe) {
            // 只接受 64 位 Java
            if !is64 {
                println!("[java]   跳过 32 位 Java: {}", java_exe.display());
                continue;
            }
            let java_home = java_exe
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            java_list.push(json!({
                "path": java_exe.to_string_lossy(),
                "version": version,
                "majorVersion": major,
                "minorVersion": 0,
                "is64Bit": is64,
                "isJdk": true,
                "source": "system",
                "javaHome": java_home
            }));
        }
    }

    // 加载手动添加的 Java（custom-java-list.json）
    let custom = load_custom_java();
    if let Some(custom_arr) = custom.as_array() {
        for entry in custom_arr {
            // 合并到 java_list
            java_list.push(entry.clone());
        }
    }

    // 排序（候选文件夹优先，其次接近 21 优先）
    sort_java_list(&mut java_list);

    // 写缓存
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut cache = JAVA_CACHE.lock().unwrap();
    *cache = Some(JavaCache {
        java_list: java_list.clone(),
        cached_at: now,
    });

    println!("[java] detect_all 完成，找到 {} 个 Java", java_list.len());
    for j in &java_list {
        println!("[java]   {} v{}", j.get("path").and_then(|v| v.as_str()).unwrap_or("?"), j.get("version").and_then(|v| v.as_str()).unwrap_or("?"));
    }

    java_list
}
