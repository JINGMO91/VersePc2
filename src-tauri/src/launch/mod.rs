// launch/mod.rs — 游戏启动模块入口
// 职责：聚合启动相关子模块

pub mod args_builder;
pub mod dep_check;
pub mod exit_code;
pub mod game_session;
pub mod java_scan;
pub mod memory;
pub mod process_manager;

pub use args_builder::build_launch_arguments;
pub use game_session::stop_all;
pub use java_scan::get_java_version_range;
pub use process_manager::{do_launch, kill_game};
