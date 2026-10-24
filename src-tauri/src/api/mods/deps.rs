// api/mods/deps.rs — 依赖解析门面
//
// 子模块职责：
//   deps_parse   统一数据结构与 Modrinth/CurseForge 字段解析
//   deps_fetch   根版本、文件列表与项目信息的远程请求
//   deps_resolve 依赖树遍历与批量解析路由
use serde_json::Value;

use crate::api::ApiResult;

#[path = "deps_parse.rs"]
mod deps_parse;
#[path = "deps_fetch.rs"]
mod deps_fetch;
#[path = "deps_resolve.rs"]
mod deps_resolve;

pub(crate) use deps_resolve::*;

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
