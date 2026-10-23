// platform.rs — 平台与架构命名统一入口
// Minecraft 版本 JSON 的 rules.os.name 用 windows/osx/linux，
// 而原生包 classifier 后缀用 windows/macos/linux，两套命名不能混用。

/// 版本 JSON rules.os.name 取值
pub fn rules_os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

/// 原生包 classifier 的平台后缀
pub fn native_suffix() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// 版本 JSON rules.os.arch 取值
pub fn rules_arch_name() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "x64"
    }
}

/// 老版本 natives 规则中 ${arch} 的替换值（64/32）
pub fn pointer_width_suffix() -> &'static str {
    if cfg!(target_pointer_width = "64") {
        "64"
    } else {
        "32"
    }
}

/// 当前平台的 Java 可执行文件名
pub fn java_bin_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    }
}

/// 当前平台的 javac 文件名（用于区分 JDK 与 JRE）
pub fn javac_bin_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "javac.exe"
    } else {
        "javac"
    }
}

/// 可执行文件后缀
pub fn exe_suffix() -> &'static str {
    if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_and_native_names_are_platform_specific() {
        let rules = rules_os_name();
        let native = native_suffix();
        if cfg!(target_os = "windows") {
            assert_eq!(rules, "windows");
            assert_eq!(native, "windows");
            assert_eq!(java_bin_name(), "java.exe");
            assert_eq!(exe_suffix(), ".exe");
        } else if cfg!(target_os = "macos") {
            assert_eq!(rules, "osx");
            assert_eq!(native, "macos", "rules 的 osx 不能直接用于 classifier");
            assert_eq!(java_bin_name(), "java");
            assert_eq!(exe_suffix(), "");
        } else {
            assert_eq!(rules, "linux");
            assert_eq!(native, "linux");
            assert_eq!(java_bin_name(), "java");
        }
    }

    #[test]
    fn arch_names_are_known_values() {
        assert!(matches!(rules_arch_name(), "arm64" | "x86" | "x64"));
        assert!(matches!(pointer_width_suffix(), "64" | "32"));
    }
}
