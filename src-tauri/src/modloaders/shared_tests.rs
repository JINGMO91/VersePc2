// 合并安装集成测试：由 shared.rs 通过 #[path] 引入。
    use super::*;
    use axum::{routing::get, Json, Router};
    use serde_json::json;

    /// 本地 mock 服务：版本清单、版本 JSON、客户端 JAR 与库文件
    fn mock_router(base: String) -> Router {
        let manifest = json!({
            "versions": [{ "id": "1.99.0", "url": format!("{}/1.99.0.json", base) }]
        });
        let details = json!({
            "id": "1.99.0",
            "mainClass": "net.minecraft.client.main.Main",
            "downloads": { "client": { "url": format!("{}/client.jar", base), "size": 4 } },
            "libraries": [{
                "name": "test:lib:1.0",
                "downloads": { "artifact": {
                    "url": format!("{}/lib.jar", base),
                    "path": "test/lib/1.0/lib-1.0.jar",
                    "size": 4
                }}
            }]
        });
        let manifest_route = manifest.clone();
        let details_route = details.clone();
        Router::new()
            .route(
                "/manifest.json",
                get(move || {
                    let v = manifest_route.clone();
                    async move { Json(v) }
                }),
            )
            .route(
                "/1.99.0.json",
                get(move || {
                    let v = details_route.clone();
                    async move { Json(v) }
                }),
            )
            .route("/client.jar", get(|| async { "JAR!" }))
            .route("/lib.jar", get(|| async { "LIB!" }))
            .route("/fabric.jar", get(|| async { "FAB!" }))
    }

    async fn serve_mock() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base = format!("http://{}", addr);
        let router = mock_router(base.clone());
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        base
    }

    /// 合并安装只产出目标实例：不创建独立原版目录，也不删用户已有原版与数据
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn merged_install_keeps_user_base_version_and_creates_single_instance() {
        let _guard = crate::test_support::lock().await;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base = format!("http://{}", addr);
        let router = mock_router(base.clone());
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });

        let data_dir = std::env::temp_dir().join(format!("verse-merge-it-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&data_dir);
        std::fs::create_dir_all(&data_dir).unwrap();
        crate::storage::override_data_dir(data_dir.clone());
        crate::versions::set_test_manifest_url(&format!("{}/manifest.json", base));

        // 用户此前已安装的原版目录（含用户数据）
        let user_base = data_dir.join("versions").join("1.99.0");
        std::fs::create_dir_all(&user_base).unwrap();
        std::fs::write(user_base.join("options.txt"), "keep").unwrap();

        let profile = json!({
            "id": "fabric-loader-0.99.0-1.99.0",
            "inheritsFrom": "1.99.0",
            "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
            "libraries": [{
                "name": "net.fabricmc:fabric-loader:0.99.0",
                "downloads": { "artifact": {
                    "url": format!("{}/fabric.jar", base),
                    "path": "net/fabricmc/fabric-loader/0.99.0/fabric-loader-0.99.0.jar",
                    "size": 4
                }}
            }]
        });

        let target = "1.99.0-Fabric-0.99.0";
        let merged = install_merged_loader("1.99.0", target, &profile, None)
            .await
            .expect("合并安装应成功");

        // 合并结果自含原版内容
        assert_eq!(crate::utils::get_str(&merged, "id"), target);
        assert!(merged.get("inheritsFrom").is_none(), "不应保留 inheritsFrom");
        assert!(merged.get("jar").is_none(), "不应保留 jar");

        // 只产出目标实例，客户端 JAR 落在目标目录
        let target_dir = data_dir.join("versions").join(target);
        assert!(target_dir.join(format!("{}.json", target)).exists());
        assert!(
            target_dir.join(format!("{}.jar", target)).exists(),
            "客户端 JAR 应落在目标实例目录"
        );

        // 用户已有原版目录与数据必须保留
        assert!(
            user_base.join("options.txt").exists(),
            "用户已有原版目录不应被删除"
        );

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// 基础版本自动安装：版本 JSON、客户端 JAR 与核心库都落到隔离数据目录
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn base_version_install_creates_json_jar_and_library() {
        let _guard = crate::test_support::lock().await;
        let base = serve_mock().await;
        let data_dir = crate::test_support::fresh_data_dir("base-install");
        crate::storage::override_data_dir(data_dir.clone());
        crate::versions::set_test_manifest_url(&format!("{}/manifest.json", base));

        ensure_base_version_installed("1.99.0", None)
            .await
            .expect("基础版本安装应成功");

        let version_dir = data_dir.join("versions").join("1.99.0");
        assert!(version_dir.join("1.99.0.json").exists(), "版本 JSON 应写入");
        assert_eq!(
            std::fs::read_to_string(version_dir.join("1.99.0.jar")).unwrap(),
            "JAR!"
        );
        assert!(
            data_dir
                .join("libraries")
                .join("test")
                .join("lib")
                .join("1.0")
                .join("lib-1.0.jar")
                .exists(),
            "核心库应下载到 libraries 目录"
        );

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// 基础版本已安装时再次检查不应重复下载
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn base_version_install_is_idempotent() {
        let _guard = crate::test_support::lock().await;
        let base = serve_mock().await;
        let data_dir = crate::test_support::fresh_data_dir("base-idempotent");
        crate::storage::override_data_dir(data_dir.clone());
        crate::versions::set_test_manifest_url(&format!("{}/manifest.json", base));

        ensure_base_version_installed("1.99.0", None)
            .await
            .expect("首次安装应成功");
        let jar_path = data_dir
            .join("versions")
            .join("1.99.0")
            .join("1.99.0.jar");
        let first_modified = std::fs::metadata(&jar_path).unwrap().modified().unwrap();

        ensure_base_version_installed("1.99.0", None)
            .await
            .expect("重复检查应成功");
        let second_modified = std::fs::metadata(&jar_path).unwrap().modified().unwrap();
        assert_eq!(first_modified, second_modified, "已安装时不应重复写 JAR");

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// 清单中不存在的版本返回明确错误
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn base_version_missing_returns_error() {
        let _guard = crate::test_support::lock().await;
        let base = serve_mock().await;
        let data_dir = crate::test_support::fresh_data_dir("base-missing");
        crate::storage::override_data_dir(data_dir.clone());
        crate::versions::set_test_manifest_url(&format!("{}/manifest.json", base));

        let error = ensure_base_version_installed("9.99.9", None)
            .await
            .expect_err("缺失版本应失败");
        assert!(error.contains("没找到 Minecraft 9.99.9"), "实际错误: {error}");

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// 重复执行合并安装不会产生重复版本目录
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn merged_install_twice_does_not_duplicate_versions() {
        let _guard = crate::test_support::lock().await;
        let base = serve_mock().await;
        let data_dir = crate::test_support::fresh_data_dir("merge-twice");
        crate::storage::override_data_dir(data_dir.clone());
        crate::versions::set_test_manifest_url(&format!("{}/manifest.json", base));

        let profile = json!({
            "id": "fabric-loader-0.99.0-1.99.0",
            "inheritsFrom": "1.99.0",
            "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
            "libraries": [{
                "name": "net.fabricmc:fabric-loader:0.99.0",
                "downloads": { "artifact": {
                    "url": format!("{}/fabric.jar", base),
                    "path": "net/fabricmc/fabric-loader/0.99.0/fabric-loader-0.99.0.jar",
                    "size": 4
                }}
            }]
        });
        let target = "1.99.0-Fabric-0.99.0";

        install_merged_loader("1.99.0", target, &profile, None)
            .await
            .expect("首次合并安装应成功");
        install_merged_loader("1.99.0", target, &profile, None)
            .await
            .expect("重复合并安装应成功");

        let versions = data_dir.join("versions");
        let dirs: Vec<String> = std::fs::read_dir(&versions)
            .unwrap()
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(dirs, vec![target.to_string()], "不应产生重复版本目录");
        assert!(versions.join(target).join(format!("{}.jar", target)).exists());

        let _ = std::fs::remove_dir_all(&data_dir);
    }
