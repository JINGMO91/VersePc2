// api/resources/search.rs — 双源聚合搜索
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
use super::detail::to_modrinth_cdn_mirror;

/// GET /api/resources/search — Modrinth + CurseForge 双源聚合搜索
///
/// 查询参数：
///   - query: 搜索关键词
///   - type: 资源类型（mod/modpack/resourcepack/shader/datapack，默认 modpack）
///   - loader: 加载器过滤
///   - version: MC 版本过滤
///   - category: 分类过滤（仅 Modrinth）
///   - sort: 排序（relevance/downloads/newest/updated，默认 downloads）
///   - limit: 返回数量（默认 15）
///   - offset: 偏移量（默认 0）
///   - source: 数据源（空/modrinth/curseforge）
pub(crate) async fn handle_search(params: &Option<Value>) -> ApiResult {
    let query = params
        .as_ref()
        .and_then(|p| p.get("query"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let res_type = params
        .as_ref()
        .and_then(|p| p.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("modpack")
        .to_string();
    let loader = params
        .as_ref()
        .and_then(|p| p.get("loader"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let version = params
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
        .unwrap_or("downloads")
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
    let source = params
        .as_ref()
        .and_then(|p| p.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 搜索词本地归一化：小写
    let raw_query = query.trim().to_lowercase();
    let use_cf = (source.is_empty() || source == "curseforge") && cf_class_id(&res_type).is_some();
    let use_mr = source.is_empty() || source == "modrinth";

    // 在 1.14-，部分老 Mod 没有设置支持的加载器，添加 Forge 筛选就会遗漏；
    // 因此这类请求不筛选加载器，返回后在结果中自行筛除不是 Forge 的项。
    let ignore_loader =
        loader.eq_ignore_ascii_case("forge") && !version.is_empty() && mcversion::version_to_drop(&version) < 140;

    // 中文搜索：将中文关键词改写为英文关键词，并定位可直接获取的工程。
    let plan = match wiki::build_plan(&raw_query, &res_type, use_cf, use_mr) {
        Ok(p) => p,
        Err(e) => return ApiResult::err(404, &e),
    };
    let is_chinese = plan.is_chinese;

    let cf_query = if is_chinese {
        plan.cf_alt.clone().unwrap_or_else(|| raw_query.clone())
    } else {
        raw_query.clone()
    };
    let mr_query = if is_chinese {
        plan.mr_alt.clone().unwrap_or_else(|| raw_query.clone())
    } else {
        raw_query.clone()
    };
    let run_cf = if is_chinese { use_cf && plan.cf_alt.is_some() } else { use_cf };
    let run_mr = if is_chinese { use_mr && plan.mr_alt.is_some() } else { use_mr };

    let cf_fut = if run_cf {
        Some(search_curseforge(&cf_query, &res_type, &loader, &version, limit, offset, ignore_loader))
    } else {
        None
    };
    let mr_fut = if run_mr {
        Some(search_modrinth(&mr_query, &res_type, &loader, &version, &category, &sort, limit, offset, ignore_loader))
    } else {
        None
    };
    let direct_fut = if is_chinese && !plan.mr_slugs.is_empty() {
        Some(fetch_modrinth_by_slugs(&plan.mr_slugs, &res_type, &loader, &version, &category))
    } else {
        None
    };

    let (cf_res, mr_res, direct_res): (Result<Vec<Value>, String>, Result<Vec<Value>, String>, Result<Vec<Value>, String>) =
        match (cf_fut, mr_fut, direct_fut) {
            (Some(c), Some(m), Some(d)) => {
                let (a, b, c2) = tokio::join!(c, m, d);
                (a, b, c2)
            }
            (Some(c), Some(m), None) => {
                let (a, b) = tokio::join!(c, m);
                (a, b, Ok(vec![]))
            }
            (Some(c), None, Some(d)) => {
                let (a, b) = tokio::join!(c, d);
                (a, Ok(vec![]), b)
            }
            (None, Some(m), Some(d)) => {
                let (a, b) = tokio::join!(m, d);
                (Ok(vec![]), a, b)
            }
            (Some(c), None, None) => (c.await, Ok(vec![]), Ok(vec![])),
            (None, Some(m), None) => (Ok(vec![]), m.await, Ok(vec![])),
            (None, None, Some(d)) => (Ok(vec![]), Ok(vec![]), d.await),
            (None, None, None) => (Ok(vec![]), Ok(vec![]), Ok(vec![])),
        };

    let mut all_hits: Vec<Value> = Vec::new();
    if let Ok(hits) = cf_res {
        all_hits.extend(hits);
    }
    if let Ok(hits) = mr_res {
        all_hits.extend(hits);
    }
    if let Ok(hits) = direct_res {
        all_hits.extend(hits);
    }

    // 老版本 Forge 请求：仅保留只支持 Forge 或未标注加载器的项
    if ignore_loader {
        all_hits.retain(|h| {
            let mask = h.get("loader_mask").and_then(|v| v.as_i64()).unwrap_or(0);
            mask == 0 || (mask & 1) != 0
        });
    }

    all_hits = dedup_cf_first(all_hits);
    all_hits = sort_hits(all_hits, &raw_query, is_chinese, &res_type);

    let total = all_hits.len();
    let mut hits = all_hits;
    hits.truncate(limit);
    for h in hits.iter_mut() {
        if let Some(obj) = h.as_object_mut() {
            obj.remove("loader_mask");
        }
    }

    ApiResult::ok(json!({
        "hits": hits,
        "total": total,
        "offset": offset
    }))
}

pub(crate) fn cf_loader_type_id(loader: &str) -> Option<&'static str> {
    match loader {
        "forge" => Some("1"),
        "liteloader" => Some("3"),
        "fabric" => Some("4"),
        "neoforge" => Some("6"),
        _ => None,
    }
}

pub(crate) fn loader_mask(loader: &str) -> i32 {
    match loader {
        "forge" => 1,
        "liteloader" => 2,
        "fabric" => 4,
        "neoforge" => 16,
        _ => 0,
    }
}

pub(crate) fn loader_mask_from_names(names: &[serde_json::Value]) -> i32 {
    let mut mask = 0;
    for v in names {
        if let Some(s) = v.as_str() {
            let l = s.to_lowercase();
            if l.contains("neoforge") {
                mask |= 16;
            } else if l.contains("liteloader") {
                mask |= 2;
            } else if l.contains("forge") {
                mask |= 1;
            } else if l.contains("fabric") {
                mask |= 4;
            }
        }
    }
    mask
}

pub(crate) fn norm_key(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

pub(crate) fn build_modrinth_hit(proj: &Value, res_type: &str) -> Value {
    let id = proj
        .get("project_id")
        .and_then(|v| v.as_str())
        .or_else(|| proj.get("id").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    let slug = proj.get("slug").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut game_versions = proj
        .get("game_versions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if game_versions.is_empty() {
        game_versions = proj.get("versions").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    }
    let loaders = proj.get("loaders").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mask = loader_mask_from_names(&loaders);
    json!({
        "id": id,
        "slug": slug,
        "title": proj.get("title").and_then(|v| v.as_str()).unwrap_or(""),
        "description": proj.get("description").and_then(|v| v.as_str()).unwrap_or(""),
        "author": proj.get("author").and_then(|v| v.as_str()).unwrap_or("").replace('_', ""),
        "icon": to_modrinth_cdn_mirror(&proj.get("icon_url").and_then(|v| v.as_str()).unwrap_or("")),
        "downloads": proj.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0),
        "followers": proj.get("followers").and_then(|v| v.as_u64()).unwrap_or(0),
        "categories": proj.get("categories").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
        "versions": game_versions,
        "dateCreated": proj.get("date_created").and_then(|v| v.as_str()).unwrap_or(""),
        "dateModified": proj.get("date_modified").and_then(|v| v.as_str()).unwrap_or(""),
        "source": "modrinth",
        "projectType": res_type,
        "loader_mask": mask
    })
}

pub(crate) async fn fetch_modrinth_by_slugs(
    slugs: &[String],
    res_type: &str,
    loader: &str,
    version: &str,
    category: &str,
) -> Result<Vec<Value>, String> {
    if slugs.is_empty() {
        return Ok(vec![]);
    }
    let ids_str = slugs.join("\",\"");
    let url = format!("{}/projects?ids=[\"{}\"]", MODRINTH_API, ids_str);
    let result = cached_fetch_json(url, 60000, None).await?;
    let arr = result.as_array().cloned().unwrap_or_default();
    let vmask = loader_mask(loader);
    let mut out: Vec<Value> = Vec::new();
    for proj in &arr {
        if !version.is_empty() {
            let gv = proj.get("game_versions").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let ok = gv.iter().any(|v| v.as_str().map_or(false, |s| s == version));
            if !ok {
                continue;
            }
        }
        if vmask != 0 && !loader.is_empty() {
            let loaders = proj.get("loaders").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let project_mask = loader_mask_from_names(&loaders);
            if project_mask & vmask == 0 {
                continue;
            }
        }
        if !category.is_empty() {
            let cats = proj.get("categories").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let ok = cats.iter().any(|c| c.as_str().map_or(false, |s| s == category));
            if !ok {
                continue;
            }
        }
        out.push(build_modrinth_hit(proj, res_type));
    }
    Ok(out)
}

pub(crate) fn has_wiki_entry(source_name: &str, slug: &str) -> bool {
    if slug.is_empty() {
        return false;
    }
    let p = match source_name {
        "curseforge" => wiki::Platform::CurseForge,
        "modrinth" => wiki::Platform::Modrinth,
        _ => return false,
    };
    wiki::lookup_entry(p, slug).is_some()
}

pub(crate) fn lookup_display(source_name: &str, slug: &str) -> Option<String> {
    if slug.is_empty() {
        return None;
    }
    let p = match source_name {
        "curseforge" => wiki::Platform::CurseForge,
        "modrinth" => wiki::Platform::Modrinth,
        _ => return None,
    };
    wiki::lookup_entry(p, slug).and_then(|e| e.chinese_name.clone())
}

pub(crate) fn dedup_cf_first(hits: Vec<Value>) -> Vec<Value> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<Value> = Vec::new();
    for h in hits {
        let slug = h.get("slug").and_then(|v| v.as_str()).unwrap_or("");
        let id = h.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let source_name = h.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let mut key = if slug.is_empty() { norm_key(id) } else { norm_key(slug) };
        if key.is_empty() {
            key = format!("{}{}", source_name, norm_key(id));
        }
        if seen.insert(key) {
            out.push(h);
        }
    }
    out
}

pub(crate) fn base_score(h: &Value, res_type: &str) -> f64 {
    let source_name = h.get("source").and_then(|v| v.as_str()).unwrap_or("");
    let slug = h.get("slug").and_then(|v| v.as_str()).unwrap_or("");
    let dl = h.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0);
    let mult = download_multiplier(source_name, res_type);
    let bonus = if has_wiki_entry(source_name, slug) { 0.2 } else { 0.0 };
    bonus + (dl.max(1) as f64 * mult).log10() / 9.0
}

pub(crate) fn sort_hits(hits: Vec<Value>, raw_query: &str, is_chinese: bool, res_type: &str) -> Vec<Value> {
    if raw_query.is_empty() {
        let mut hits = hits;
        hits.sort_by(|a, b| {
            let da = a.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0);
            let db = b.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0);
            db.cmp(&da)
        });
        return hits;
    }
    let mut sources: Vec<Vec<SearchSource>> = Vec::new();
    for h in &hits {
        let source_name = h.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let slug = h.get("slug").and_then(|v| v.as_str()).unwrap_or("");
        let title = h.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let desc = h.get("description").and_then(|v| v.as_str()).unwrap_or("");
        let display = if is_chinese {
            lookup_display(source_name, slug).unwrap_or_else(|| title.to_string())
        } else {
            title.to_string()
        };
        let aliases: Vec<String> = display.split('/').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
        let mut ss = vec![SearchSource { aliases, weight: 1.0 }];
        if !desc.is_empty() {
            ss.push(SearchSource::new_text(desc, 0.05));
        }
        sources.push(ss);
    }
    let res = matcher::search(&sources, raw_query, 10000, -1.0);
    let mut scores: Vec<f64> = hits.iter().map(|h| base_score(h, res_type)).collect();
    let denom = match res.first() {
        Some(f) => {
            if f.absolute_right {
                10.0
            } else {
                f.similarity
            }
        }
        None => 1.0,
    };
    for r in &res {
        let add = if r.absolute_right { 10.0 } else { r.similarity };
        scores[r.index] += add / denom;
    }
    let mut order: Vec<usize> = (0..hits.len()).collect();
    order.sort_by(|&i, &j| {
        scores[j].partial_cmp(&scores[i]).unwrap_or(std::cmp::Ordering::Equal)
    });
    order.into_iter().map(|i| hits[i].clone()).collect()
}

/// 从 Modrinth 搜索资源
pub(crate) async fn search_modrinth(
    query: &str,
    res_type: &str,
    loader: &str,
    version: &str,
    category: &str,
    sort: &str,
    limit: usize,
    offset: usize,
    ignore_loader: bool,
) -> Result<Vec<Value>, String> {
    // 构造 facets
    let mut facets: Vec<Vec<String>> = vec![vec![format!("project_type:{}", res_type)]];
    if !loader.is_empty() && !ignore_loader {
        facets.push(vec![format!("categories:{}", loader)]);
    }
    if !version.is_empty() {
        facets.push(vec![format!("versions:{}", version)]);
    }
    if !category.is_empty() {
        facets.push(vec![format!("categories:{}", category)]);
    }
    let facets_json = serde_json::to_string(&facets).unwrap_or_default();

    // 排序字段映射
    let sort_field = match sort {
        "relevance" => "relevance",
        "newest" => "newest",
        "updated" => "updated",
        _ => "downloads",
    };
    // 空查询时默认按下载量
    let final_sort = if query.is_empty() && sort == "relevance" {
        "downloads"
    } else {
        sort_field
    };

    let url = format!(
        "{}/search?query={}&index={}&limit={}&offset={}&facets={}",
        MODRINTH_API,
        urlencoding::encode(query),
        final_sort,
        limit,
        offset,
        urlencoding::encode(&facets_json)
    );

    let result = cached_fetch_json(url, 60000, None).await?;

    let hits: Vec<Value> = result
        .get("hits")
        .and_then(|h| h.as_array())
        .map(|arr| arr.iter().map(|hit| build_modrinth_hit(hit, res_type)).collect())
        .unwrap_or_default();

    Ok(hits)
}

/// CurseForge 资源分类 classId 映射
/// mod=6, modpack=4471, datapack=6945, shader=6552, resourcepack=12
pub(crate) fn cf_class_id(res_type: &str) -> Option<i32> {
    match res_type {
        "mod" => Some(6),
        "modpack" => Some(4471),
        "datapack" => Some(6945),
        "shader" => Some(6552),
        "resourcepack" => Some(12),
        _ => None,
    }
}

/// 根据资源类型给下载量加权，用于双源混合时排序
pub(crate) fn download_multiplier(source: &str, res_type: &str) -> f64 {
    match res_type {
        "mod" | "modpack" => {
            if source == "curseforge" { 1.0 } else { 5.0 }
        }
        "datapack" => {
            if source == "curseforge" { 10.0 } else { 1.0 }
        }
        "resourcepack" | "shader" => {
            if source == "curseforge" { 1.0 } else { 4.0 }
        }
        _ => 1.0,
    }
}

/// 从 CurseForge 搜索资源
pub(crate) async fn search_curseforge(
    query: &str,
    res_type: &str,
    loader: &str,
    version: &str,
    limit: usize,
    offset: usize,
    ignore_loader: bool,
) -> Result<Vec<Value>, String> {
    let settings = storage::load_settings();
    let cf_api_key = settings
        .get("curseforgeApiKey")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_CF_API_KEY);

    let class_id = match cf_class_id(res_type) {
        Some(c) => c,
        None => return Ok(vec![]),
    };

    let mut url = format!(
        "{}/mods/search?gameId=432&sortField=2&sortOrder=desc&pageSize={}&classId={}",
        CURSEFORGE_API,
        limit,
        class_id
    );

    if !loader.is_empty() && !ignore_loader {
        if let Some(id) = cf_loader_type_id(&loader.to_lowercase()) {
            url.push_str(&format!("&modLoaderType={}", id));
        }
    }

    if !version.is_empty() {
        url.push_str(&format!("&gameVersion={}", urlencoding::encode(version)));
    }
    if !query.is_empty() {
        url.push_str(&format!("&searchFilter={}", urlencoding::encode(query)));
    }
    if offset > 0 {
        url.push_str(&format!("&index={}", offset));
    }

    // 构造 CurseForge 请求头（需要 x-api-key）
    let mut headers = reqwest::header::HeaderMap::new();
    if let Ok(v) = reqwest::header::HeaderValue::from_str(&cf_api_key) {
        headers.insert("x-api-key", v);
    }
    headers.insert("Accept", reqwest::header::HeaderValue::from_static("application/json"));

    let result = cached_fetch_json(url, 60000, Some(&headers)).await?;

    let hits: Vec<Value> = result
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|mod_obj| {
                    // 过滤被归类为资源包的数据包
                    if res_type == "resourcepack" && has_datapack_category(mod_obj) {
                        return None;
                    }
                    let mask = cf_loader_mask(mod_obj);
                    let author = mod_obj
                        .get("authors")
                        .and_then(|a| a.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|a| a.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("Unknown");
                    let categories: Vec<Value> = mod_obj
                        .get("categories")
                        .and_then(|c| c.as_array())
                        .map(|arr| {
                            arr.iter()
                                .map(|c| {
                                    c.get("name")
                                        .and_then(|n| n.as_str())
                                        .map(|s| Value::String(s.to_string()))
                                        .unwrap_or_else(|| {
                                            c.get("id").map(|i| Value::String(i.to_string())).unwrap_or(Value::Null)
                                        })
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    Some(json!({
                        "id": mod_obj.get("id").map(|i| i.to_string()).unwrap_or_default(),
                        "slug": mod_obj.get("slug").and_then(|v| v.as_str()).unwrap_or(""),
                        "title": mod_obj.get("name").and_then(|v| v.as_str()).unwrap_or("Unknown"),
                        "description": mod_obj.get("summary").and_then(|v| v.as_str()).unwrap_or(""),
                        "author": author,
                        "icon": mod_obj.get("logo").and_then(|l| l.get("url")).and_then(|u| u.as_str()).unwrap_or(""),
                        "downloads": mod_obj.get("downloadCount").and_then(|v| v.as_u64()).unwrap_or(0),
                        "followers": mod_obj.get("followers").and_then(|v| v.as_u64()).unwrap_or(0),
                        "categories": categories,
                        "versions": [],
                        "dateCreated": mod_obj.get("dateCreated").and_then(|v| v.as_str()).unwrap_or(""),
                        "dateModified": mod_obj.get("dateModified").and_then(|v| v.as_str()).unwrap_or(""),
                        "source": "curseforge",
                        "projectType": res_type,
                        "loader_mask": mask
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(hits)
}

pub(crate) fn has_datapack_category(m: &Value) -> bool {
    if let Some(arr) = m.get("categories").and_then(|c| c.as_array()) {
        for c in arr {
            if let Some(name) = c.get("name").and_then(|n| n.as_str()) {
                if name.to_lowercase().contains("data pack") {
                    return true;
                }
            }
            if let Some(id) = c.get("id").and_then(|i| i.as_u64()) {
                if id == 5193 {
                    return true;
                }
            }
        }
    }
    false
}

pub(crate) fn cf_loader_mask(m: &Value) -> i32 {
    let mut mask = 0;
    if let Some(files) = m.get("latestFiles").and_then(|f| f.as_array()) {
        for f in files {
            if let Some(gv) = f.get("gameVersions").and_then(|g| g.as_array()) {
                mask |= loader_mask_from_names(gv);
            }
        }
    }
    if let Some(idx) = m.get("latestFilesIndexes").and_then(|f| f.as_array()) {
        for f in idx {
            if let Some(gv) = f.get("gameVersion").and_then(|g| g.as_str()) {
                let arr = [Value::String(gv.to_string())];
                mask |= loader_mask_from_names(&arr);
            }
        }
    }
    mask
}
