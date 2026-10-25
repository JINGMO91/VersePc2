#![allow(unused_imports)]

// launch/args_builder.rs — 启动参数构建
// 职责：从版本 JSON + 设置 + 账号 构建完整的 JVM/游戏启动参数
//
// 设计原则：
// 1. 复用 dep_check 模块中已迁移的通用辅助函数（find_external_root、find_main_jar、
//    evaluate_rules、select_java_for_version、inspect_java_version 等）
// 2. 本模块内实现 args-builder.js 专属逻辑（replace_variables、deduplicate_game_args、
//    build_classpath、extract_natives_dir、resolve_version_isolation 等）
// 3. 后续重构方向：把通用辅助函数抽离到 launch/common.rs 或 versions.rs 模块

use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::storage;
use crate::utils;

use super::dep_check;
use crate::launch::memory::{
    resolve_max_memory, resolve_memory_mode, MemoryMode,
};

/// 启动参数构建结果
pub struct LaunchArguments {
    /// 完整启动参数列表（JVM 参数 + 主类 + 游戏参数）
    pub args: Vec<String>,
    /// 决策出的最大内存（MB）
    pub max_mem_mb: u64,
}

/// 构建 Minecraft 启动参数
///
/// `external_version_dir`：外部版本目录路径（非外部版本传 None）
/// `custom_game_dir`：自定义游戏目录（覆盖默认决策）
pub fn build_launch_arguments(
    version_json: &Value,
    settings: &Value,
    account: &Value,
    version_id: &str,
    custom_game_dir: Option<&str>,
    external_version_dir: Option<&Path>,
    quick_play_world: Option<&str>,
) -> LaunchArguments {
    let actual_version_id = if !version_id.is_empty() {
        version_id.to_string()
    } else {
        utils::get_str(version_json, "id")
    };
    let is_external = external_version_dir.is_some();
    let external_root = if is_external {
        external_version_dir
            .and_then(dep_check::find_external_root)
            .or_else(|| {
                external_version_dir
                    .and_then(|d| d.parent())
                    .and_then(|p| p.parent())
                    .map(|p| p.to_path_buf())
            })
    } else {
        None
    };

    let data_dir = storage::resolve_data_dir();
    let versions_dir = data_dir.join("versions");
    let libraries_dir = data_dir.join("libraries");
    let assets_dir = data_dir.join("assets");

    // ============== Classpath 与 Natives ==============
    let classpath = build_classpath(version_json, external_version_dir, &libraries_dir);
    let natives_dir = extract_natives_dir(version_json, &actual_version_id, external_version_dir, &data_dir);

    // ============== 游戏目录决策 ==============
    let game_dir = resolve_game_dir(
        &actual_version_id,
        custom_game_dir,
        external_version_dir,
        settings,
        &versions_dir,
        &data_dir,
    );
    // 预创建子目录
    ensure_game_dirs(&game_dir);

    // 复制 Forge log4j2.xml（如存在）
    copy_forge_log4j(&actual_version_id, &versions_dir, &game_dir);

    // ============== Assets 根 ==============
    let mut assets_root = if is_external && external_root.is_some() {
        external_root
            .as_ref()
            .map(|r| r.join("assets"))
            .unwrap_or_else(|| assets_dir.clone())
    } else {
        assets_dir.clone()
    };
    let asset_index = version_json
        .get("assetIndex")
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or(&actual_version_id)
        .to_string();
    // 旧版虚拟资源目录
    if version_json
        .get("assetIndex")
        .and_then(|v| v.get("virtual"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let virtual_dir = assets_root.join("virtual").join("legacy");
        if virtual_dir.exists() {
            assets_root = virtual_dir;
        }
    }

    // ============== 账号信息 ==============
    let player_name = utils::get_str(account, "username");
    let player_name = if player_name.is_empty() {
        "Player".to_string()
    } else {
        player_name
    };
    let raw_access_token = utils::get_str(account, "accessToken");
    // 存储的 accessToken 为密文（enc: 前缀），注入启动参数前必须解密（离线为 "0"/空，解密函数原样返回）
    let raw_access_token = crate::auth::token::decrypt_account_token(&raw_access_token);
    let uuid = if let Some(u) = account.get("uuid").and_then(|v| v.as_str()) {
        if u.is_empty() {
            utils::offline_uuid(&player_name)
        } else {
            u.to_string()
        }
    } else {
        utils::offline_uuid(&player_name)
    };
    // 离线账户生成兼容格式的伪令牌，避免 BootstrapLauncher Base64 解析崩溃
    let is_offline_token = raw_access_token.is_empty() || raw_access_token == "0";
    let access_token = if is_offline_token {
        generate_offline_access_token(&uuid, &player_name)
    } else {
        raw_access_token
    };
    let user_type = match utils::get_str(account, "type").as_str() {
        "microsoft" => "msa".to_string(),
        "legacy" => "legacy".to_string(),
        _ => "mojang".to_string(),
    };

    // ============== Main JAR ==============
    let mut main_jar_path = dep_check::find_main_jar(version_json, &actual_version_id, external_version_dir)
        .unwrap_or_else(|| {
            versions_dir
                .join(&actual_version_id)
                .join(format!("{}.jar", actual_version_id))
        });
    // mainJar 是空文件时回退到 Forge patched client.jar
    main_jar_path = fallback_empty_main_jar(
        &main_jar_path,
        version_json,
        &actual_version_id,
        &libraries_dir,
    );

    // ============== 变量替换字典 ==============
    let library_directory = if is_external && external_root.is_some() {
        external_root
            .as_ref()
            .map(|r| r.join("libraries"))
            .unwrap_or_else(|| libraries_dir.clone())
    } else {
        libraries_dir.clone()
    };
    let cp_separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let mut variables: HashMap<String, String> = HashMap::new();
    variables.insert("auth_player_name".to_string(), player_name.clone());
    variables.insert("version_name".to_string(), actual_version_id.clone());
    variables.insert("game_directory".to_string(), game_dir.to_string_lossy().to_string());
    variables.insert("assets_root".to_string(), assets_root.to_string_lossy().to_string());
    variables.insert("assets_index_name".to_string(), asset_index.clone());
    variables.insert("auth_uuid".to_string(), uuid.clone());
    variables.insert("auth_access_token".to_string(), access_token.clone());
    // 旧版模板占位符：1.7.x 的 --userProperties 需要一个 JSON 对象，
    // 旧版本（1.6 及更早）还会用 auth_session / access_token 传递令牌
    variables.insert("user_properties".to_string(), "{}".to_string());
    variables.insert("auth_session".to_string(), access_token.clone());
    variables.insert("access_token".to_string(), access_token.clone());
    variables.insert("user_type".to_string(), user_type.clone());
    variables.insert(
        "version_type".to_string(),
        format!("VersePC - {}", actual_version_id),
    );
    let resolution = utils::get_str(settings, "resolution");
    let (res_w, res_h) = parse_resolution(&resolution);
    variables.insert("resolution_width".to_string(), res_w.to_string());
    variables.insert("resolution_height".to_string(), res_h.to_string());
    variables.insert(
        "library_directory".to_string(),
        library_directory.to_string_lossy().to_string(),
    );
    variables.insert("classpath_separator".to_string(), cp_separator.to_string());
    variables.insert(
        "natives_directory".to_string(),
        natives_dir.to_string_lossy().to_string(),
    );
    variables.insert("launcher_name".to_string(), "VersePC".to_string());
    variables.insert("launcher_version".to_string(), "1.0.0".to_string());
    variables.insert("classpath".to_string(), classpath.join(cp_separator));
    variables.insert("clientid".to_string(), uuid.clone());
    variables.insert("auth_xuid".to_string(), uuid.clone());
    variables.insert(
        "quickPlayPath".to_string(),
        game_dir.join("quickPlay").to_string_lossy().to_string(),
    );
    variables.insert("quickPlaySingleplayer".to_string(), String::new());
    variables.insert("quickPlayMultiplayer".to_string(), String::new());
    variables.insert("quickPlayRealms".to_string(), String::new());
    // 存档启动：把 quickPlaySingleplayer 变量填成世界名，版本 JSON 中引用该变量的参数即可进世界
    let has_quick_play = quick_play_world.map(|w| !w.is_empty()).unwrap_or(false);
    if let Some(world) = quick_play_world
        && !world.is_empty() {
            variables.insert("quickPlaySingleplayer".to_string(), world.to_string());
        }

    // ============== Mod 数量统计 ==============
    let mod_count = count_mods(&game_dir);

    // ============== 内存决策 ==============
    let (memory_mode, _memory_value) = resolve_memory_settings(settings, &actual_version_id, &data_dir);
    let total_mb = total_physical_memory_mb();
    let free_mb = free_physical_memory_mb();
    let max_mem_mb = resolve_max_memory(&memory_mode, total_mb, free_mb, mod_count);

    // ============== JVM 参数 ==============
    let mut jvm_args: Vec<String> = Vec::new();
    jvm_args.push(format!("-Xmx{}M", max_mem_mb));
    jvm_args.push("-Dlog4j2.formatMsgNoLookups=true".to_string());
    // 不强制 IPv4 栈：保持 JVM 默认双栈，避免仅含 AAAA（IPv6）记录的域名无法连接

    // GC 选择
    let has_user_gc = jvm_args.iter().any(|a| {
        a.starts_with("-XX:+Use") || a.starts_with("-XX:-Use") || a.starts_with("-XX:Use")
    });
    if !has_user_gc {
        push_gc_args(&mut jvm_args, max_mem_mb, mod_count);
    }
    // 大内存下额外启用字符串去重与元空间限制
    let has_user_mem_opt = jvm_args.iter().any(|a| {
        a.contains("StringDeduplication") || a.contains("CompressedClassSpaceSize") || a.contains("MetaspaceSize")
    });
    if !has_user_mem_opt && max_mem_mb >= 2048 {
        let using_g1 = jvm_args.iter().any(|a| a.contains("UseG1GC"));
        if using_g1 {
            jvm_args.push("-XX:+UseStringDeduplication".to_string());
        }
        let meta_mb = if mod_count >= 200 {
            1024
        } else if mod_count >= 100 {
            768
        } else {
            512
        };
        let ccs_mb = meta_mb.min(512);
        jvm_args.push(format!("-XX:CompressedClassSpaceSize={}m", ccs_mb));
        jvm_args.push(format!("-XX:MaxMetaspaceSize={}m", meta_mb));
    }

    // 用户自定义 JVM 参数（版本独立 > 全局）
    let ver_settings = storage::load_version_settings(&actual_version_id, is_external);
    let ver_jvm_args = utils::get_str(&ver_settings, "jvmArgs");
    let effective_java_args = if !ver_jvm_args.trim().is_empty() {
        ver_jvm_args
    } else {
        utils::get_str(settings, "javaArgs")
    };
    if !effective_java_args.trim().is_empty() {
        push_user_jvm_args(&mut jvm_args, &effective_java_args);
    }

    // 整合包自带 CustomSkinLoader（万用皮肤补丁）时的兼容修复：
    // CustomSkinLoader 15.x 在 1.21+ 上打 SkinManager 字节码补丁可能失败并直接崩溃，
    // 崩溃报告建议加 -Dcustomskinloader.ignorePatchFailure=true 忽略该补丁失败。
    // 这里检测到 mods 目录存在 CustomSkinLoader 时自动追加，避免用户手动配置。
    if !jvm_args.iter().any(|a| a.contains("customskinloader.ignorePatchFailure"))
        && has_custom_skin_loader(&game_dir)
    {
        jvm_args.push("-Dcustomskinloader.ignorePatchFailure=true".to_string());
    }

    // CDS 归档
    let selected_java_path = dep_check::select_java_for_version(&actual_version_id, settings, version_json);
    let selected_java_path = if selected_java_path.is_empty() {
        "java".to_string()
    } else {
        selected_java_path
    };
    let java_major_ver = dep_check::inspect_java_version(&selected_java_path)
        .map(|(_, mv)| mv)
        .unwrap_or(8);
    let enable_cds = settings.get("enableCds").and_then(|v| v.as_bool()).unwrap_or(true) && java_major_ver >= 8;
    if enable_cds {
        let cds_dir = data_dir.join("cds");
        let cds_archive = cds_dir.join(format!("{}.jsa", actual_version_id));
        if let Ok(meta) = std::fs::metadata(&cds_archive)
            && meta.len() > 1024 {
                jvm_args.push("-Xshare:on".to_string());
                jvm_args.push(format!("-XX:SharedArchiveFile={}", cds_archive.to_string_lossy()));
            }
    }

    // ============== 加载器类型检测 ==============
    let main_class = {
        let mc = utils::get_str(version_json, "mainClass");
        if mc.is_empty() {
            "net.minecraft.client.main.Main".to_string()
        } else {
            mc
        }
    };
    let game_args_for_detection = version_json
        .get("arguments")
        .and_then(|v| v.get("game"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let has_forge_game_arg = game_args_for_detection.iter().any(|a| {
        a.as_str() == Some("forgeclient") || a.as_str() == Some("forge_server")
    });
    let is_forge = main_class.contains("modlauncher")
        || main_class.contains("fml")
        || main_class.contains("forge")
        || main_class.contains("bootstraplauncher")
        || main_class.contains("BootstrapLauncher")
        || has_forge_game_arg;
    let is_neoforge = main_class.contains("neoforged")
        || main_class.contains("neoforge")
        || game_args_for_detection.iter().any(|a| a.as_str() == Some("--fml.neoForgeVersion"))
        || version_json
            .get("libraries")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter().any(|l| {
                    utils::get_str(l, "name").starts_with("net.neoforged.fancymodloader:loader")
                })
            })
            .unwrap_or(false);
    let _is_fabric = main_class.contains("fabricmc") || main_class.contains("knot");

    // ============== 离线账户禁用 Realms ==============
    let is_offline_account = is_offline_token
        || utils::get_str(account, "type") == "offline";
    if is_offline_account {
        jvm_args.push("-Dminecraft.api.auth=off".to_string());
        jvm_args.push("-Dminecraft.api.env=local".to_string());
    }

    // ============== Forge / NeoForge 特殊 JVM 参数 ==============
    if is_forge || is_neoforge {
        if !jvm_args.iter().any(|a| a.contains("minecraft.client.jar")) {
            jvm_args.push(format!("-Dminecraft.client.jar={}", main_jar_path.to_string_lossy()));
        }
        if !jvm_args.iter().any(|a| a.contains("earlyLoadingWindow")) {
            jvm_args.push("-Dfml.earlyLoadingWindow=false".to_string());
        }
    }

    // JPMS 模块开放（仅 Java 9+）
    if (is_forge || is_neoforge) && java_major_ver >= 9 {
        push_jpms_flags(&mut jvm_args);
    }

    // ============== 收集版本 JSON 中的 JVM 参数 ==============
    let has_custom_resolution = !resolution.is_empty();
    collect_jvm_args_from_json(&mut jvm_args, version_json, &variables, has_custom_resolution, has_quick_play);

    // 始终使用 java.library.path
    fix_library_path(&mut jvm_args, &natives_dir);

    if !jvm_args.iter().any(|a| a.contains("minecraft.launcher.brand")) {
        jvm_args.push("-Dminecraft.launcher.brand=VersePC".to_string());
        jvm_args.push("-Dminecraft.launcher.version=1.0.0".to_string());
    }
    if !jvm_args.iter().any(|a| a.contains("log4j2.formatMsgNoLookups")) {
        jvm_args.push("-Dlog4j2.formatMsgNoLookups=true".to_string());
    }

    // macOS 必须在主线程启动（LWJGL 要求），用户已配置时不重复添加
    if cfg!(target_os = "macos")
        && !jvm_args.iter().any(|a| a.starts_with("-XstartOnFirstThread"))
    {
        jvm_args.insert(0, "-XstartOnFirstThread".to_string());
    }

    // module-path 中的引导 JAR 加入 ignoreList
    update_ignore_list_for_module_path(&mut jvm_args);

    // Forge/NeoForge：确保客户端 jar 加入 ignoreList。
    // BootstrapLauncher 按"文件名前缀"匹配 ignoreList（filename.startsWith(filter)）。
    // 本启动器的客户端 jar 命名为 "1.19.2-forge-43.2.21.jar"（版本号在前），
    // 不以 "forge-" 前缀开头，若不加进 ignoreList，该 jar 会在 classpath 中被再次
    // 加载为一个普通模块（_1._19._2.forge），与 -Dminecraft.client.jar 加载的
    // minecraft 模块同时导出 com.mojang.blaze3d.platform，导致模块解析冲突崩溃。
    if is_forge || is_neoforge {
        ensure_main_jar_in_ignore_list(&mut jvm_args, &main_jar_path);
    }

    // 始终使用完整 classpath（包含 client jar）
    let mut final_classpath = classpath.clone();
    let main_jar_str = main_jar_path.to_string_lossy().to_string();
    if !main_jar_str.is_empty() && main_jar_path.exists() {
        // NeoForge 新版 (20.6+/21.x/26.x)：版本目录 jar 即 patched jar 的副本，
        // 不能加入 classpath。patched jar 与 universal jar 均由 -DlibraryDirectory +
        // --fml.neoForgeVersion 让 FML 的 ProductionClientProviderLocator 自动发现并加载。
        // 若把版本目录 jar 加入 classpath，RequiredSystemFiles 会扫描到它，但 patched jar 用
        // --no-mod-manifest 构建、不含 NeoForgeMod.class，FML 会把它误判为 DEV（开发）模式，
        // 报 "Couldn't find NeoForgeMod.class" 与 "The patched Minecraft jar is missing"。
        let is_new_neoforge = main_class.contains("net.neoforged.fml.startup")
            || game_args_for_detection.iter().any(|a| a.as_str() == Some("--fml.neoForgeVersion"));
        if !is_new_neoforge {
            if !final_classpath.contains(&main_jar_str) {
                final_classpath.push(main_jar_str);
            }
        } else {
            println!("[ArgsBuilder] NeoForge 新版: 跳过版本目录 jar (由 -DlibraryDirectory locator 自动发现): {}", main_jar_str);
        }
    }
    let classpath_str = final_classpath.join(cp_separator);
    jvm_args.push("-cp".to_string());
    jvm_args.push(classpath_str);

    // 第三方登录：注入 authlib-injector javaagent
    if utils::get_str(account, "type") == "thirdparty" {
        let server_url = utils::get_str(account, "serverUrl");
        if !server_url.is_empty() {
            inject_authlib_agent(&mut jvm_args, &data_dir, &server_url);
        }
    }

    // log4j2 配置文件下载与注入
    inject_log4j_config(&mut jvm_args, version_json, &actual_version_id, &versions_dir);

    // ============== 主类 ==============
    jvm_args.push(main_class.clone());

    // ============== 游戏参数 ==============
    let mut game_args: Vec<String> = Vec::new();
    collect_game_args_from_json(&mut game_args, version_json, &variables, has_custom_resolution, has_quick_play);

    // 旧版 minecraftArguments 模板
    if let Some(template) = version_json.get("minecraftArguments").and_then(|v| v.as_str()) {
        let replaced = replace_variables(template, &variables);
        for part in replaced.split_whitespace() {
            if !part.is_empty() {
                game_args.push(part.to_string());
            }
        }
    }

    // 全屏 / 分辨率
    // 先清理 game_args 中可能残留的 --fullscreen、--width、--height，
    // 确保不会因为版本 JSON 或前序处理引入多余的全屏/窗口参数。
    let mut i = 0;
    while i < game_args.len() {
        if game_args[i] == "--fullscreen" {
            game_args.remove(i);
        } else if game_args[i] == "--width" || game_args[i] == "--height" {
            if i + 1 < game_args.len() && !game_args[i + 1].starts_with("--") {
                game_args.remove(i + 1);
            }
            game_args.remove(i);
        } else {
            i += 1;
        }
    }

    let fullscreen = settings.get("fullscreen").and_then(|v| v.as_bool()).unwrap_or(false);
    if fullscreen {
        // 全屏启动：以当前桌面分辨率作为窗口尺寸。
        // 若不显式传入 --width/--height，Minecraft 会用默认较小分辨率（如 854x480）
        // 进入独占全屏，把显示模式切换到该值，从而修改系统分辨率。
        // 显式传桌面分辨率后，全屏显示模式与系统分辨率一致，系统分辨率保持不变。
        let (w, h) = {
            let (screen_w, screen_h, _) = get_screen_size();
            if screen_w > 0 && screen_h > 0 {
                (screen_w, screen_h)
            } else {
                (res_w, res_h)
            }
        };
        game_args.push("--fullscreen".to_string());
        game_args.push("--width".to_string());
        game_args.push(w.to_string());
        game_args.push("--height".to_string());
        game_args.push(h.to_string());
    } else {
        let (w, h) = adjust_window_resolution(res_w, res_h, &game_args);
        game_args.push("--width".to_string());
        game_args.push(w.to_string());
        game_args.push("--height".to_string());
        game_args.push(h.to_string());
    }

    // versionType
    let version_type_idx = game_args.iter().position(|a| a == "--versionType");
    if version_type_idx.is_none() {
        let custom_info = utils::get_str(settings, "customInfo").trim().to_string();
        let window_title = utils::get_str(settings, "windowTitle").trim().to_string();
        let vt = if !window_title.is_empty() {
            window_title
        } else if !custom_info.is_empty() {
            custom_info
        } else {
            "VersePC".to_string()
        };
        game_args.push("--versionType".to_string());
        game_args.push(vt);
    }

    // 确保 --gameDir / --assetsDir 已设置且变量已替换。
    // minecraftArguments 模板用 split_whitespace 拆分，含空格的路径（如
    // "E:\Verse Explorer X\..."）会被拆成多段，这里用权威值整体覆盖并清理残留。
    ensure_flag_arg(&mut game_args, "--gameDir", &game_dir.to_string_lossy());
    ensure_flag_arg(&mut game_args, "--assetsDir", &assets_root.to_string_lossy());
    ensure_flag_arg(&mut game_args, "--assetIndex", &asset_index);
    ensure_flag_arg(&mut game_args, "--username", &player_name);
    ensure_flag_arg(&mut game_args, "--uuid", &uuid);
    ensure_flag_arg(&mut game_args, "--accessToken", &access_token);
    ensure_flag_arg(&mut game_args, "--userType", &user_type);
    ensure_flag_arg(&mut game_args, "--version", &actual_version_id);

    // 去重游戏参数
    let final_game_args = deduplicate_game_args(&game_args);

    let mut all_args = jvm_args;
    all_args.extend(final_game_args);

    // 清理已知会导致 Java 17/21 崩溃的参数
    sanitize_jvm_args(&mut all_args, java_major_ver);

    LaunchArguments {
        args: all_args,
        max_mem_mb,
    }
}


// ============================ 辅助函数 ============================

























































/// mainJar 是空文件时回退到 Forge patched client.jar
fn fallback_empty_main_jar(
    main_jar_path: &Path,
    version_json: &Value,
    _version_id: &str,
    libraries_dir: &Path,
) -> PathBuf {
    let metadata = match std::fs::metadata(main_jar_path) {
        Ok(m) => m,
        Err(_) => return main_jar_path.to_path_buf(),
    };
    if metadata.len() != 0 {
        return main_jar_path.to_path_buf();
    }
    let game_args = version_json
        .get("arguments")
        .and_then(|v| v.get("game"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let is_forge = game_args.iter().any(|a| a.as_str() == Some("forgeclient"))
        || utils::get_str(version_json, "mainClass")
            .to_lowercase()
            .contains("bootstraplauncher");
    if !is_forge {
        return main_jar_path.to_path_buf();
    }
    let mut fv = String::new();
    let mut mv = String::new();
    for (idx, a) in game_args.iter().enumerate() {
        if a.as_str() == Some("--fml.forgeVersion") && idx + 1 < game_args.len()
            && let Some(v) = game_args[idx + 1].as_str() {
                fv = v.to_string();
            }
        if a.as_str() == Some("--fml.mcVersion") && idx + 1 < game_args.len()
            && let Some(v) = game_args[idx + 1].as_str() {
                mv = v.to_string();
            }
    }
    if mv.is_empty() {
        mv = utils::get_str(version_json, "clientVersion");
    }
    if fv.is_empty() || mv.is_empty() {
        return main_jar_path.to_path_buf();
    }
    let patched_jar = libraries_dir
        .join("net")
        .join("minecraftforge")
        .join("forge")
        .join(format!("{}-{}", mv, fv))
        .join(format!("forge-{}-{}-client.jar", mv, fv));
    if patched_jar.exists()
        && let Ok(meta) = std::fs::metadata(&patched_jar)
            && meta.len() > 0 {
                return patched_jar;
            }
    main_jar_path.to_path_buf()
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// 同一个库的不同版本必须归并到 group:artifact 键
    #[test]
    fn lib_artifact_key_groups_versions_and_classifiers() {
        assert_eq!(
            lib_artifact_key("org.ow2.asm:asm:9.6"),
            Some("org.ow2.asm:asm".to_string())
        );
        assert_eq!(
            lib_artifact_key("org.ow2.asm:asm:9.10.1"),
            Some("org.ow2.asm:asm".to_string())
        );
        assert_eq!(
            lib_artifact_key("org.lwjgl:lwjgl:3.3.1:natives-windows"),
            Some("org.lwjgl:lwjgl".to_string())
        );
        assert_eq!(lib_artifact_key("broken"), None);
    }

    /// 版本比较按数字段比较，避免 9.10 被误判小于 9.6
    #[test]
    fn library_version_compare_handles_multi_digit_segments() {
        use std::cmp::Ordering;
        assert_eq!(compare_lib_version("9.10.1", "9.6"), Ordering::Greater);
        assert_eq!(compare_lib_version("1.21.10", "1.21.4"), Ordering::Greater);
        assert_eq!(compare_lib_version("3.3.1", "3.3.1"), Ordering::Equal);
    }

    /// Maven 坐标转仓库相对路径
    #[test]
    fn maven_name_to_path_builds_expected_jar_path() {
        assert_eq!(
            maven_name_to_path("com.google.code.gson:gson:2.10"),
            Some("com/google/code/gson/gson/2.10/gson-2.10.jar".to_string())
        );
        assert_eq!(
            maven_name_to_path("org.lwjgl:lwjgl:3.3.1:natives-windows"),
            Some("org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar".to_string())
        );
        assert_eq!(maven_name_to_path("too:short"), None);
    }

    /// $var 替换必须遵守边界，不能把 $versionX 误替换成 $version
    #[test]
    fn replace_variables_respects_token_boundary() {
        let mut vars = HashMap::new();
        vars.insert("version".to_string(), "1.2.3".to_string());
        let out = replace_variables("${version} $versionX $version", &vars);
        assert_eq!(out, "1.2.3 $versionX 1.2.3");
    }

    /// 原生包后缀必须与当前平台一致
    #[test]
    fn native_os_name_matches_target_platform() {
        let expected = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        };
        assert_eq!(native_os_name(), expected);
    }
}


// 子模块声明与公共导出
mod jvm;
pub(crate) use jvm::*;
mod classpath;
pub(crate) use classpath::*;
mod natives;
pub(crate) use natives::*;
mod env;
pub(crate) use env::*;
mod game;
pub(crate) use game::*;
