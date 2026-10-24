// api/mods/deps_parse.rs — 依赖数据结构与 Modrinth / CurseForge 字段解析
use serde_json::Value;

use super::super::{MODRINTH_BUNDLED_DEPS, CURSEFORGE_BUNDLED_DEPS};

/// 依赖引用（只保留 projectId）
#[derive(Clone)]
pub(crate) struct DepRef {
    pub(crate) project_id: String,
}

/// 依赖文件（Modrinth / CurseForge 统一结构）
#[derive(Clone)]
pub(crate) struct DepFile {
    pub(crate) id: String,
    pub(crate) version_number: String,
    pub(crate) file_name: String,
    pub(crate) game_versions: Vec<String>,
    pub(crate) loaders: Vec<String>,
    pub(crate) release_type: u8,
    pub(crate) release_date: String,
    pub(crate) dependencies: Vec<DepRef>,
}

/// 依赖项目元信息 + 文件列表
pub(crate) struct DepProject {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) slug: String,
    pub(crate) icon: String,
    pub(crate) description: String,
    pub(crate) downloads: u64,
    pub(crate) files: Vec<DepFile>,
}

/// 根模组版本信息
pub(crate) struct DepRoot {
    pub(crate) project_id: String,
    pub(crate) game_versions: Vec<String>,
    pub(crate) loaders: Vec<String>,
    pub(crate) dependencies: Vec<DepRef>,
}

pub(crate) fn body_string(body: &Option<Value>, key: &str) -> String {
    body.as_ref()
        .and_then(|b| b.get(key))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

pub(crate) fn json_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// 判断字符串是否像 Minecraft 版本号（用于从 CurseForge 的 gameVersions 中剔除加载器名）
pub(crate) fn looks_like_mc_version(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "forge" | "fabric" | "neoforge" | "quilt" | "liteloader" | "rift" | "cauldron"
    ) {
        return false;
    }
    value
        .chars()
        .next()
        .map(|c| c.is_ascii_digit())
        .unwrap_or(false)
        && (value.contains('.') || value.contains('w'))
}

pub(crate) fn parse_loader_list(input: &str) -> Vec<String> {
    let mut loaders: Vec<String> = Vec::new();
    for part in input.split(|c: char| c == ',' || c.is_whitespace()) {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let lower = part.to_ascii_lowercase();
        if !loaders.contains(&lower) {
            loaders.push(lower);
        }
    }
    loaders
}

pub(crate) fn loader_matches(file_loaders: &[String], target_loaders: &[String]) -> bool {
    target_loaders.is_empty()
        || file_loaders.is_empty()
        || file_loaders.iter().any(|fl| {
            target_loaders
                .iter()
                .any(|tl| tl.eq_ignore_ascii_case(fl))
        })
}

pub(crate) fn loader_exact_match(file_loaders: &[String], target_loaders: &[String]) -> bool {
    !target_loaders.is_empty()
        && file_loaders.iter().any(|fl| {
            target_loaders
                .iter()
                .any(|tl| tl.eq_ignore_ascii_case(fl))
        })
}

pub(crate) fn release_rank(release_type: u8) -> u8 {
    match release_type {
        1 => 1,
        2 => 2,
        3 => 3,
        _ => 4,
    }
}

/// 选择兼容文件：精确游戏版本 > 加载器匹配 > release > 最新
pub(crate) fn select_compatible_file<'a>(
    files: &'a [DepFile],
    game_version: &str,
    loaders: &[String],
) -> Option<&'a DepFile> {
    let mut candidates: Vec<&DepFile> = files
        .iter()
        .filter(|file| {
            (game_version.is_empty()
                || file
                    .game_versions
                    .iter()
                    .any(|gv| gv.eq_ignore_ascii_case(game_version)))
                && loader_matches(&file.loaders, loaders)
        })
        .collect();

    candidates.sort_by(|a, b| {
        let a_loader = loader_exact_match(&a.loaders, loaders);
        let b_loader = loader_exact_match(&b.loaders, loaders);
        b_loader
            .cmp(&a_loader)
            .then_with(|| release_rank(a.release_type).cmp(&release_rank(b.release_type)))
            .then_with(|| b.release_date.cmp(&a.release_date))
    });

    candidates.first().copied()
}

pub(crate) fn cf_loader_name(id: u64) -> Option<&'static str> {
    match id {
        1 => Some("forge"),
        4 => Some("fabric"),
        5 => Some("quilt"),
        6 => Some("neoforge"),
        _ => None,
    }
}

pub(crate) fn cf_loader_id(loader: &str) -> Option<u32> {
    match loader.to_ascii_lowercase().as_str() {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

pub(crate) fn cf_file_loaders(file: &Value) -> Vec<String> {
    let mut loaders: Vec<String> = Vec::new();
    if let Some(arr) = file.get("modLoaders").and_then(|v| v.as_array()) {
        for ml in arr {
            if let Some(id) = ml.get("modLoader").and_then(|v| v.as_u64())
                && let Some(name) = cf_loader_name(id) {
                    let name = name.to_string();
                    if !loaders.contains(&name) {
                        loaders.push(name);
                    }
                }
        }
    }
    if loaders.is_empty() {
        for gv in json_string_array(file.get("gameVersions")) {
            let lower = gv.to_ascii_lowercase();
            if matches!(
                lower.as_str(),
                "forge" | "fabric" | "neoforge" | "quilt" | "liteloader"
            ) && !loaders.contains(&lower)
            {
                loaders.push(lower);
            }
        }
    }
    loaders
}

pub(crate) fn parse_modrinth_dependencies(value: &Value) -> Vec<DepRef> {
    value
        .get("dependencies")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|dep| {
                    if dep.get("dependency_type").and_then(|t| t.as_str()) != Some("required") {
                        return None;
                    }
                    let pid = dep.get("project_id").and_then(|p| p.as_str()).unwrap_or("");
                    if pid.is_empty() || MODRINTH_BUNDLED_DEPS.contains(&pid) {
                        return None;
                    }
                    Some(DepRef {
                        project_id: pid.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn parse_cf_dependencies(file: &Value) -> Vec<DepRef> {
    file.get("dependencies")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|dep| {
                    // CurseForge: 3=必需；1=内嵌库、2=可选、4=工具、5=冲突、6=包含项均不作为前置
                    if dep.get("relationType").and_then(|r| r.as_u64()) != Some(3) {
                        return None;
                    }
                    let mod_id = dep
                        .get("modId")
                        .and_then(|m| m.as_u64())
                        .or_else(|| {
                            dep.get("modId")
                                .and_then(|m| m.as_str())
                                .and_then(|s| s.parse::<u64>().ok())
                        })?;
                    if CURSEFORGE_BUNDLED_DEPS.contains(&mod_id) {
                        return None;
                    }
                    Some(DepRef {
                        project_id: mod_id.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn parse_modrinth_file(version: &Value) -> DepFile {
    let files = version.get("files").and_then(|f| f.as_array());
    let primary = files.and_then(|arr| {
        arr.iter()
            .find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
            .or_else(|| arr.first())
    });

    DepFile {
        id: version
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        version_number: version
            .get("version_number")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        file_name: primary
            .and_then(|f| f.get("filename").and_then(|n| n.as_str()))
            .unwrap_or("")
            .to_string(),
        game_versions: json_string_array(version.get("game_versions")),
        loaders: json_string_array(version.get("loaders"))
            .into_iter()
            .map(|l| l.to_ascii_lowercase())
            .collect(),
        release_type: match version
            .get("version_type")
            .and_then(|t| t.as_str())
            .unwrap_or("release")
        {
            "beta" => 2,
            "alpha" => 3,
            _ => 1,
        },
        release_date: version
            .get("date_published")
            .and_then(|d| d.as_str())
            .unwrap_or("")
            .to_string(),
        dependencies: parse_modrinth_dependencies(version),
    }
}

pub(crate) fn parse_cf_file(file: &Value) -> DepFile {
    let file_name = file
        .get("fileName")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    let version_number = file
        .get("displayName")
        .and_then(|n| n.as_str())
        .filter(|n| !n.is_empty())
        .map(|n| n.to_string())
        .unwrap_or_else(|| file_name.trim_end_matches(".jar").to_string());

    DepFile {
        id: file
            .get("id")
            .map(|i| i.to_string())
            .unwrap_or_default(),
        version_number,
        file_name,
        game_versions: json_string_array(file.get("gameVersions")),
        loaders: cf_file_loaders(file),
        release_type: file.get("releaseType").and_then(|r| r.as_u64()).unwrap_or(1) as u8,
        release_date: file
            .get("fileDate")
            .and_then(|d| d.as_str())
            .unwrap_or("")
            .to_string(),
        dependencies: parse_cf_dependencies(file),
    }
}

pub(crate) fn derive_target(
    input_game: &str,
    input_loader: &str,
    root_game_versions: &[String],
    root_loaders: &[String],
) -> (String, Vec<String>) {
    let game_version = if input_game.trim().is_empty() {
        root_game_versions
            .iter()
            .find(|v| looks_like_mc_version(v))
            .cloned()
            .unwrap_or_default()
    } else {
        input_game.trim().to_string()
    };

    let mut loaders = parse_loader_list(input_loader);
    if loaders.is_empty() {
        loaders = root_loaders
            .iter()
            .map(|l| l.to_ascii_lowercase())
            .filter(|l| !l.is_empty())
            .collect();
    }

    (game_version, loaders)
}
