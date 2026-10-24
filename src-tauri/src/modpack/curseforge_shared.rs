// modpack/curseforge_shared.rs — CurseForge 整合包导入共享工具门面
//
// 子模块职责：
//   curseforge_fs     版本去重、路径安全、资源包迁移、清单、并发/超时、目录与时间工具
//   curseforge_repair JAR 完整性与修复、modId 读取
//   curseforge_chain  版本链清理与版本 JSON 递归解析
//   curseforge_compat 加载器库验证与兼容性检查
//
// 保持原有 crate::modpack::curseforge_shared::* 导入路径不变。

#[path = "curseforge_fs.rs"]
mod curseforge_fs;
#[path = "curseforge_repair.rs"]
mod curseforge_repair;
#[path = "curseforge_chain.rs"]
mod curseforge_chain;
#[path = "curseforge_compat.rs"]
mod curseforge_compat;

pub use curseforge_fs::*;
pub use curseforge_repair::*;
pub use curseforge_chain::*;
pub use curseforge_compat::*;
