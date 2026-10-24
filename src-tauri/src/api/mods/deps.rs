// api/mods/deps.rs — 依赖解析（Modrinth / CurseForge）
use std::collections::{HashSet, VecDeque};
use std::time::Duration;

use serde_json::{json, Value};

use crate::api::ApiResult;
use crate::storage;

use super::{MODRINTH_API, CURSEFORGE_API, DEFAULT_CF_API_KEY, MAX_DEPENDENCY_DEPTH, MODRINTH_BUNDLED_DEPS, CURSEFORGE_BUNDLED_DEPS};

/// POST /api/mods/get-dependencies — 获取依赖（第一层）
pub(crate) async fn handle_get_dependencies(body: &Option<Value>) -> ApiResult {
    resolve_dependency_tree(body, false).await
}

/// POST /api/mods/get-dependencies-recursive — 递归获取依赖
///
/// 递归解析规则：
/// 1. 只解析 required 前置，忽略 optional / incompatible；
/// 2. 每个前置选择“精确游戏版本 + 加载器匹配 + release 优先 + 最新”的文件；
/// 3. 对选中前置文件继续解析其 required 前置，按 projectId 去重，最大深度 32；
/// 4. 跳过加载器自带的 Fabric API / Quilt API。
pub(crate) async fn handle_get_dependencies_recursive(body: &Option<Value>) -> ApiResult {
    resolve_dependency_tree(body, true).await
}

/// 依赖引用（只保留 projectId）
#[derive(Clone)]
pub(crate) struct DepRef {
    project_id: String,
}

/// 依赖文件（Modrinth / CurseForge 统一结构）
#[derive(Clone)]
pub(crate) struct DepFile {
    id: String,
    version_number: String,
    file_name: String,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    release_type: u8,
    release_date: String,
    dependencies: Vec<DepRef>,
}

/// 依赖项目元信息 + 文件列表
pub(crate) struct DepProject {
    id: String,
    title: String,
    slug: String,
    icon: String,
    description: String,
    downloads: u64,
    files: Vec<DepFile>,
}

/// 根模组版本信息
pub(crate) struct DepRoot {
    project_id: String,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    dependencies: Vec<DepRef>,
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

pub(crate) async fn fetch_dep_root(
    client: &reqwest::Client,
    is_cf: bool,
    project_id: &str,
    version_id: &str,
    cf_api_key: &str,
) -> Result<DepRoot, String> {
    if is_cf {
        if project_id.is_empty() {
            return Err("CurseForge 依赖解析缺少 projectId".to_string());
        }
        let url = format!("{}/mods/{}/files/{}", CURSEFORGE_API, project_id, version_id);
        let resp = client
            .get(&url)
            .header("x-api-key", cf_api_key)
            .send()
            .await
            .map_err(|e| format!("请求 CurseForge 文件失败: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("CurseForge 文件 HTTP {}", resp.status()));
        }
        let data: Value = resp
            .json()
            .await
            .map_err(|e| format!("解析 CurseForge 文件失败: {}", e))?;
        let file = data.get("data").unwrap_or(&data);
        Ok(DepRoot {
            project_id: project_id.to_string(),
            game_versions: json_string_array(file.get("gameVersions")),
            loaders: cf_file_loaders(file),
            dependencies: parse_cf_dependencies(file),
        })
    } else {
        let url = format!("{}/version/{}", MODRINTH_API, version_id);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("请求 Modrinth 版本失败: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Modrinth 版本 HTTP {}", resp.status()));
        }
        let data: Value = resp
            .json()
            .await
            .map_err(|e| format!("解析 Modrinth 版本失败: {}", e))?;
        let pid = data
            .get("project_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(project_id);
        Ok(DepRoot {
            project_id: pid.to_string(),
            game_versions: json_string_array(data.get("game_versions")),
            loaders: json_string_array(data.get("loaders"))
                .into_iter()
                .map(|l| l.to_ascii_lowercase())
                .collect(),
            dependencies: parse_modrinth_dependencies(&data),
        })
    }
}

pub(crate) async fn fetch_cf_files(
    client: &reqwest::Client,
    project_id: &str,
    game_version: &str,
    loaders: &[String],
    cf_api_key: &str,
) -> Result<Vec<DepFile>, String> {
    let mut url = format!("{}/mods/{}/files?pageSize=50", CURSEFORGE_API, project_id);
    if !game_version.is_empty() {
        url.push_str(&format!(
            "&gameVersion={}",
            urlencoding::encode(game_version)
        ));
    }
    if loaders.len() == 1
        && let Some(loader_id) = cf_loader_id(&loaders[0]) {
            url.push_str(&format!("&modLoaderType={}", loader_id));
        }

    let resp = client
        .get(&url)
        .header("x-api-key", cf_api_key)
        .send()
        .await
        .map_err(|e| format!("请求 CurseForge 文件列表失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("CurseForge 文件列表 HTTP {}", resp.status()));
    }
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 CurseForge 文件列表失败: {}", e))?;
    Ok(data
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| arr.iter().map(parse_cf_file).collect())
        .unwrap_or_default())
}

pub(crate) async fn fetch_dep_project(
    client: &reqwest::Client,
    is_cf: bool,
    project_id: &str,
    game_version: &str,
    loaders: &[String],
    cf_api_key: &str,
) -> Result<DepProject, String> {
    if is_cf {
        let project_url = format!("{}/mods/{}", CURSEFORGE_API, project_id);
        let (project_resp, files_result) = tokio::join!(
            client
                .get(&project_url)
                .header("x-api-key", cf_api_key)
                .send(),
            fetch_cf_files(client, project_id, game_version, loaders, cf_api_key)
        );

        let project_resp = project_resp
            .map_err(|e| format!("请求 CurseForge 项目失败: {}", e))?;
        if !project_resp.status().is_success() {
            return Err(format!("CurseForge 项目 HTTP {}", project_resp.status()));
        }
        let project: Value = project_resp
            .json()
            .await
            .map_err(|e| format!("解析 CurseForge 项目失败: {}", e))?;
        let data = project.get("data").unwrap_or(&project);

        let mut files = files_result?;
        // 带过滤条件的查询可能因为加载器映射差异返回空，退回全量列表后本地筛选
        if files.is_empty() && (!game_version.is_empty() || !loaders.is_empty()) {
            files = fetch_cf_files(client, project_id, "", &[], cf_api_key).await?;
        }

        Ok(DepProject {
            id: data
                .get("id")
                .map(|i| i.to_string())
                .unwrap_or_else(|| project_id.to_string()),
            title: data
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or(project_id)
                .to_string(),
            slug: data
                .get("slug")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            icon: data
                .get("logo")
                .and_then(|l| l.get("thumbnailUrl"))
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string(),
            description: data
                .get("summary")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .chars()
                .take(100)
                .collect(),
            downloads: data
                .get("downloadCount")
                .and_then(|d| d.as_u64())
                .unwrap_or(0),
            files,
        })
    } else {
        let project_url = format!("{}/project/{}", MODRINTH_API, project_id);
        let versions_url = format!("{}/project/{}/version", MODRINTH_API, project_id);
        let (project_resp, versions_resp) = tokio::join!(
            client.get(&project_url).send(),
            client.get(&versions_url).send()
        );

        let project_resp = project_resp
            .map_err(|e| format!("请求 Modrinth 项目失败: {}", e))?;
        if !project_resp.status().is_success() {
            return Err(format!("Modrinth 项目 HTTP {}", project_resp.status()));
        }
        let project: Value = project_resp
            .json()
            .await
            .map_err(|e| format!("解析 Modrinth 项目失败: {}", e))?;

        let versions_resp = versions_resp
            .map_err(|e| format!("请求 Modrinth 版本列表失败: {}", e))?;
        if !versions_resp.status().is_success() {
            return Err(format!("Modrinth 版本列表 HTTP {}", versions_resp.status()));
        }
        let versions: Vec<Value> = versions_resp
            .json()
            .await
            .map_err(|e| format!("解析 Modrinth 版本列表失败: {}", e))?;

        Ok(DepProject {
            id: project
                .get("id")
                .and_then(|i| i.as_str())
                .unwrap_or(project_id)
                .to_string(),
            title: project
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or(project_id)
                .to_string(),
            slug: project
                .get("slug")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            icon: project
                .get("icon_url")
                .and_then(|i| i.as_str())
                .unwrap_or("")
                .to_string(),
            description: project
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .chars()
                .take(100)
                .collect(),
            downloads: project
                .get("downloads")
                .and_then(|d| d.as_u64())
                .unwrap_or(0),
            files: versions.iter().map(parse_modrinth_file).collect(),
        })
    }
}

/// 解析前置依赖树。返回：
/// { dependencies: [...], unresolved: [...], target: { gameVersion, loaders }, source }
pub(crate) async fn resolve_dependency_tree(body: &Option<Value>, recursive: bool) -> ApiResult {
    let version_id = body_string(body, "versionId");
    let mut source = body_string(body, "source");
    if source.is_empty() {
        source = "modrinth".to_string();
    }
    let game_version = body_string(body, "gameVersion");
    let loader = body_string(body, "loader");
    let project_id = body_string(body, "projectId");

    if version_id.is_empty() {
        return ApiResult::ok(json!({ "dependencies": [], "unresolved": [] }));
    }

    let is_cf = source.eq_ignore_ascii_case("curseforge");
    if !is_cf && !source.eq_ignore_ascii_case("modrinth") {
        return ApiResult::err(400, "Unsupported source");
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let settings = storage::load_settings();
    let cf_api_key = settings
        .get("curseforgeApiKey")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_CF_API_KEY)
        .to_string();

    let root = match fetch_dep_root(&client, is_cf, &project_id, &version_id, &cf_api_key).await {
        Ok(root) => root,
        Err(e) => return ApiResult::err(502, &e),
    };

    let (target_game, target_loaders) = derive_target(
        &game_version,
        &loader,
        &root.game_versions,
        &root.loaders,
    );

    let mut queue: VecDeque<(String, usize)> = VecDeque::new();
    for dep in &root.dependencies {
        queue.push_back((dep.project_id.clone(), 1));
    }

    // 根项目自身也标记为已访问，避免环形依赖把本体当成前置重复下载
    let mut visited: HashSet<String> = HashSet::new();
    if !root.project_id.is_empty() {
        visited.insert(root.project_id.to_lowercase());
    }

    let mut dependencies: Vec<Value> = Vec::new();
    let mut unresolved: Vec<Value> = Vec::new();

    while let Some((pid, depth)) = queue.pop_front() {
        if !visited.insert(pid.to_lowercase()) {
            continue;
        }
        if depth > MAX_DEPENDENCY_DEPTH {
            unresolved.push(json!({
                "projectId": pid,
                "reason": "依赖层级超过上限"
            }));
            continue;
        }

        let project = match fetch_dep_project(
            &client,
            is_cf,
            &pid,
            &target_game,
            &target_loaders,
            &cf_api_key,
        )
        .await
        {
            Ok(project) => project,
            Err(reason) => {
                unresolved.push(json!({
                    "projectId": pid,
                    "reason": reason
                }));
                continue;
            }
        };

        match select_compatible_file(&project.files, &target_game, &target_loaders) {
            Some(file) => {
                let compatible = json!({
                    "versionId": &file.id,
                    "versionNumber": &file.version_number,
                    "fileName": &file.file_name,
                    "gameVersions": &file.game_versions,
                    "loaders": &file.loaders,
                    "releaseType": match file.release_type {
                        1 => "release",
                        2 => "beta",
                        3 => "alpha",
                        _ => "release",
                    },
                    "datePublished": &file.release_date
                });

                dependencies.push(json!({
                    "projectId": &project.id,
                    "title": &project.title,
                    "slug": &project.slug,
                    "icon": &project.icon,
                    "description": &project.description,
                    "downloads": project.downloads,
                    "depth": depth,
                    "dependencyType": "required",
                    "versionId": &file.id,
                    "versionNumber": &file.version_number,
                    "fileName": &file.file_name,
                    "gameVersions": &file.game_versions,
                    "loaders": &file.loaders,
                    "compatibleVersion": compatible
                }));

                if recursive {
                    for nested in &file.dependencies {
                        queue.push_back((nested.project_id.clone(), depth + 1));
                    }
                }
            }
            None => {
                let reason = if target_game.is_empty() {
                    "未找到兼容版本".to_string()
                } else {
                    format!("未找到兼容 {} 的版本", target_game)
                };
                unresolved.push(json!({
                    "projectId": &project.id,
                    "title": &project.title,
                    "reason": &reason
                }));
                dependencies.push(json!({
                    "projectId": &project.id,
                    "title": &project.title,
                    "slug": &project.slug,
                    "icon": &project.icon,
                    "description": &project.description,
                    "downloads": project.downloads,
                    "depth": depth,
                    "dependencyType": "required",
                    "compatibleVersion": Value::Null,
                    "reason": &reason
                }));
            }
        }
    }

    ApiResult::ok(json!({
        "dependencies": dependencies,
        "unresolved": unresolved,
        "target": {
            "gameVersion": target_game,
            "loaders": target_loaders
        },
        "source": if is_cf { "curseforge" } else { "modrinth" }
    }))
}

/// GET /api/mods/resolve-deps — 解析依赖（仅项目元信息，不查兼容版本）
/// 入参： ids（逗号分隔的 projectId 串）
/// 返回： { [projectId]: { id,title,icon,description,downloads } }
pub(crate) async fn handle_resolve_deps(params: &Option<Value>) -> ApiResult {
    let ids_str = params
        .as_ref()
        .and_then(|p| p.get("ids"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let source = params
        .as_ref()
        .and_then(|p| p.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("modrinth");
    let ids: Vec<String> = ids_str
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if ids.is_empty() {
        return ApiResult::ok(json!({}));
    }

    if source == "curseforge" {
        return resolve_cf_deps(&ids).await;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut result = serde_json::Map::new();

    // 批量查询项目信息
    let batch_url = format!("{}/projects?ids={}", MODRINTH_API, serde_json::to_string(&ids).unwrap_or_default());
    let batch_resp = client.get(&batch_url).send().await.ok();
    if let Some(resp) = batch_resp
        && resp.status().is_success()
            && let Ok(arr) = resp.json::<Vec<Value>>().await {
                for p in arr {
                    let pid = p.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if pid.is_empty() {
                        continue;
                    }
                    result.insert(pid.to_string(), json!({
                        "id": pid,
                        "title": p.get("title").and_then(|v| v.as_str()).unwrap_or(pid),
                        "icon": p.get("icon_url").and_then(|v| v.as_str()).unwrap_or(""),
                        "description": p.get("description").and_then(|v| v.as_str()).unwrap_or("").chars().take(100).collect::<String>(),
                        "downloads": p.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0)
                    }));
                }
            }

    // 批量失败或缺失时逐个兜底
    for id in &ids {
        if result.contains_key(id) {
            continue;
        }
        let url = format!("{}/project/{}", MODRINTH_API, id);
        if let Ok(resp) = client.get(&url).send().await
            && resp.status().is_success()
                && let Ok(p) = resp.json::<Value>().await {
                    let pid = p.get("id").and_then(|v| v.as_str()).unwrap_or(id.as_str());
                    result.insert(pid.to_string(), json!({
                        "id": pid,
                        "title": p.get("title").and_then(|v| v.as_str()).unwrap_or(id.as_str()),
                        "icon": p.get("icon_url").and_then(|v| v.as_str()).unwrap_or(""),
                        "description": p.get("description").and_then(|v| v.as_str()).unwrap_or("").chars().take(100).collect::<String>(),
                        "downloads": p.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0)
                    }));
                }
        // 仍然缺：补占位
        result.entry(id.clone()).or_insert(json!({
            "id": id,
            "title": id,
            "icon": "",
            "description": "",
            "downloads": 0
        }));
    }

    ApiResult::ok(Value::Object(result))
}

pub(crate) async fn resolve_cf_deps(ids: &[String]) -> ApiResult {
    let settings = storage::load_settings();
    let cf_api_key = settings
        .get("curseforgeApiKey")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_CF_API_KEY);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut result = serde_json::Map::new();
    let mut futures = Vec::new();
    for id in ids {
        let id = id.clone();
        let client = client.clone();
        let key = cf_api_key.to_string();
        futures.push(tokio::spawn(async move {
            let url = format!("{}/mods/{}", CURSEFORGE_API, urlencoding::encode(&id));
            let r = client.get(&url).header("x-api-key", key).send().await.ok()?;
            if !r.status().is_success() {
                return None;
            }
            let v: Value = r.json().await.ok()?;
            let p = v.get("data")?.clone();
            let pid = p.get("id").map(|i| i.to_string())?;
            let title = p.get("name")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| pid.clone());
            let logo = p.get("logo")
                .and_then(|l| l.get("thumbnailUrl"))
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            Some((pid.clone(), json!({
                "id": pid.clone(),
                "title": title,
                "slug": p.get("slug").and_then(|x| x.as_str()).unwrap_or(""),
                "icon": logo,
                "description": p.get("summary").and_then(|x| x.as_str()).unwrap_or("").chars().take(100).collect::<String>(),
                "downloads": p.get("downloadCount").and_then(|x| x.as_u64()).unwrap_or(0)
            })))
        }));
    }
    for f in futures {
        if let Ok(Some((pid, v))) = f.await {
            result.insert(pid, v);
        }
    }
    for id in ids {
        result.entry(id.clone()).or_insert(json!({
            "id": id,
            "title": id,
            "slug": "",
            "icon": "",
            "description": "",
            "downloads": 0
        }));
    }
    ApiResult::ok(Value::Object(result))
}

/// POST /api/mods/resolve-deps-versions — 解析依赖，并匹配每个前置在当前游戏版本/加载器下的兼容版本
/// 入参： ids（projectId 数组）、gameVersion、loader、source
/// 返回： { [projectId]: { id,title,slug,icon,description,downloads,hasCompatibleVersion,
///                          versionId,versionNumber,fileName,gameVersions,loaders } }
pub(crate) async fn handle_resolve_deps_versions(body: &Option<Value>) -> ApiResult {
    let data = body.clone().unwrap_or(Value::Null);
    let ids: Vec<String> = data
        .get("ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let game_version = data
        .get("gameVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let loader = data
        .get("loader")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let source = data
        .get("source")
        .and_then(|v| v.as_str())
        .unwrap_or("modrinth")
        .to_string();

    if ids.is_empty() {
        return ApiResult::ok(json!({}));
    }

    let is_cf = source.eq_ignore_ascii_case("curseforge");
    if !is_cf && !source.eq_ignore_ascii_case("modrinth") {
        return ApiResult::err(400, "Unsupported source");
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let settings = storage::load_settings();
    let cf_api_key = settings
        .get("curseforgeApiKey")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_CF_API_KEY)
        .to_string();
    let loaders = parse_loader_list(&loader);

    let mut resolve = serde_json::Map::new();

    for pid in &ids {
        let project =
            fetch_dep_project(&client, is_cf, pid, &game_version, &loaders, &cf_api_key).await;
        let entry = match project {
            Ok(project) => {
                let compatible = select_compatible_file(&project.files, &game_version, &loaders);
                let mut entry = json!({
                    "id": &project.id,
                    "title": &project.title,
                    "slug": &project.slug,
                    "icon": &project.icon,
                    "description": &project.description,
                    "downloads": project.downloads,
                    "hasCompatibleVersion": compatible.is_some(),
                    "versionId": "",
                    "versionNumber": "",
                    "fileName": "",
                    "gameVersions": [],
                    "loaders": []
                });
                if let (Some(file), Some(obj)) = (compatible, entry.as_object_mut()) {
                    obj.insert("versionId".to_string(), json!(&file.id));
                    obj.insert("versionNumber".to_string(), json!(&file.version_number));
                    obj.insert("fileName".to_string(), json!(&file.file_name));
                    obj.insert(
                        "gameVersions".to_string(),
                        Value::Array(file.game_versions.iter().map(|v| json!(v)).collect()),
                    );
                    obj.insert(
                        "loaders".to_string(),
                        Value::Array(file.loaders.iter().map(|v| json!(v)).collect()),
                    );
                }
                entry
            }
            Err(_) => json!({
                "id": pid,
                "title": pid,
                "slug": "",
                "icon": "",
                "description": "",
                "downloads": 0,
                "hasCompatibleVersion": false,
                "versionId": "",
                "versionNumber": "",
                "fileName": "",
                "gameVersions": [],
                "loaders": []
            }),
        };
        resolve.insert(pid.clone(), entry);
    }

    ApiResult::ok(Value::Object(resolve))
}

// ============== 管理路由 ==============
