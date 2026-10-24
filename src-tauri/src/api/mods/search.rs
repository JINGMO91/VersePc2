// api/mods/search.rs — 模组列表、图标、分类、推荐与双源搜索
use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::api::ApiResult;
use crate::download::{download_with_mirror, download_with_mirror_cancellable, resources_session};
use crate::mods;
use crate::resource::wiki;
use crate::storage;

use super::{MODRINTH_API, CURSEFORGE_API, DEFAULT_CF_API_KEY, MAX_DEPENDENCY_DEPTH, MODRINTH_BUNDLED_DEPS, CURSEFORGE_BUNDLED_DEPS};

/// GET /api/mods — 已安装模组列表
pub(crate) async fn handle_list() -> ApiResult {
    let mut result = mods::get_installed_mods();
    if let Some(mods_arr) = result.get_mut("mods") {
        enrich_online_icons(mods_arr).await;
    }
    ApiResult::ok(result)
}

/// GET /api/mod-icon — 模组图标
pub(crate) fn handle_icon(params: &Option<Value>) -> ApiResult {
    let hash = params
        .as_ref()
        .and_then(|p| p.get("hash"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if hash.is_empty() {
        return ApiResult::err(400, "Missing hash");
    }

    let icon_path = storage::resolve_data_dir()
        .join("icon-cache")
        .join(format!("{}.png", hash));

    if !icon_path.exists() {
        return ApiResult::err(404, "图标不存在");
    }

    match std::fs::read(&icon_path) {
        Ok(data) => {
            // 图标缓存字节可能是 PNG/WebP/JPEG 等任意格式（JAR 内图标常为 WebP），
            // 按文件魔数识别真实 MIME，避免以 image/png 声明导致浏览器解码失败显示破损图
            let mime = detect_image_mime(&data);
            let data_url = crate::utils::bytes_to_data_url(&data, &mime);
            ApiResult::ok(json!({ "dataUrl": data_url }))
        }
        Err(e) => ApiResult::err(500, &format!("读取图标失败: {}", e)),
    }
}

/// 按魔数识别图片真实格式并返回 MIME 类型
pub(crate) fn detect_image_mime(data: &[u8]) -> String {
    if data.len() >= 8 && &data[0..4] == b"\x89PNG" {
        return "image/png".to_string();
    }
    if data.len() >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
        return "image/jpeg".to_string();
    }
    if data.len() >= 6 && &data[0..6] == b"GIF87a" || (data.len() >= 6 && &data[0..6] == b"GIF89a") {
        return "image/gif".to_string();
    }
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return "image/webp".to_string();
    }
    if data.len() >= 12 && &data[4..8] == b"ftyp" {
        return "image/avif".to_string();
    }
    if data.len() >= 4 && data[0] == 0x00 && data[1] == 0x00 && data[2] == 0x01 && data[3] == 0x00 {
        return "image/x-icon".to_string();
    }
    if data.len() >= 2 && data[0] == 0x42 && data[1] == 0x4D {
        return "image/bmp".to_string();
    }
    "image/png".to_string()
}

/// GET /api/mods/open-save-folder — 打开存档文件夹
pub(crate) fn handle_open_save_folder(params: &Option<Value>) -> ApiResult {
    let version_id = params
        .as_ref()
        .and_then(|p| p.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let saves_dir = mods::resolve_saves_dir(version_id);
    if !saves_dir.exists() {
        let _ = std::fs::create_dir_all(&saves_dir);
    }
    let _ = open::that(&saves_dir);
    ApiResult::ok(json!({ "success": true, "path": saves_dir.to_string_lossy() }))
}

/// GET /api/mods/installed — 已安装模组（简化为纯数组）
pub(crate) async fn handle_installed(params: &Option<Value>) -> ApiResult {
    let version_id = params
        .as_ref()
        .and_then(|p| p.get("versionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if version_id.is_empty() {
        return ApiResult::err(400, "Missing versionId");
    }
    let result = mods::get_installed_mods_for_version(&version_id);
    let mut mods_arr = result.get("mods").cloned().unwrap_or(json!([]));
    enrich_online_icons(&mut mods_arr).await;
    ApiResult::ok(mods_arr)
}

/// 为已安装模组列表补充线上平台图标。
///
/// 对每个模组按其本地 jar 的 SHA1 向 Modrinth 查询对应项目，把项目官方图标
/// 地址（已换国内镜像）写入该模组的 icon 字段。前端在存在网络图标时直接使用，
/// 否则回退到已解析出的 jar 内图标或本地占位。
pub(crate) async fn enrich_online_icons(mods: &mut Value) {
    let arr = match mods.as_array_mut() {
        Some(a) => a,
        None => return,
    };
    // 收集每个模组的 jar 绝对路径
    let mut path_by_file: Vec<(String, String)> = Vec::new();
    for m in arr.iter() {
        let jp = m.get("_jarPath").and_then(|v| v.as_str()).unwrap_or("");
        let fn_ = m.get("fileName").and_then(|v| v.as_str()).unwrap_or("");
        if !jp.is_empty() {
            path_by_file.push((fn_.to_string(), jp.to_string()));
        }
    }
    if path_by_file.is_empty() {
        return;
    }
    let jar_paths: Vec<PathBuf> = path_by_file.iter().map(|(_, p)| PathBuf::from(p)).collect();
    let icon_map = mods::update::resolve_project_icons(&jar_paths).await;
    if icon_map.is_empty() {
        return;
    }
    // 按 jar 路径把网络图标回填到对应模组
    let mut icon_by_path: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for (_, p) in &path_by_file {
        if let Some(icon) = icon_map.get(p) {
            icon_by_path.insert(p.clone(), icon.clone());
        }
    }
    for m in arr.iter_mut() {
        let jp = m.get("_jarPath").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(icon) = icon_by_path.get(jp) {
            if let Some(obj) = m.as_object_mut() {
                obj.insert("icon".to_string(), Value::String(icon.clone()));
            }
        }
    }
}

/// GET /api/mods/categories — 模组分类列表
pub(crate) fn handle_categories() -> ApiResult {
    // 简化：返回常用分类
    let categories: Vec<&str> = vec![
        "performance", "optimization", "utility", "storage",
        "technology", "magic", "adventure", "decoration",
        "worldgen", "mobs", "food", "transportation",
        "armor", "weapons", "tools", "redstone",
    ];
    let arr: Vec<Value> = categories
        .iter()
        .map(|c| json!({ "name": c, "id": c }))
        .collect();
    ApiResult::ok(json!({ "categories": arr }))
}

/// GET /api/mods/featured — 推荐模组
pub(crate) async fn handle_featured() -> ApiResult {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // Modrinth 推荐模组（按下载量排序，取前 15）
    let url = format!(
        "{}/search?query=&index=downloads&limit=15&facets={}",
        MODRINTH_API,
        urlencoding::encode(r#"[["project_type:mod"]]"#)
    );

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<Value>().await {
                Ok(result) => {
                    let hits = result
                        .get("hits")
                        .and_then(|h| h.as_array())
                        .map(|arr| {
                            arr.iter()
                                .map(|hit| {
                                    json!({
                                        "id": hit.get("project_id").and_then(|v| v.as_str()).unwrap_or(""),
                                        "slug": hit.get("slug").and_then(|v| v.as_str()).unwrap_or(""),
                                        "title": hit.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                                        "description": hit.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                                        "icon": hit.get("icon_url").and_then(|v| v.as_str()).unwrap_or(""),
                                        "downloads": hit.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0),
                                        "source": "modrinth"
                                    })
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    ApiResult::ok(json!({ "hits": hits, "total": hits.len() }))
                }
                Err(_) => ApiResult::ok(json!({ "hits": [], "total": 0 })),
            }
        }
        _ => ApiResult::ok(json!({ "hits": [], "total": 0 })),
    }
}

// ============== 搜索路由 ==============

/// GET /api/mods/search — Modrinth + CurseForge 双源搜索
/// 归一化模组搜索词：
/// 去掉 forge / fabric / for / mod / quilt 等加载器或类型词；
/// 全部被去掉时保留原词，避免搜索框只输入 “Forge” 时变成空查询。
pub(crate) fn normalize_mod_search_query(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return String::new();
    }

    // 例外：OptiForge / OptiFabric 本身包含 Forge/Fabric，拆词后反而搜不到
    let compact = raw.replace(' ', "").to_ascii_lowercase();
    if compact.contains("optiforge") {
        return "optiforge".to_string();
    }
    if compact.contains("optifabric") {
        return "optifabric".to_string();
    }

    let mut words: Vec<String> = Vec::new();
    for word in raw.split_whitespace() {
        let clean = word
            .trim_matches(|c| c == '[' || c == ']')
            .to_ascii_lowercase();
        if clean.is_empty() {
            continue;
        }
        if matches!(
            clean.as_str(),
            "forge" | "fabric" | "neoforge" | "for" | "mod" | "quilt"
        ) {
            continue;
        }
        if !words.contains(&clean) {
            words.push(clean);
        }
    }

    if words.is_empty() {
        raw.to_string()
    } else {
        words.join(" ")
    }
}

pub(crate) async fn handle_search(params: &Option<Value>) -> ApiResult {
    let query = params
        .as_ref()
        .and_then(|p| p.get("query"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let source = params
        .as_ref()
        .and_then(|p| p.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("any")
        .to_string();
    let loader = params
        .as_ref()
        .and_then(|p| p.get("loader"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mc_version = params
        .as_ref()
        .and_then(|p| p.get("version"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let category = params
        .as_ref()
        .and_then(|p| p.get("category"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sort = params
        .as_ref()
        .and_then(|p| p.get("sort"))
        .and_then(|v| v.as_str())
        .unwrap_or("relevance")
        .to_string();
    let limit = params
        .as_ref()
        .and_then(|p| p.get("limit"))
        .and_then(|v| v.as_u64())
        .unwrap_or(15) as usize;
    let offset = params
        .as_ref()
        .and_then(|p| p.get("offset"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("VersePC/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // 搜索词里的加载器/类型词不应参与检索。
    // 例如输入 “JEI Forge” 时应搜 “jei”，否则 JEI 本体反而搜不到。
    let normalized_query = normalize_mod_search_query(&query);
    let mut cf_query = normalized_query.clone();
    let mut mr_query = normalized_query.clone();
    let plan_debug = wiki::build_plan(
        &normalized_query.to_lowercase(),
        "mod",
        source == "any" || source == "curseforge",
        source == "any" || source == "modrinth",
    );
    match &plan_debug {
        Ok(plan) => {
            if plan.is_chinese {
                if let Some(alt) = &plan.cf_alt {
                    cf_query = alt.clone();
                }
                if let Some(alt) = &plan.mr_alt {
                    mr_query = alt.clone();
                }
            }
        }
        Err(_) => {}
    }

    // 1.14 以下的 Forge 搜索忽略加载器筛选：
    // 老模组经常没有写 Forge 标记，强制过滤会导致搜不到。
    let search_loader = if loader.eq_ignore_ascii_case("forge")
        && !mc_version.is_empty()
        && crate::resource::mcversion::version_to_drop(&mc_version) < 140
    {
        String::new()
    } else {
        loader.clone()
    };

    let mut all_hits: Vec<Value> = Vec::new();
    let mut total_hits: u64 = 0;

    // 双源混合时不能各自只取 limit 条再合并，否则第二页会缺结果、顺序也会漂移。
    // 与 PCL CE 一致：固定取回一批候选（CurseForge pageSize 上限 50），合并排序后再切片分页。
    let fetch_limit = if source == "any" { 50 } else { limit };
    let fetch_offset = if source == "any" { 0 } else { offset };
    let mut mr_total: u64 = 0;
    let mut cf_total: u64 = 0;

    // Modrinth 源
    if source == "any" || source == "modrinth" {
        if let Ok((hits, total)) = search_modrinth_mods(&client, &mr_query, &search_loader, &mc_version, &category, &sort, fetch_limit, fetch_offset).await {
            all_hits.extend(hits);
            mr_total = total;
        }
    }

    // CurseForge 源
    if source == "any" || source == "curseforge" {
        if let Ok((hits, total)) = search_curseforge_mods(&client, &cf_query, &search_loader, &mc_version, &sort, fetch_limit, fetch_offset).await {
            all_hits.extend(hits);
            cf_total = total;
        }
    }

    if source == "any" {
        // 双源混合时按下载量排序，再按当前页切片。
        // 加 source/id 作为稳定排序键，避免下载量相同时翻页顺序漂移、出现重复项。
        all_hits.sort_by(|a, b| {
            let da = a.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0);
            let db = b.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0);
            db.cmp(&da)
                .then_with(|| {
                    let sa = a.get("source").and_then(|v| v.as_str()).unwrap_or("");
                    let sb = b.get("source").and_then(|v| v.as_str()).unwrap_or("");
                    sa.cmp(sb)
                })
                .then_with(|| {
                    let ia = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let ib = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    ia.cmp(ib)
                })
        });
        // 同一来源同一条目去重（翻页时 API 可能返回重复项）
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        all_hits.retain(|h| {
            let key = format!(
                "{}:{}",
                h.get("source").and_then(|v| v.as_str()).unwrap_or(""),
                h.get("id").and_then(|v| v.as_str()).unwrap_or("")
            );
            seen.insert(key)
        });
        // 只对已取回并去重的候选集负责，避免 total 虚高导致空白页
        total_hits = all_hits.len() as u64;
        let start = offset.min(all_hits.len());
        all_hits = all_hits.into_iter().skip(start).take(limit).collect();
    } else {
        total_hits = mr_total.max(cf_total);
    }

    ApiResult::ok(json!({
        "hits": all_hits,
        "total": total_hits,
        "offset": offset
    }))
}

/// Modrinth 搜索模组
pub(crate) async fn search_modrinth_mods(
    client: &reqwest::Client,
    query: &str,
    loader: &str,
    mc_version: &str,
    category: &str,
    sort: &str,
    limit: usize,
    offset: usize,
) -> Result<(Vec<Value>, u64), String> {
    let mut facets: Vec<Vec<String>> = vec![vec!["project_type:mod".to_string()]];
    if !loader.is_empty() {
        facets.push(vec![format!("categories:{}", loader)]);
    }
    if !mc_version.is_empty() {
        facets.push(vec![format!("versions:{}", mc_version)]);
    }
    if !category.is_empty() {
        facets.push(vec![format!("categories:{}", category)]);
    }
    let facets_json = serde_json::to_string(&facets).unwrap_or_default();

    let sort_field = match sort {
        "downloads" => "downloads",
        "newest" => "newest",
        "updated" => "updated",
        "follows" => "follows",
        _ => "relevance",
    };

    let url = format!(
        "{}/search?query={}&index={}&limit={}&offset={}&facets={}",
        MODRINTH_API,
        urlencoding::encode(query),
        sort_field,
        limit,
        offset,
        urlencoding::encode(&facets_json)
    );

    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let result: Value = resp.json().await.map_err(|e| e.to_string())?;
    let hits = result
        .get("hits")
        .and_then(|h| h.as_array())
        .map(|arr| {
            arr.iter()
                .map(|hit| {
                    json!({
                        "id": hit.get("project_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "slug": hit.get("slug").and_then(|v| v.as_str()).unwrap_or(""),
                        "title": hit.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "description": hit.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                        "author": hit.get("author").and_then(|v| v.as_str()).unwrap_or("").replace('_', ""),
                        "icon": hit.get("icon_url").and_then(|v| v.as_str()).unwrap_or(""),
                        "downloads": hit.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0),
                        "followers": hit.get("followers").and_then(|v| v.as_u64()).unwrap_or(0),
                        "categories": hit.get("categories").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
                        "versions": hit.get("versions").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
                        "dateCreated": hit.get("date_created").and_then(|v| v.as_str()).unwrap_or(""),
                        "dateModified": hit.get("date_modified").and_then(|v| v.as_str()).unwrap_or(""),
                        "source": "modrinth",
                        "installed": false
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let total_hits = result.get("total_hits").and_then(|v| v.as_u64()).unwrap_or(0);
    Ok((hits, total_hits))
}

/// CurseForge 搜索模组
pub(crate) async fn search_curseforge_mods(
    client: &reqwest::Client,
    query: &str,
    loader: &str,
    mc_version: &str,
    sort: &str,
    limit: usize,
    offset: usize,
) -> Result<(Vec<Value>, u64), String> {
    let settings = storage::load_settings();
    let cf_api_key = settings
        .get("curseforgeApiKey")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_CF_API_KEY);

    let sort_field = match sort {
        "downloads" => "6",
        "newest" => "11",
        "updated" => "3",
        // CurseForge 的 4 并不是真正相关度（实测会返回无关结果），保持 2=Popularity；
        // 拉取结果后还会用本地相似度重新排序，这里先保证结果不丢失。
        _ => "2",
    };

    let mut url = format!(
        "{}/mods/search?gameId=432&searchFilter={}&sortOrder=Desc&classId=6&pageSize={}&index={}&sortField={}",
        CURSEFORGE_API,
        urlencoding::encode(query),
        limit,
        offset,
        sort_field
    );

    if !loader.is_empty() {
        let loader_id = match loader.to_lowercase().as_str() {
            "forge" => "1",
            "fabric" => "4",
            "quilt" => "5",
            "neoforge" => "6",
            _ => "",
        };
        if !loader_id.is_empty() {
            url.push_str(&format!("&modLoaderType={}", loader_id));
        }
    }

    if !mc_version.is_empty() {
        url.push_str(&format!("&gameVersion={}", urlencoding::encode(mc_version)));
    }

    let resp = client
        .get(&url)
        .header("x-api-key", cf_api_key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let result: Value = resp.json().await.map_err(|e| e.to_string())?;
    let hits = result
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .map(|m| {
                    let author = m
                        .get("authors")
                        .and_then(|a| a.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|a| a.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("Unknown");
                    let categories = m
                        .get("categories")
                        .and_then(|c| c.as_array())
                        .map(|arr| {
                            arr.iter()
                                .map(|c| {
                                    c.get("name")
                                        .and_then(|n| n.as_str())
                                        .map(|s| s.to_string())
                                        .unwrap_or_else(|| c.get("id").map(|i| i.to_string()).unwrap_or_default())
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    json!({
                        "id": m.get("id").map(|i| i.to_string()).unwrap_or_default(),
                        "slug": m.get("slug").and_then(|v| v.as_str()).unwrap_or(""),
                        "title": m.get("name").and_then(|v| v.as_str()).unwrap_or("Unknown"),
                        "description": m.get("summary").and_then(|v| v.as_str()).unwrap_or(""),
                        "author": author,
                        "icon": m.get("logo").and_then(|l| l.get("url")).and_then(|u| u.as_str()).unwrap_or(""),
                        "downloads": m.get("downloadCount").and_then(|v| v.as_u64()).unwrap_or(0),
                        "followers": m.get("followers").and_then(|v| v.as_u64()).unwrap_or(0),
                        "categories": categories,
                        "versions": [],
                        "dateCreated": m.get("dateCreated").and_then(|v| v.as_str()).unwrap_or(""),
                        "dateModified": m.get("dateModified").and_then(|v| v.as_str()).unwrap_or(""),
                        "source": "curseforge",
                        "installed": false
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let total_hits = result.pointer("/pagination/totalCount").and_then(|v| v.as_u64()).unwrap_or(0);
    Ok((hits, total_hits))
}

// ============== 详情路由 ==============
