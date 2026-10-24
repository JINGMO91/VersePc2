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

    /// 合并安装只产出目标实例：不创建独立原版目录，也不删用户已有原版与数据
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn merged_install_keeps_user_base_version_and_creates_single_instance() {
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
