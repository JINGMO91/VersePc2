// api/mods/deps_fetch.rs — 依赖解析所需的远程请求（根版本、文件列表、项目信息）
use serde_json::Value;

use super::super::{MODRINTH_API, CURSEFORGE_API};
use super::deps_parse::{
    cf_file_loaders, cf_loader_id, json_string_array, parse_cf_dependencies, parse_cf_file,
    parse_modrinth_dependencies, parse_modrinth_file, DepFile, DepProject, DepRoot,
};

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
