// api/mods/project.rs — 模组详情、版本列表与下载
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use crate::api::ApiResult;
use crate::download::{download_with_mirror_cancellable, resources_session};
use crate::storage;

use super::{MODRINTH_API, CURSEFORGE_API, DEFAULT_CF_API_KEY, MODRINTH_BUNDLED_DEPS, CURSEFORGE_BUNDLED_DEPS};

/// GET /api/mods/project-versions — 项目版本列表（兼容旧路径）
pub(crate) async fn handle_project_versions(params: &Option<Value>) -> ApiResult {
    handle_versions(params).await
}

/// GET /api/mods/detail — 模组详情
pub(crate) async fn handle_detail(params: &Option<Value>) -> ApiResult {
    let project_id = params
        .as_ref()
        .and_then(|p| p.get("projectId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let source = params
        .as_ref()
        .and_then(|p| p.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("modrinth");

    if project_id.is_empty() {
        return ApiResult::err(400, "Missing projectId");
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    if source == "modrinth" {
        let url = format!("{}/project/{}", MODRINTH_API, project_id);
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<Value>().await {
                    Ok(project) => {
                        let gallery = project
                            .get("gallery")
                            .and_then(|g| g.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|g| {
                                        let obj = match g.as_object() {
                                            Some(o) => o,
                                            None => return None,
                                        };
                                        let url = obj
                                            .get("url")
                                            .and_then(|u| u.as_str())
                                            .unwrap_or("")
                                            .to_string();
                                        if url.is_empty() {
                                            return None;
                                        }
                                        Some(json!({
                                            "url": url,
                                            "rawUrl": obj.get("raw_url").and_then(|u| u.as_str()).unwrap_or(""),
                                            "title": obj.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                                            "description": obj.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                                            "created": obj.get("created").and_then(|v| v.as_str()).unwrap_or(""),
                                        }))
                                    })
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        let detail = json!({
                            "id": project.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                            "slug": project.get("slug").and_then(|v| v.as_str()).unwrap_or(""),
                            "title": project.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                            "description": project.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                            "body": project.get("body").and_then(|v| v.as_str()).unwrap_or(""),
                            "icon": project.get("icon_url").and_then(|v| v.as_str()).unwrap_or(""),
                            "downloads": project.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0),
                            "followers": project.get("followers").and_then(|v| v.as_u64()).unwrap_or(0),
                            "categories": project.get("categories").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
                            "loaders": project.get("loaders").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
                            "gameVersions": project.get("game_versions").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
                            "clientSide": project.get("client_side").and_then(|v| v.as_str()).unwrap_or("unknown"),
                            "serverSide": project.get("server_side").and_then(|v| v.as_str()).unwrap_or("unknown"),
                            "license": project.get("license").and_then(|l| l.get("name")).and_then(|n| n.as_str()).unwrap_or(""),
                            "sourceUrl": project.get("source_url").and_then(|v| v.as_str()).unwrap_or(""),
                            "issuesUrl": project.get("issues_url").and_then(|v| v.as_str()).unwrap_or(""),
                            "wikiUrl": project.get("wiki_url").and_then(|v| v.as_str()).unwrap_or(""),
                            "discordUrl": project.get("discord_url").and_then(|v| v.as_str()).unwrap_or(""),
                            "dateCreated": project.get("published").and_then(|v| v.as_str()).unwrap_or(""),
                            "dateModified": project.get("updated").and_then(|v| v.as_str()).unwrap_or(""),
                            "gallery": gallery,
                            "source": "modrinth"
                        });
                        ApiResult::ok(detail)
                    }
                    Err(e) => ApiResult::err(502, &format!("解析失败: {}", e)),
                }
            }
            Ok(resp) => ApiResult::err(502, &format!("Modrinth HTTP {}", resp.status())),
            Err(e) => ApiResult::err(502, &format!("请求失败: {}", e)),
        }
    } else if source == "curseforge" {
        let settings = storage::load_settings();
        let cf_api_key = settings
            .get("curseforgeApiKey")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_CF_API_KEY);
        let url = format!("{}/mods/{}", CURSEFORGE_API, project_id);
        match client.get(&url).header("x-api-key", cf_api_key).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<Value>().await {
                    Ok(result) => {
                        let m = result.get("data").unwrap_or(&result);
                        let categories = m
                            .get("categories")
                            .and_then(|c| c.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .map(|c| {
                                        if let Some(s) = c.as_str() {
                                            s.to_string()
                                        } else {
                                            c.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string()
                                        }
                                    })
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        let loaders = m
                            .get("latestFilesIndexes")
                            .and_then(|l| l.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|f| {
                                        f.get("modLoader").and_then(|ml| ml.as_u64()).and_then(|id| match id {
                                            1 => Some("forge"),
                                            4 => Some("fabric"),
                                            5 => Some("quilt"),
                                            6 => Some("neoforge"),
                                            _ => None,
                                        })
                                    })
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        let game_versions = m
                            .get("latestFilesIndexes")
                            .and_then(|l| l.as_array())
                            .map(|arr| {
                                let mut set = std::collections::HashSet::new();
                                for f in arr {
                                    if let Some(v) = f.get("gameVersion").and_then(|g| g.as_str()) {
                                        set.insert(v.to_string());
                                    }
                                }
                                set.into_iter().collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        let detail = json!({
                            "id": m.get("id").map(|i| i.to_string()).unwrap_or_default(),
                            "slug": m.get("slug").and_then(|v| v.as_str()).unwrap_or(""),
                            "title": m.get("name").and_then(|v| v.as_str()).unwrap_or("Unknown"),
                            "description": m.get("summary").and_then(|v| v.as_str()).unwrap_or(""),
                            "body": m.get("description").and_then(|v| v.as_str()).unwrap_or(m.get("summary").and_then(|v| v.as_str()).unwrap_or("")),
                            "icon": m.get("logo").and_then(|l| l.get("url")).and_then(|u| u.as_str()).unwrap_or(""),
                            "downloads": m.get("downloadCount").and_then(|v| v.as_u64()).unwrap_or(0),
                            "followers": m.get("followers").and_then(|v| v.as_u64()).unwrap_or(0),
                            "categories": categories,
                            "loaders": loaders,
                            "gameVersions": game_versions,
                            "clientSide": "unknown",
                            "serverSide": "unknown",
                            "license": "",
                            "sourceUrl": m.get("links").and_then(|l| l.get("sourceUrl")).and_then(|u| u.as_str()).unwrap_or(""),
                            "issuesUrl": m.get("links").and_then(|l| l.get("issuesUrl")).and_then(|u| u.as_str()).unwrap_or(""),
                            "wikiUrl": m.get("links").and_then(|l| l.get("wikiUrl")).and_then(|u| u.as_str()).unwrap_or(""),
                            "discordUrl": "",
                            "dateCreated": m.get("dateCreated").and_then(|v| v.as_str()).unwrap_or(""),
                            "dateModified": m.get("dateModified").and_then(|v| v.as_str()).unwrap_or(""),
                            "gallery": m.get("screenshots").and_then(|s| s.as_array()).map(|arr| arr.iter().map(|s| s.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string()).collect::<Vec<_>>()).unwrap_or_default(),
                            "source": "curseforge"
                        });
                        ApiResult::ok(detail)
                    }
                    Err(e) => ApiResult::err(502, &format!("解析失败: {}", e)),
                }
            }
            Ok(resp) => ApiResult::err(502, &format!("CurseForge HTTP {}", resp.status())),
            Err(e) => ApiResult::err(502, &format!("请求失败: {}", e)),
        }
    } else {
        ApiResult::err(400, "Unsupported source")
    }
}

/// GET /api/mods/versions — 模组版本列表
pub(crate) async fn handle_versions(params: &Option<Value>) -> ApiResult {
    let project_id = params
        .as_ref()
        .and_then(|p| p.get("projectId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let source = params
        .as_ref()
        .and_then(|p| p.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("modrinth");
    let loader = params
        .as_ref()
        .and_then(|p| p.get("loader"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let game_ver = params
        .as_ref()
        .and_then(|p| p.get("gameVersion"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if project_id.is_empty() {
        return ApiResult::err(400, "Missing projectId");
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    if source == "modrinth" {
        let mut url = format!("{}/project/{}/version", MODRINTH_API, project_id);
        let mut params_list: Vec<String> = Vec::new();
        if !loader.is_empty() {
            params_list.push(format!("loaders=[\"{}\"]", loader));
        }
        if !game_ver.is_empty() {
            params_list.push(format!("game_versions=[\"{}\"]", game_ver));
        }
        if !params_list.is_empty() {
            url.push('?');
            url.push_str(&params_list.join("&"));
        }

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<Vec<Value>>().await {
                    Ok(versions_raw) => {
                        let versions: Vec<Value> = versions_raw
                            .iter()
                            .map(|v| {
                                let files = v.get("files").and_then(|f| f.as_array()).map(|arr| {
                                    arr.iter()
                                        .map(|f| {
                                            json!({
                                                "url": f.get("url").and_then(|u| u.as_str()).unwrap_or(""),
                                                "filename": f.get("filename").and_then(|n| n.as_str()).unwrap_or(""),
                                                "primary": f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false),
                                                "size": f.get("size").and_then(|s| s.as_u64()).unwrap_or(0)
                                            })
                                        })
                                        .collect::<Vec<_>>()
                                }).unwrap_or_default();
                                json!({
                                    "id": v.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                                    "name": v.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                                    "versionNumber": v.get("version_number").and_then(|n| n.as_str()).unwrap_or(""),
                                    "gameVersions": v.get("game_versions").and_then(|g| g.as_array()).cloned().unwrap_or_default(),
                                    "loaders": v.get("loaders").and_then(|l| l.as_array()).cloned().unwrap_or_default(),
                                    "releaseType": v.get("version_type").and_then(|t| t.as_str()).unwrap_or("release"),
                                    "datePublished": v.get("date_published").and_then(|d| d.as_str()).unwrap_or(""),
                                    "downloads": v.get("downloads").and_then(|d| d.as_u64()).unwrap_or(0),
                                    "changelog": v.get("changelog").and_then(|c| c.as_str()).unwrap_or(""),
                                    "files": files,
                                    "dependencies": v.get("dependencies").and_then(|d| d.as_array()).map(|arr| {
                                        arr.iter().filter_map(|de| {
                                            let pid = de.get("project_id").and_then(|p| p.as_str()).unwrap_or("");
                                            if pid.is_empty() || MODRINTH_BUNDLED_DEPS.contains(&pid) {
                                                return None;
                                            }
                                            Some(json!({
                                                "projectId": pid,
                                                "versionId": de.get("version_id").and_then(|x| x.as_str()).unwrap_or(""),
                                                "fileName": de.get("file_name").and_then(|x| x.as_str()).unwrap_or(""),
                                                "dependencyType": de.get("dependency_type").and_then(|x| x.as_str()).unwrap_or("")
                                            }))
                                        }).collect::<Vec<_>>()
                                    }).unwrap_or_default()
                                })
                            })
                            .collect();
                        ApiResult::ok(json!({ "versions": versions }))
                    }
                    Err(e) => ApiResult::err(502, &format!("解析失败: {}", e)),
                }
            }
            Ok(resp) => ApiResult::err(502, &format!("Modrinth HTTP {}", resp.status())),
            Err(e) => ApiResult::err(502, &format!("请求失败: {}", e)),
        }
    } else if source == "curseforge" {
        let settings = storage::load_settings();
        let cf_api_key = settings
            .get("curseforgeApiKey")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_CF_API_KEY);

        // CurseForge 版本列表接口
        let mut url = format!("{}/mods/{}/files?pageSize=50", CURSEFORGE_API, project_id);
        if !game_ver.is_empty() {
            url.push_str(&format!("&gameVersion={}", urlencoding::encode(game_ver)));
        }
        if !loader.is_empty() {
            let loader_id = match loader.to_lowercase().as_str() {
                "forge" => "1",
                "fabric" => "4",
                "neoforge" => "6",
                "quilt" => "5",
                _ => "",
            };
            if !loader_id.is_empty() {
                url.push_str(&format!("&modLoaderType={}", loader_id));
            }
        }

        match client.get(&url).header("x-api-key", cf_api_key).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<Value>().await {
                    Ok(result) => {
                        let files = result
                            .get("data")
                            .and_then(|d| d.as_array())
                            .cloned()
                            .unwrap_or_default();
                        let versions: Vec<Value> = files
                            .iter()
                            .map(|f| {
                                let mut loaders: Vec<String> = f
                                    .get("modLoaders")
                                    .and_then(|l| l.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|ml| {
                                                ml.get("modLoader").and_then(|id| id.as_u64()).and_then(|id| match id {
                                                    1 => Some("forge".to_string()),
                                                    4 => Some("fabric".to_string()),
                                                    5 => Some("quilt".to_string()),
                                                    6 => Some("neoforge".to_string()),
                                                    _ => None,
                                                })
                                            })
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                if loaders.is_empty()
                                    && let Some(arr) = f.get("gameVersions").and_then(|g| g.as_array()) {
                                        for gv in arr {
                                            if let Some(s) = gv.as_str() {
                                                let low = s.to_lowercase();
                                                if (low == "forge" || low == "fabric" || low == "neoforge" || low == "quilt")
                                                    && !loaders.contains(&low) {
                                                        loaders.push(low);
                                                    }
                                            }
                                        }
                                    }
                                let files_arr: Vec<Value> = f
                                    .get("fileName")
                                    .and_then(|n| n.as_str())
                                    .map(|name| {
                                        vec![json!({
                                            "url": f.get("downloadUrl").and_then(|u| u.as_str()).unwrap_or(""),
                                            "filename": name,
                                            "primary": true,
                                            "size": f.get("fileLength").and_then(|s| s.as_u64()).unwrap_or(0)
                                        })]
                                    })
                                    .unwrap_or_default();
                                let release_type = match f.get("releaseType").and_then(|t| t.as_u64()).unwrap_or(1) {
                                    2 => "beta",
                                    3 => "alpha",
                                    _ => "release",
                                };
                                let deps: Vec<Value> = f
                                    .get("dependencies")
                                    .and_then(|d| d.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|d| {
                                                let rel = d.get("relationType").and_then(|x| x.as_u64()).unwrap_or(0);
                                                // CurseForge: 3=必需, 2=可选, 5=冲突；1/4/6 为内嵌库/工具/包含项，不展示
                                                let dep_type = match rel {
                                                    3 => "required",
                                                    2 => "optional",
                                                    5 => "incompatible",
                                                    _ => return None,
                                                };
                                                let mod_id = d.get("modId").and_then(|m| m.as_u64()).unwrap_or(0);
                                                if CURSEFORGE_BUNDLED_DEPS.contains(&mod_id) {
                                                    return None;
                                                }
                                                Some(json!({
                                                    "projectId": mod_id.to_string(),
                                                    "versionId": d.get("fileId").map(|m| m.to_string()).unwrap_or_default(),
                                                    "dependencyType": dep_type,
                                                    "fileName": d.get("fileName").and_then(|x| x.as_str()).unwrap_or("")
                                                }))
                                            })
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                json!({
                                    "id": f.get("id").map(|i| i.to_string()).unwrap_or_default(),
                                    "name": f.get("displayName").and_then(|n| n.as_str()).or_else(|| f.get("fileName").and_then(|n| n.as_str())).unwrap_or(""),
                                    "versionNumber": f.get("fileName").and_then(|n| n.as_str()).unwrap_or(""),
                                    "gameVersions": f.get("gameVersions").and_then(|g| g.as_array()).cloned().unwrap_or_default(),
                                    "loaders": loaders,
                                    "releaseType": release_type,
                                    "datePublished": f.get("fileDate").and_then(|d| d.as_str()).unwrap_or(""),
                                    "downloads": f.get("downloadCount").and_then(|d| d.as_u64()).unwrap_or(0),
                                    "changelog": f.get("changelog").and_then(|c| c.as_str()).unwrap_or(""),
                                    "files": files_arr,
                                    "dependencies": deps
                                })
                            })
                            .collect();
                        ApiResult::ok(json!({ "versions": versions }))
                    }
                    Err(e) => ApiResult::err(502, &format!("解析失败: {}", e)),
                }
            }
            Ok(resp) => ApiResult::err(502, &format!("CurseForge HTTP {}", resp.status())),
            Err(e) => ApiResult::err(502, &format!("请求失败: {}", e)),
        }
    } else {
        ApiResult::err(400, "Unsupported source")
    }
}

// ============== 下载路由 ==============

/// POST /api/mods/download — 下载模组
pub(crate) async fn handle_download(body: &Option<Value>) -> ApiResult {
    let project_id = body
        .as_ref()
        .and_then(|b| b.get("projectId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let source = body
        .as_ref()
        .and_then(|b| b.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("modrinth")
        .to_string();
    let loader = body
        .as_ref()
        .and_then(|b| b.get("loader"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mc_version = body
        .as_ref()
        .and_then(|b| b.get("mcVersion"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let version_id = body
        .as_ref()
        .and_then(|b| b.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let settings = storage::load_settings();
    // 前端选择的保存路径（默认模组路径）。优先使用它作为 mods 目录，
    // 未传时才按当前选中版本自动定位到该实例的 mods 文件夹。
    let save_path = body
        .as_ref()
        .and_then(|b| b.get("savePath"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);

    if project_id.is_empty() {
        return ApiResult::err(400, "Missing projectId");
    }

    // 确定目标 mods 目录：优先前端选择的路径，其次按当前选中版本自动定位
    let mods_dir = if let Some(sp) = save_path {
        sp
    } else {
        match resolve_mods_dir(&settings, &version_id, &mc_version) {
            Some(d) => d,
            None => return ApiResult::err(400, "请先安装一个游戏版本"),
        }
    };

    if let Err(e) = std::fs::create_dir_all(&mods_dir) {
        return ApiResult::err(500, &format!("创建 mods 目录失败: {}", e));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // 拉取版本信息
    let (download_url, file_name, file_size, expected_sha1) = if source == "modrinth" {
        // 获取版本信息：优先按 version_id，否则按 projectId + loader/mc_version 过滤
        let version_data: Option<Value> = if !version_id.is_empty() {
            // 指定版本 ID：Modrinth /version/{id} 返回单个对象（不是数组）
            let url = format!("{}/version/{}", MODRINTH_API, version_id);
            match client.get(&url).send().await {
                Ok(r) if r.status().is_success() => r.json().await.ok(),
                _ => None,
            }
        } else {
            // 按 loader / mc_version 过滤查询版本列表
            let version_url = format!("{}/project/{}/version", MODRINTH_API, project_id);
            let url = if !loader.is_empty() && !mc_version.is_empty() {
                format!("{}?loaders=[\"{}\"]&game_versions=[\"{}\"]", version_url, loader, mc_version)
            } else if !loader.is_empty() {
                format!("{}?loaders=[\"{}\"]", version_url, loader)
            } else if !mc_version.is_empty() {
                format!("{}?game_versions=[\"{}\"]", version_url, mc_version)
            } else {
                format!("{}?limit=1", version_url)
            };
            let versions: Vec<Value> = match client.get(&url).send().await {
                Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
                _ => Vec::new(),
            };
            // 客户端二次过滤：确保 MC 版本和 loader 都匹配，过滤为空时回退到第一个
            if !mc_version.is_empty() || !loader.is_empty() {
                versions
                    .iter()
                    .find(|v| {
                        let gv: Vec<String> = v.get("game_versions").and_then(|g| g.as_array())
                            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                        let lds: Vec<String> = v.get("loaders").and_then(|g| g.as_array())
                            .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_lowercase())).collect()).unwrap_or_default();
                        let mut ok = true;
                        if !mc_version.is_empty() && !gv.contains(&mc_version) { ok = false; }
                        if !loader.is_empty() && !lds.contains(&loader.to_lowercase()) { ok = false; }
                        ok
                    })
                    .cloned()
                    .or_else(|| versions.first().cloned())
            } else {
                versions.first().cloned()
            }
        };

        let first = match version_data {
            Some(v) => v,
            None => return ApiResult::err(502, "未找到可用版本"),
        };
        let files = first.get("files").and_then(|f| f.as_array());
        let primary_file = files
            .and_then(|arr| arr.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false)))
            .or_else(|| files.and_then(|arr| arr.first()));

        if let Some(f) = primary_file {
            (
                f.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string(),
                f.get("filename").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                f.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
                f.get("hashes").and_then(|h| h.get("sha1")).and_then(|s| s.as_str()).unwrap_or("").to_string(),
            )
        } else {
            return ApiResult::err(502, "未找到下载文件");
        }
    } else {
        // CurseForge：通过 fileId 获取文件下载信息
        let settings = storage::load_settings();
        let cf_api_key = settings
            .get("curseforgeApiKey")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_CF_API_KEY);

        // version_id 即 CurseForge 的 file id
        let file_id = if !version_id.is_empty() {
            version_id.clone()
        } else {
            // 未指定 file id 时，查最新文件
            let files_url = format!("{}/mods/{}/files?pageSize=1", CURSEFORGE_API, project_id);
            let list_resp = client.get(&files_url).header("x-api-key", cf_api_key).send().await;
            match list_resp {
                Ok(r) if r.status().is_success() => {
                    let v: Value = r.json().await.unwrap_or_default();
                    v.pointer("/data/0/id").and_then(|i| i.as_u64()).map(|i| i.to_string()).unwrap_or_default()
                }
                _ => String::new(),
            }
        };

        if file_id.is_empty() {
            return ApiResult::err(502, "未找到可用版本");
        }

        let file_url = format!("{}/mods/{}/files/{}", CURSEFORGE_API, project_id, file_id);
        let file_resp = client.get(&file_url).header("x-api-key", cf_api_key).send().await;
        match file_resp {
            Ok(r) if r.status().is_success() => {
                let v: Value = r.json().await.unwrap_or_default();
                let f = v.get("data").unwrap_or(&v);
                let download_url = f.get("downloadUrl").and_then(|u| u.as_str()).unwrap_or("").to_string();
                let file_name = f.get("fileName").and_then(|n| n.as_str()).unwrap_or("").to_string();
                let file_size = f.get("fileLength").and_then(|s| s.as_u64()).unwrap_or(0);
                let sha1 = f.pointer("/hashes/0/value").and_then(|s| s.as_str()).unwrap_or("").to_string();
                if download_url.is_empty() {
                    return ApiResult::err(502, "未找到下载文件");
                }
                (download_url, file_name, file_size, sha1)
            }
            Ok(resp) => return ApiResult::err(502, &format!("CurseForge HTTP {}", resp.status())),
            Err(e) => return ApiResult::err(502, &format!("请求失败: {}", e)),
        }
    };

    if download_url.is_empty() {
        return ApiResult::err(502, "下载链接为空");
    }

    // 安全文件名
    let safe_name: String = file_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();
    let final_name = if safe_name.is_empty() {
        format!("{}.jar", project_id)
    } else {
        safe_name
    };
    let dest_path = mods_dir.join(&final_name);

    // 创建下载会话
    let (session_id, cancel_flag) = resources_session::create_session(
        &final_name,
        file_size,
        "mod",
        &project_id,
    );

    eprintln!(
        "[mods] 开始下载: {} → {} (sha1={})",
        download_url,
        dest_path.display(),
        if expected_sha1.is_empty() { "(none)" } else { &expected_sha1 }
    );

    // spawn 后台下载任务
    let session_id_for_progress = session_id.clone();
    let session_id_for_task = session_id.clone();
    let download_source = settings
        .get("downloadSource")
        .and_then(|v| v.as_str())
        .unwrap_or("auto")
        .to_string();
    let expected_sha1_task = expected_sha1.clone();

    tokio::spawn(async move {
        let progress_session_id = session_id_for_progress.clone();
        let on_progress: crate::download::ProgressCb = std::sync::Arc::new(move |p: &crate::download::DownloadProgress| {
            let pct = if p.total_bytes > 0 {
                ((p.bytes_downloaded as f64 / p.total_bytes as f64) * 100.0) as u32
            } else {
                0
            };
            resources_session::update_session_silent(&progress_session_id, |s| {
                if s.status == resources_session::ResourceStage::Cancelled {
                    return;
                }
                s.progress = pct;
                s.download_speed = p.speed;
                s.bytes_downloaded = p.bytes_downloaded;
                s.total_size = p.total_bytes;
                s.downloaded = p.bytes_downloaded;
                let speed_kb = if p.speed > 0 { p.speed / 1024 } else { 0 };
                s.message = format!("下载 {} {}% ({}KB/s)", s.file_name, pct, speed_kb);
                if !s.files.is_empty() {
                    s.files[0].progress = pct;
                    s.files[0].size = p.total_bytes;
                }
            });
        });

        let result = download_with_mirror_cancellable(
            &download_url,
            &dest_path,
            if expected_sha1_task.is_empty() { None } else { Some(&expected_sha1_task) },
            if file_size > 0 { Some(file_size) } else { None },
            &download_source,
            300,
            Some(on_progress),
            &cancel_flag,
        )
        .await;

        match result {
            Ok(()) => {
                resources_session::update_session_silent(&session_id_for_task, |s| {
                    s.status = resources_session::ResourceStage::Completed;
                    s.progress = 100;
                    s.message = format!("{} 下载完成！", s.file_name);
                    if !s.files.is_empty() {
                        s.files[0].status = "completed".to_string();
                        s.files[0].progress = 100;
                    }
                });
            }
            Err(e) => {
                if resources_session::is_cancelled(&cancel_flag) {
                    resources_session::update_session_silent(&session_id_for_task, |s| {
                        s.status = resources_session::ResourceStage::Cancelled;
                        s.progress = 100;
                        s.message = "下载已取消".to_string();
                        s.phase = "cancelled".to_string();
                    });
                } else {
                    eprintln!("[mods] 下载失败: {}", e);
                    resources_session::update_session_silent(&session_id_for_task, |s| {
                        s.status = resources_session::ResourceStage::Failed;
                        s.message = format!("下载失败: {}", e);
                        if !s.files.is_empty() {
                            s.files[0].status = "failed".to_string();
                        }
                    });
                }
            }
        }

        // 60 秒后清理会话
        let sid = session_id_for_task.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(60)).await;
            resources_session::remove_session(&sid);
        });
    });

    ApiResult::ok(json!({
        "success": true,
        "sessionId": session_id,
        "fileName": final_name
    }))
}

/// POST /api/mods/download-version — 下载指定版本
pub(crate) async fn handle_download_version(body: &Option<Value>) -> ApiResult {
    // 复用 handle_download 的逻辑，但 versionId 必填
    handle_download(body).await
}

/// GET /api/mods/download-status — 下载状态查询
pub(crate) fn handle_download_status(params: &Option<Value>) -> ApiResult {
    let session_id = params
        .as_ref()
        .and_then(|p| p.get("sessionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if session_id.is_empty() {
        return ApiResult::err(400, "Missing sessionId");
    }

    match resources_session::get_session_status(session_id) {
        Some(status) => ApiResult::ok(status),
        None => ApiResult::err(404, "会话不存在或已过期"),
    }
}

// ============== 依赖路由 ==============

/// 解析 mods 目录
pub(crate) fn resolve_mods_dir(settings: &Value, version_id: &str, _mc_version: &str) -> Option<PathBuf> {
    let data_dir = storage::resolve_data_dir();
    let versions_dir = data_dir.join("versions");

    // 优先用指定的 versionId（须是已安装的版本目录，否则视为无效，
    // 回退到 selectedVersion —— 防止把 Modrinth 文件 ID 等误当版本 ID 定位）
    let vid = if !version_id.is_empty() {
        let cand = versions_dir.join(version_id);
        if cand.is_dir() {
            version_id.to_string()
        } else {
            settings
                .get("selectedVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        }
    } else {
        // 否则用 selectedVersion
        settings
            .get("selectedVersion")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    if vid.is_empty() {
        // 最后兜底：扫描 versions 目录找第一个已安装的
        if !versions_dir.exists() {
            return None;
        }
        if let Ok(entries) = std::fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    // 跳过特殊目录
                    if name.starts_with('.') || name == "version-settings.json" {
                        continue;
                    }
                    let game_dir = crate::launch::args_builder::resolve_game_dir(
                        &name,
                        None,
                        None,
                        settings,
                        &versions_dir,
                        &data_dir,
                    );
                    return Some(game_dir.join("mods"));
                }
            }
        }
        return None;
    }

    // 与游戏启动时完全一致的游戏目录判定（含各版本独立的隔离设置）
    let game_dir = crate::launch::args_builder::resolve_game_dir(
        &vid,
        None,
        None,
        settings,
        &versions_dir,
        &data_dir,
    );
    Some(game_dir.join("mods"))
}
