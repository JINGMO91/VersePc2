// api/resources/detail.rs — 项目详情与版本列表
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha1::Digest;
use tauri::{AppHandle, Listener};
use tokio::sync::Mutex;

use crate::api::ApiResult;
use crate::download::{download_with_mirror, download_with_mirror_cancellable, resources_session};
use crate::modpack;
use crate::resource::{matcher, mcversion, wiki};
use crate::resource::matcher::SearchSource;
use crate::storage;

use super::{MODRINTH_API, MODRINTH_API_MIRROR, CURSEFORGE_API, CURSEFORGE_API_MIRROR, DEFAULT_CF_API_KEY, shared_client, cached_fetch_json, fetch_json_with_mirror};

/// GET /api/resources/detail — Modrinth 项目详情
///
/// 查询参数：
///   - projectId: Modrinth 项目 ID
pub(crate) async fn handle_detail(params: &Option<Value>) -> ApiResult {
    let project_id = params
        .as_ref()
        .and_then(|p| p.get("projectId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if project_id.is_empty() {
        return ApiResult::err(400, "Missing projectId");
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let url = format!("{}/project/{}", MODRINTH_API, project_id);
    eprintln!("[resources] 拉取详情: {}", url);

    let resp = match client.get(&url).header("Accept", "application/json").send().await {
        Ok(r) => r,
        Err(e) => return ApiResult::err(502, &format!("请求失败: {}", e)),
    };

    if !resp.status().is_success() {
        return ApiResult::err(502, &format!("Modrinth HTTP {}", resp.status()));
    }

    let project: Value = match resp.json().await {
        Ok(d) => d,
        Err(e) => return ApiResult::err(502, &format!("解析失败: {}", e)),
    };

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
                    // 走国内镜像，避免 cdn 图片在部分网络下加载失败
                    let mut raw_url = obj.get("raw_url").and_then(|u| u.as_str()).unwrap_or("").to_string();
                    let url_m = to_modrinth_cdn_mirror(&url);
                    raw_url = to_modrinth_cdn_mirror(&raw_url);
                    Some(json!({
                        "url": url_m,
                        "rawUrl": raw_url,
                        "title": obj.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "description": obj.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                        "created": obj.get("created").and_then(|v| v.as_str()).unwrap_or(""),
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut body_text = project.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
    body_text = to_modrinth_cdn_mirror(&body_text);

    let detail = json!({
        "id": project.get("id").and_then(|v| v.as_str()).unwrap_or(""),
        "slug": project.get("slug").and_then(|v| v.as_str()).unwrap_or(""),
        "title": project.get("title").and_then(|v| v.as_str()).unwrap_or(""),
        "description": project.get("description").and_then(|v| v.as_str()).unwrap_or(""),
        "body": body_text,
        "icon": to_modrinth_cdn_mirror(&project.get("icon_url").and_then(|v| v.as_str()).unwrap_or("")),
        "downloads": project.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0),
        "followers": project.get("followers").and_then(|v| v.as_u64()).unwrap_or(0),
        "categories": project.get("categories").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
        "loaders": project.get("loaders").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
        "gameVersions": project.get("game_versions").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
        "license": project.get("license").and_then(|l| l.get("name")).and_then(|n| n.as_str()).unwrap_or(""),
        "sourceUrl": project.get("source_url").and_then(|v| v.as_str()).unwrap_or(""),
        "dateCreated": project.get("published").and_then(|v| v.as_str()).unwrap_or(""),
        "dateModified": project.get("updated").and_then(|v| v.as_str()).unwrap_or(""),
        "gallery": gallery,
        "source": "modrinth",
        "projectType": project.get("project_type").and_then(|v| v.as_str()).unwrap_or("")
    });

    ApiResult::ok(detail)
}

/// GET /api/resources/versions — Modrinth 项目版本列表
///
/// 查询参数：
///   - projectId: Modrinth 项目 ID
///   - loader: 加载器过滤
///   - gameVersion: MC 版本过滤
pub(crate) async fn handle_versions(params: &Option<Value>) -> ApiResult {
    let project_id = params
        .as_ref()
        .and_then(|p| p.get("projectId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if project_id.is_empty() {
        return ApiResult::err(400, "Missing projectId");
    }
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

    if source == "curseforge" {
        return handle_versions_curseforge(&project_id).await;
    }
    if source != "modrinth" {
        // 其他来源暂不支持版本列表，返回空
        return ApiResult::ok(json!({ "versions": [] }));
    }

    let mut url = format!("{}/project/{}/version", MODRINTH_API, project_id);
    let mut query_parts: Vec<String> = Vec::new();
    if !loader.is_empty() {
        query_parts.push(format!("loaders=[\"{}\"]", loader));
    }
    if !game_ver.is_empty() {
        query_parts.push(format!("game_versions=[\"{}\"]", game_ver));
    }
    if !query_parts.is_empty() {
        url.push('?');
        url.push_str(&query_parts.join("&"));
    }

    eprintln!("[resources] 拉取版本: {}", url);

    let result = match fetch_json_with_mirror(&url, None).await {
        Ok(v) => v,
        Err(e) => return ApiResult::err(502, &format!("请求失败: {}", e)),
    };

    let versions: Vec<Value> = match result.as_array() {
        Some(arr) => arr.clone(),
        None => return ApiResult::err(502, "API返回格式异常"),
    };

    let result: Vec<Value> = versions
        .iter()
        .map(|v| {
            let files = v
                .get("files")
                .and_then(|f| f.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|f| {
                            json!({
                                "url": f.get("url").and_then(|u| u.as_str()).unwrap_or(""),
                                "filename": f.get("filename").and_then(|n| n.as_str()).unwrap_or(""),
                                "size": f.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
                                "primary": f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false),
                                "sha1": f.get("hashes").and_then(|h| h.get("sha1")).and_then(|s| s.as_str()).unwrap_or("")
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let deps = v
                .get("dependencies")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|d| {
                            json!({
                                "projectId": d.get("project_id").and_then(|p| p.as_str()).unwrap_or(""),
                                "versionId": d.get("version_id").and_then(|ver| ver.as_str()).unwrap_or(""),
                                "dependencyType": d.get("dependency_type").and_then(|t| t.as_str()).unwrap_or("")
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            json!({
                "id": v.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                "versionNumber": v.get("version_number").and_then(|n| n.as_str()).unwrap_or(""),
                "versionName": v.get("name").and_then(|n| n.as_str()).unwrap_or(v.get("version_number").and_then(|n| n.as_str()).unwrap_or("")),
                "gameVersions": v.get("game_versions").and_then(|g| g.as_array()).cloned().unwrap_or_default(),
                "loaders": v.get("loaders").and_then(|l| l.as_array()).cloned().unwrap_or_default(),
                "releaseType": v.get("version_type").and_then(|t| t.as_str()).unwrap_or("release"),
                "datePublished": v.get("date_published").and_then(|d| d.as_str()).unwrap_or(""),
                "downloads": v.get("downloads").and_then(|d| d.as_u64()).unwrap_or(0),
                "changelog": v.get("changelog").and_then(|c| c.as_str()).unwrap_or(""),
                "files": files,
                "dependencies": deps
            })
        })
        .collect();

    ApiResult::ok(json!({ "versions": result }))
}

/// 从 CurseForge 获取项目版本列表（采用通用 versions 结构）
/// 官方接口：GET /v1/mods/{modId}/files?pageSize=50
pub(crate) async fn handle_versions_curseforge(project_id: &str) -> ApiResult {
    let settings = storage::load_settings();
    let cf_api_key = settings
        .get("curseforgeApiKey")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_CF_API_KEY);

    let url = format!("{}/mods/{}/files?pageSize=50", CURSEFORGE_API, project_id);
    eprintln!("[resources][curseforge] 拉取版本: {}", url);

    let mut headers = reqwest::header::HeaderMap::new();
    if let Ok(v) = reqwest::header::HeaderValue::from_str(&cf_api_key) {
        headers.insert("x-api-key", v);
    }
    headers.insert("Accept", reqwest::header::HeaderValue::from_static("application/json"));

    let result = match cached_fetch_json(url, 60000, Some(&headers)).await {
        Ok(v) => v,
        Err(e) => return ApiResult::err(502, &format!("请求失败: {}", e)),
    };

    let files = result
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let versions: Vec<Value> = files
        .iter()
        .map(|f| {
            // CF 的 gameVersions 混有 "Client"/"Server" 和加载器，只保留 Minecraft 版本号
            let game_versions: Vec<Value> = f
                .get("gameVersions")
                .and_then(|g| g.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter(|gv| {
                            if let Some(s) = gv.as_str() {
                                let low = s.to_lowercase();
                                if low.contains("snapshot") || low.contains("client") || low.contains("server") {
                                    return false;
                                }
                                if low == "forge" || low == "fabric" || low == "neoforge" || low == "quilt" {
                                    return false;
                                }
                                // 形如 1.19.2 / 1.21 / 24w14a
                                s.starts_with(|c: char| c.is_ascii_digit())
                            } else {
                                false
                            }
                        })
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();

            // 从原始 gameVersions 中提取加载器
            let loaders: Vec<Value> = f
                .get("gameVersions")
                .and_then(|g| g.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|gv| {
                            let s = gv.as_str()?.to_lowercase();
                            if s == "forge" || s == "fabric" || s == "neoforge" || s == "quilt" {
                                Some(Value::String(s))
                            } else {
                                None
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();

            // CF releaseType: 1=Release, 2=Beta, 3=Alpha
            let release_type = match f.get("releaseType").and_then(|r| r.as_u64()).unwrap_or(1) {
                2 => "beta",
                3 => "alpha",
                _ => "release",
            };

            let file_id = f.get("id").map(|i| i.to_string()).unwrap_or_default();
            let files_arr = json!([{
                "id": file_id,
                "url": f.get("downloadUrl").and_then(|u| u.as_str()).unwrap_or(""),
                "filename": f.get("fileName").and_then(|n| n.as_str()).unwrap_or(""),
                "size": f.get("fileLength").and_then(|s| s.as_u64()).unwrap_or(0),
                "primary": true,
                "sha1": f.get("hashes").and_then(|h| h.get("sha1")).and_then(|s| s.as_str()).unwrap_or(""),
                "datePublished": f.get("fileDate").and_then(|d| d.as_str()).unwrap_or(""),
                "releaseType": release_type
            }]);

            let deps: Vec<Value> = f
                .get("dependencies")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|d| {
                            json!({
                                "projectId": d.get("modId").map(|m| m.to_string()).unwrap_or_default(),
                                "versionId": d.get("fileId").map(|m| m.to_string()).unwrap_or_default(),
                                "dependencyType": d.get("relationType").map(|m| m.to_string()).unwrap_or_default()
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            json!({
                "id": file_id,
                "versionNumber": f.get("fileName").and_then(|n| n.as_str()).unwrap_or(""),
                "versionName": f.get("displayName").and_then(|n| n.as_str()).unwrap_or(""),
                "gameVersions": game_versions,
                "loaders": loaders,
                "releaseType": release_type,
                "datePublished": f.get("fileDate").and_then(|d| d.as_str()).unwrap_or(""),
                "downloads": 0,
                "changelog": "",
                "files": files_arr,
                "dependencies": deps
            })
        })
        .collect();

    ApiResult::ok(json!({ "versions": versions }))
}

/// 将 Modrinth CDN 图片地址替换为国内镜像，避免 cdn.modrinth.com / cdn-alt.modrinth.com
/// 在部分网络环境下连接缓慢或被重置导致图片加载失败。
/// 对 markdown 正文（body）中内嵌的图片链接同样生效。
pub(crate) fn to_modrinth_cdn_mirror(url: &str) -> String {
    if url.contains("cdn.modrinth.com") {
        url.replace("cdn.modrinth.com", "mod.mcimirror.top")
    } else if url.contains("cdn-alt.modrinth.com") {
        url.replace("cdn-alt.modrinth.com", "mod.mcimirror.top")
    } else {
        url.to_string()
    }
}
