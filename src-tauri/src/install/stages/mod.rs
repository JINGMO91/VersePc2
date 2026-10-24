// install/stages/mod.rs — 安装阶段集合
// 每个阶段只负责一类工作，由安装编排入口顺序调用。

pub(crate) mod assets;
pub(crate) mod client_jar;
pub(crate) mod libraries;
pub(crate) mod loader;
pub(crate) mod version_json;
