// test_support.rs — 测试专用辅助
// storage::override_data_dir 与测试版本清单 URL 都是进程级状态，
// 所有依赖它们的集成测试必须通过同一把锁串行执行，避免并行测试相互覆盖。
#![cfg(test)]

use tokio::sync::{Mutex, MutexGuard};

static TEST_LOCK: Mutex<()> = Mutex::const_new(());

/// 获取集成测试串行锁（异步锁，允许跨 await 持有）
pub(crate) async fn lock() -> MutexGuard<'static, ()> {
    TEST_LOCK.lock().await
}

/// 创建唯一临时数据目录并清空旧内容
pub(crate) fn fresh_data_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "verse-integration-{}-{}",
        std::process::id(),
        name
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
