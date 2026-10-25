// launch/memory.rs — JVM 内存决策纯函数
// 1:1 翻译自 server/launch/memory-resolver.js + memory-mode-resolver.js + memory-optimize-resolver.js

/// 旧版默认内存值（用于判断用户是否改过全局设置）
pub const DEFAULT_LEGACY_MAX_MEMORY: u64 = 4096;

/// 内存模式
#[derive(Clone, Debug, PartialEq)]
pub enum MemoryMode {
    Auto,
    Custom(u64),
}

/// 决策内存模式（对应 memory-mode-resolver.js）
/// 优先级 1: 前端 launch_settings 显式选择
/// 优先级 2: settings.maxMemory ≠ 4096 → custom
/// 优先级 3: 默认 auto
pub fn resolve_memory_mode(
    settings_max_memory: u64,
    has_launch_settings: bool,
    launch_memory_mode: Option<&str>,
    launch_memory_value: Option<u64>,
) -> MemoryMode {
    if has_launch_settings {
        let mode = launch_memory_mode.unwrap_or("auto");
        if mode == "custom" {
            return MemoryMode::Custom(launch_memory_value.unwrap_or(4096));
        }
        return MemoryMode::Auto;
    }
    if settings_max_memory != DEFAULT_LEGACY_MAX_MEMORY {
        return MemoryMode::Custom(settings_max_memory);
    }
    MemoryMode::Auto
}

/// 解析 JVM 最大内存（对应 memory-resolver.js）
/// 自动模式：基于当前可用内存按 Mod 分级加成
/// custom 模式：直接返回用户指定值
pub fn resolve_max_memory(
    mode: &MemoryMode,
    total_mb: u64,
    free_mb: u64,
    mod_count: u64,
) -> u64 {
    match mode {
        MemoryMode::Custom(v) => *v,
        MemoryMode::Auto => {
            const GB_TO_MB: u64 = 1024;

            // Mod 加成 4 级目标（GB）
            let ram_min_gb = 0.5 + (mod_count as f64) / 150.0;
            let ram_target1_gb = 1.5 + (mod_count as f64) / 90.0;
            let ram_target2_gb = 2.7 + (mod_count as f64) / 50.0;
            let ram_target3_gb = 4.5 + (mod_count as f64) / 25.0;

            // 基于当前可用内存渐进分配
            let mut ram_give_mb: f64 = 0.0;
            let mut ram_available_gb = (free_mb as f64) / (GB_TO_MB as f64);

            let stages: [(f64, f64); 4] = [
                (ram_target1_gb, 1.0),
                (ram_target2_gb - ram_target1_gb, 0.7),
                (ram_target3_gb - ram_target2_gb, 0.4),
                (ram_target3_gb, 0.15),
            ];

            for (delta_gb, ratio) in stages {
                ram_give_mb += (ram_available_gb * ratio).min(delta_gb) * (GB_TO_MB as f64);
                ram_available_gb -= delta_gb / ratio;
                if ram_available_gb < 0.1 {
                    break;
                }
            }

            let min_required_mb = (ram_min_gb * (GB_TO_MB as f64)).floor();
            ram_give_mb = ram_give_mb.max(min_required_mb);

            let mut auto_mb = ram_give_mb.floor();

            // 物理内存总量约束（分档保留系统占用）
            let system_reserve = if total_mb <= 4096 {
                1536
            } else if total_mb <= 8192 {
                2048
            } else {
                2560
            };
            let physical_cap = (total_mb.saturating_sub(system_reserve)).max(512);
            auto_mb = auto_mb.min(physical_cap as f64);

            // 封顶 16GB，对齐 256MB
            let mut result = auto_mb.clamp(512.0, 16384.0) as u64;
            result = (result / 256) * 256;
            result
        }
    }
}

/// 决策是否执行启动前内存优化（对应 memory-optimize-resolver.js）
/// 优先级 1: 版本独立设置 on/off
/// 优先级 2: 全局设置必须显式开启
/// 优先级 3: 大内存机器（≥12GB）跳过
/// 优先级 4: 大型整合包（mod ≥ 100）跳过
/// 优先级 5: 可用内存充足（> 4GB）跳过
#[allow(dead_code)]
pub fn should_run_memory_optimize(
    auto_memory_optimize: bool,
    version_mem_optimize: &str,
    total_mem_mb: u64,
    mod_count: u64,
    free_mb: u64,
) -> bool {
    if version_mem_optimize == "on" {
        return true;
    }
    if version_mem_optimize == "off" {
        return false;
    }
    if !auto_memory_optimize {
        return false;
    }
    if total_mem_mb >= 12288 {
        return false;
    }
    if mod_count >= 100 {
        return false;
    }
    if free_mb > 4096 {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_mode_prefers_launch_settings() {
        assert_eq!(
            resolve_memory_mode(8192, true, Some("custom"), Some(6144)),
            MemoryMode::Custom(6144)
        );
        assert_eq!(
            resolve_memory_mode(8192, true, Some("auto"), Some(6144)),
            MemoryMode::Auto
        );
        assert_eq!(
            resolve_memory_mode(8192, true, None, None),
            MemoryMode::Auto
        );
    }

    #[test]
    fn memory_mode_falls_back_to_global_setting() {
        assert_eq!(
            resolve_memory_mode(6144, false, None, None),
            MemoryMode::Custom(6144)
        );
        assert_eq!(
            resolve_memory_mode(DEFAULT_LEGACY_MAX_MEMORY, false, None, None),
            MemoryMode::Auto
        );
    }

    #[test]
    fn custom_mode_returns_exact_value() {
        assert_eq!(
            resolve_max_memory(&MemoryMode::Custom(3072), 16384, 8192, 0),
            3072
        );
    }

    #[test]
    fn auto_mode_is_bounded_and_aligned() {
        for mod_count in [0u64, 50, 150, 500] {
            let value = resolve_max_memory(&MemoryMode::Auto, 16384, 8192, mod_count);
            assert!(value >= 512, "mod_count={mod_count} value={value}");
            assert!(value <= 16384, "mod_count={mod_count} value={value}");
            assert_eq!(value % 256, 0, "mod_count={mod_count} value={value}");
        }
    }

    #[test]
    fn auto_mode_respects_small_physical_memory() {
        // 4GB 机器保留 1536MB 系统占用，上限 2560MB
        assert_eq!(
            resolve_max_memory(&MemoryMode::Auto, 4096, 4096, 0),
            2560
        );
        // 8GB 机器保留 2048MB 系统占用，默认需求未触顶
        assert_eq!(
            resolve_max_memory(&MemoryMode::Auto, 8192, 8192, 0),
            4608
        );
    }

    #[test]
    fn auto_mode_grows_with_mod_count() {
        let low = resolve_max_memory(&MemoryMode::Auto, 16384, 8192, 0);
        let high = resolve_max_memory(&MemoryMode::Auto, 16384, 8192, 150);
        assert!(high >= low, "low={low} high={high}");
    }

    #[test]
    fn memory_optimize_conditions() {
        assert!(should_run_memory_optimize(true, "on", 16384, 0, 8192));
        assert!(!should_run_memory_optimize(true, "off", 4096, 0, 1024));
        assert!(!should_run_memory_optimize(false, "auto", 4096, 0, 1024));
        assert!(!should_run_memory_optimize(true, "auto", 12288, 0, 1024));
        assert!(!should_run_memory_optimize(true, "auto", 8192, 100, 1024));
        assert!(should_run_memory_optimize(true, "auto", 8192, 10, 2048));
        assert!(!should_run_memory_optimize(true, "auto", 8192, 10, 5000));
    }
}
