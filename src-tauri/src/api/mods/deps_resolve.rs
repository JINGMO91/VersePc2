// api/mods/deps_resolve.rs — 依赖树解析与批量项目/版本解析路由
use std::collections::{HashSet, VecDeque};
use std::time::Duration;

use serde_json::{json, Value};

use crate::api::ApiResult;
use crate::storage;

use super::super::{MODRINTH_API, CURSEFORGE_API, DEFAULT_CF_API_KEY, MAX_DEPENDENCY_DEPTH};
use super::deps_fetch::{fetch_dep_project, fetch_dep_root};
use super::deps_parse::{body_string, derive_target, parse_loader_list, select_compatible_file};

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
