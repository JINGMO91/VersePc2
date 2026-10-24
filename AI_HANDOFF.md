# VersePC2 AI 交接文档

- 更新时间：2026-10-24
- 适用对象：接手本项目的下一个 AI / 开发者
- 对话语言：简体中文

## 1. 项目概况

VersePC2 是一个基于 **Tauri 2 + Rust + Vue 3（原生 JS 模板 + Vite 构建）** 的 Minecraft 启动器。

- 项目路径：`d:\Verse Explorer X\versepc2`
- 当前版本：`1.7.2`（`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Info.plist` 三处保持一致）
- GitHub：`doujie081231/VersePc2`
- Gitee：`doujie081231/verse-pc2`
- 当前主分支：`main`
- 发布状态：1.7.2 已发布；1.7.3 尚未发布
- 2026-10-24 已完成架构重构 Phase 1–15：前端全量 ES Modules、移除全局暴露、前后端大文件拆分、CSS 分模块、前端单测补齐、编译告警与 Clippy 清零

## 2. 关键目录与模块

| 路径 | 职责 |
| --- | --- |
| `frontend/` | Vite 前端工程：`src/main.js` 入口、`src/core/`、`src/features/`、`src/vue/` |
| `frontend/public/` | 原样复制的静态资源（css、图片、`js/` 下的 vendor 库） |
| `frontend-dist/` | Vite 构建产物（gitignore，不再入库） |
| `src-tauri/src/lib.rs` | Tauri 入口、窗口状态、协议注册、命令注册 |
| `src-tauri/src/storage.rs` | 数据目录、默认 `.minecraft` 目录、settings/accounts 读写 |
| `src-tauri/src/java.rs` | Java 扫描、导入、Mojang 运行时安装 |
| `src-tauri/src/launch/args_builder.rs` | 启动参数、classpath、natives、macOS `-XstartOnFirstThread` |
| `src-tauri/src/launch/dep_check.rs` | 依赖完整性检查、平台/架构规则匹配 |
| `src-tauri/src/updater.rs` | 三平台自动更新（Windows .bat、macOS .app 替换、Linux 二进制替换） |
| `src-tauri/src/filesystem.rs` | 文件浏览白名单、打开文件夹、驱动器列表 |
| `src-tauri/src/versions/` | 版本目录、扫描、外部版本识别、修复、诊断、导出（`mod.rs` 统一分发） |
| `src-tauri/src/api/mods/` | 模组列表/搜索/详情/下载/依赖/管理路由（按域拆分） |
| `src-tauri/src/api/resources/` | 资源搜索/详情/下载/图片代理路由（按域拆分） |
| `src-tauri/src/modpack/` | CurseForge / Modrinth / theseus 整合包导入；`mrpack_native/` 已拆分 |
| `src-tauri/src/modloaders/` | Forge / NeoForge / Fabric / OptiFine 安装 |
| `.github/workflows/release-build.yml` | macOS（x86_64/arm64）与 Linux 构建 |
| `scripts/winstubs.c` | 非 Windows 构建时为 Windows 库提供空实现 |

## 3. 构建方法

### 3.1 Windows 本地构建

本机工具链不在系统 PATH，必须先注入环境。`build-msvc.ps1` 已包含全部环境变量，直接运行即可：

```powershell
cd 'D:\Verse Explorer X\versepc2'
npm ci                # 首次或依赖变更后
.\build-msvc.ps1
```

构建前会由 `tauri.conf.json` 的 `beforeBuildCommand` 自动执行 `npm run build:web`（Vite 输出到 `frontend-dist`），产物复制到 `dist\VersePC2.exe`。`frontend-tauri` 已不再入库，也不要手动创建。

关键路径：

- MSVC：`D:\VerseTools\VSBuildTools\VC\Tools\MSVC\14.44.35207`
- Windows SDK：`C:\Program Files (x86)\Windows Kits\10`，版本 `10.0.26100.0`
- Rustup：`D:\VerseTools\.rustup`
- Cargo：`D:\VerseTools\.cargo`
- Cargo target：`E:\VerseTools\.verse-target`
- Node：`D:\VerseTools\node-v22.23.2-win-x64\node.exe`

只做编译检查时使用：

```powershell
$env:RUSTUP_HOME='D:\VerseTools\.rustup'; $env:CARGO_HOME='D:\VerseTools\.cargo'
$env:CARGO_TARGET_DIR='E:\VerseTools\.verse-target'
$MSVC='D:\VerseTools\VSBuildTools\VC\Tools\MSVC\14.44.35207'
$SDK='C:\Program Files (x86)\Windows Kits\10'; $SDKV='10.0.26100.0'
$env:PATH = (@("$MSVC\bin\Hostx64\x64","$SDK\bin\$SDKV\x64","D:\VerseTools\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin","D:\VerseTools\.cargo\bin") -join ';') + ';' + $env:PATH
$env:INCLUDE = (@("$MSVC\include","$MSVC\atlmfc\include","$SDK\Include\$SDKV\ucrt","$SDK\Include\$SDKV\um","$SDK\Include\$SDKV\shared","$SDK\Include\$SDKV\winrt") -join ';')
$env:LIB = (@("$MSVC\lib\x64","$MSVC\atlmfc\lib\x64","$SDK\Lib\$SDKV\ucrt\x64","$SDK\Lib\$SDKV\um\x64") -join ';')
& 'D:\VerseTools\.cargo\bin\cargo.exe' check
```

### 3.2 macOS / Linux 构建

由 CI 完成，核心步骤：

1. `npm ci && npm run build:web`（Vite 输出 `frontend-dist`）
2. 编译 `scripts/winstubs.c`，生成 `libkernel32.a` / `libshell32.a`，加入 `RUSTFLAGS=-L`
3. `cargo build --release --bin verse-tauri --manifest-path src-tauri/Cargo.toml`
4. macOS 手工组装 `VersePC2.app`，写 Info.plist 版本、复制 `icon.icns`、`codesign --force --deep --sign -`
5. Linux 直接输出 `VersePC2-linux-x86_64`

注意：**不能使用 `cargo tauri build`**，否则 Linux/macOS 会因 cdylib 链接 Windows 库报 `unable to find library -lkernel32`。CI 使用普通 `cargo build --bin`。

## 4. 发布流程

### 4.1 版本号

同步修改：

- `src-tauri/Cargo.toml` 的 `[package] version`
- `src-tauri/tauri.conf.json` 的 `version`
- `src-tauri/Info.plist` 的 `CFBundleShortVersionString` / `CFBundleVersion`

### 4.2 发布产物命名

- Windows：`dist\VersePC2.exe`
- Linux：`VersePC2-linux-x86_64`
- macOS Intel：`VersePC2-macos-x86_64.zip`
- macOS Apple Silicon：`VersePC2-macos-aarch64.zip`

### 4.3 GitHub 推送

`github.com:443` 直连经常被阻断：

- fetch：`origin` 已配置为 `https://ghproxy.net/https://github.com/doujie081231/VersePc2.git`
- push：不要直接 `git push`。使用 GitHub Git Data API 脚本
  `%TEMP%\verse-release-tools\push-commit.mjs`
  - 用法：`node push-commit.mjs "commit message" <文件列表txt>`
  - 脚本会基于远端 `main` 的 tree 创建 blob/tree/commit，并更新 ref
  - Token 位于 `%TEMP%\verse-release-tools\.ghtoken`，**不要把 token 写入仓库或文档**
  - 临时文件列表可随时重建；用户可能清理 `%TEMP%` 下的列表文件
- API 推送后，本地提交哈希会与远端不同，需要同步：

```powershell
git fetch origin main
git reset --hard origin/main
```

### 4.4 Release 与 CI

1. 创建 tag（例如 `v1.7.3`），触发 `release-build.yml`
2. GitHub Release 上传 Windows 包
3. CI 在 tag 上构建并上传 mac/linux 包
4. 手动 `workflow_dispatch` 只验证编译，不会上传安装包（打包步骤有 tag 条件）
5. Gitee Release 上传 Windows 包
6. 更新 `update.json`：Windows 走 Gitee，macOS/Linux 走 GitHub；填写各平台 `size` 与 `sha256`

Gitee 附件总配额约 1GB，曾因超限删除 v1.1.x～v1.6.0 共 12 个旧 Release。发布前先检查配额。

## 5. 网络与凭证

- GitHub API 可用，直接 git push 不稳定；使用 `push-commit.mjs`
- GitHub Token 只在 `%TEMP%\verse-release-tools\.ghtoken`
- Gitee Token 不在文档中记录，需要时向用户索取
- 下载源优先官方，失败时走 BMCLAPI / ghproxy / jsDelivr 等镜像
- 发布时优先使用镜像上传，不使用代理

## 6. 跨平台适配现状（2026-10-23）

### 6.1 已完成

- 统一默认游戏目录：`storage::default_minecraft_dir`
  - Windows：`%APPDATA%\.minecraft`
  - macOS：`~/Library/Application Support/minecraft`
  - Linux：`~/.minecraft`
- Java：
  - macOS/Linux 常见 JDK 路径扫描（`/Library/Java`、Homebrew、`java_home`、`/usr/lib/jvm`、SDKMAN 等）
  - 跳过 macOS `/usr/bin/java` 系统占位程序
  - JDK 判断使用平台对应的 `javac`
  - macOS 文件夹导入支持 `.jdk/Contents/Home`
  - Mojang 运行时：`link` 条目建符号链接、`executable` 加执行权限、`jre.bundle/Contents/Home/bin/java` 路径识别
- 原生库：
  - 规则名 `osx` 与原生包后缀 `macos` 分离处理
  - arm64 优先 `natives-*-arm64`，x86_64 拒绝 arm 变体
  - 新格式原生库检查使用正确的 `macos` 后缀与架构
  - LWJGL2 不再要求 `glfw`，避免每次启动重复解压 natives
- 路径与进程：
  - classpath / PATH 分隔符按平台
  - `taskkill`、`kill -9`、`tasklist`、`wmic`、`where` / `which` 分平台
  - 回收站：Windows PowerShell、macOS Finder、Linux `gio trash` / `trash-put`
  - 桌面快捷方式：Windows `.lnk`、macOS 符号链接、Linux `.desktop`
- 文件与压缩包：
  - ZIP entry 反斜杠统一为 `/`（整合包 overrides、mrpack、theseus、云存档、原生产物）
  - macOS Finder 使用 `open -R` 定位文件，Linux 打开父目录
- 窗口与更新：
  - 窗口尺寸/最大化状态记忆
  - macOS 自绘窗口按钮
  - 三平台自动更新实现
  - `wewp://` 同时兼容 `http://wewp.localhost`
- 打包：
  - CI 为 macOS 增加 ad-hoc codesign
  - `LSMinimumSystemVersion` 调整为 10.15

### 6.2 平台限制（有意保留）

以下功能依赖 Windows 二进制或系统 API，非 Windows 会返回明确错误提示：

- 陶瓦联机（EasyTier / terracotta）
- EnderLink（frpc）
- 场景渲染器
- Wallpaper Engine 壁纸
- 系统级内存优化（EmptyWorkingSet）

### 6.3 前端架构现状（2026-10-24 重构后）

- 构建：Vite 8 + ES Modules，唯一入口 `frontend/src/main.js`，产物 `frontend-dist`。
- 所有业务脚本已迁入 `frontend/src/features/`，`public/js` 只保留 vendor 库（three、skinview3d、marked）。
- Vue 页面在 `frontend/src/vue/pages/`，由 `src/vue/mount.js` 分批挂载；页面模板不再使用 `onclick`，统一 `@click` / 组件方法。
- 动态 HTML 使用 `data-action` 事件委托（`src/core/actions.js`），不再向 window 挂业务函数。
- `src/legacy/globals.js` 与 `public/js/app.js` 已删除。
- 跨模块共享状态：`core/app-state.js`、`core/game-store.js`、`core/vm-holders.js`、`core/feature-bridge.js`、`features/mods/detail-state.js`。
- `core/vue-ready.js` 提供挂载完成等待（支持多个等待方）。
- `core/plugin-compat.js` 是唯一允许向 window 暴露插件接口的兼容层，供已安装插件继续调用 `initServerHostPage` / `showToast` 等既有函数。
- 插件组件仍通过 `window.VersePC['Plugin_<id>_<page>']` 注册，由 `plugin-runtime.js` 同步到内部组件表后挂载。
- 样式仍以 `<link>` 方式引用 `public/css`；`components.css` 已拆到 `public/css/components/` 下 13 个域文件，按原行序引入。
- 大文件拆分采用“门面 + 子模块 + 状态模块”：原文件保留 re-export，子模块只读写 `<域>-state.js` 中的共享状态，跨域共享常量下沉到 `core/constants.js`。
- Rust 大文件拆为目录模块，`#[tauri::command]` 函数保留在 `mod.rs`，子模块通过 `pub(crate) use` 回传，调用路径不变。
- 前端测试：`src/**/*.test.js` 共 8 个文件 40 个用例；需要 DOM 的文件用 `// @vitest-environment jsdom`。
- 架构阈值：前端单文件 ≤800 行、Rust 单文件 ≤1500 行，`check-architecture.mjs` 零提示。

### 6.4 已知小问题（未修，优先级低）

- 文件浏览器会显示驱动器/挂载点，但后端白名单只允许 home/data 等路径，点击驱动器根目录可能返回 403
- macOS/Linux 上“内存优化”设置卡片仍可见，仅按钮被 `.win-only` 隐藏
- `get_screen_size` 的 macOS 实现存在但当前仅 Windows 调用
- Linux 仅提供 x86_64 构建；Mojang 运行时 Linux 平台键仍固定为 `linux`
- 1.7.2 的 `dist\VersePC2.exe` 早于最新跨平台修复

## 7. 重要经验与坑

### 7.1 行尾（CRLF/LF）

- 仓库约定：远端 blob 大多是 CRLF
- 本机 `core.autocrlf=true`
- `push-commit.mjs` 直接读取工作区原始字节并 base64 上传，不会做行尾转换
- 如果某个文件原本是 LF、编辑后变成 CRLF，会产生整文件 diff（`api/cloud.rs` 曾出现一次）
- 处理方式：保持文件原有行尾；API 推送后 `git fetch origin main` + `git reset --hard origin/main` 对齐本地

### 7.2 Minecraft 平台命名

- 版本 JSON 的 `rules.os.name`：`windows` / `osx` / `linux`
- 原生包 classifier 后缀：`windows` / `macos` / `linux`
- 架构：`x86` / `x64` / `arm64` / `aarch64`
- 两套命名不能混用，`dep_check.rs`、`args_builder.rs`、`install/mod.rs` 均有独立处理

### 7.3 Java

- macOS 的 JDK 真实路径通常在 `.jdk/Contents/Home` 或 `jre.bundle/Contents/Home`
- 不要假设 `install_dir/bin/java`
- macOS `/usr/bin/java` 是占位程序，执行会弹系统安装提示，必须排除
- JDK 判断用 `bin/javac`，JRE 没有

### 7.4 Rust / Tauri

- `Cargo.toml` 的 `crate-type` 是 `["rlib"]`，因为 cdylib/staticlib 在 macOS/Linux 会强制链接 Windows 库
- 非 Windows 构建必须编译 `scripts/winstubs.c`
- `additionalBrowserArgs` 是 WebView2 专属，其他平台忽略
- 窗口 `decorations:false`，三平台都使用自绘窗口按钮

### 7.5 已修复的历史问题

- Fabric/原版重复 ASM 库导致退出码 1：classpath 按 `group:artifact` 去重保留最高版本
- 启动即退只提示“检查 Java 版本”：现在把 stderr 根因展示给用户
- 运行中每 2 分钟强制内存压缩导致卡顿：移除窗口可见时的周期压缩
- CurseForge 下载失败：并发上限 64、官方源回退、修正“下载已取消”误导提示
- 窗口大小不记忆：实现尺寸/最大化状态持久化

## 8. 用户协作规则（必须遵守）

- 全程简体中文交流；代码注释也用中文
- **不要猜测**。修 bug 先看日志、源码、复现；参考 zl2 / FCL / PCL2 / Mordin 官方启动器时要看实际实现
- 代码中**不得出现“参考/借鉴某启动器”的注释**；发布前清理所有参考启动器痕迹
- 能迁移成熟实现就不要自研；软件标准以 Pojav 启动器为准则，PC 行为参考 PCL2
- 软件问题要用模拟器实测验证，禁止只靠静态推断
- 构建/安装/校验过程要主动轮询状态，不要后台静默执行
- 发布内测版必须清理参考启动器注释
- 设备不在本地时，构建产物放专门文件夹；远程传输前删除旧构建
- 发布使用镜像上传，不使用代理
- 关于页不显示“保存设置”按钮；致谢软件使用各自官方图标
- 版本设置的模组管理页面迁移 FCL 已安装模组管理，卡片比例参考版本下载页，必须显示图标
- 侧边栏按钮默认显示功能名称，设置中可关闭
- 历史明确指令：部分长任务完成后用户曾要求执行关机；若当前任务仍适用，执行前确认任务确实结束

## 9. 验证记录

- 2026-10-23 Windows `cargo check`：通过
- 2026-10-24 架构重构后：
  - `npm run verify`（ESLint + Vitest + Vite 构建 + 架构硬性检查）：通过
  - `cargo test`：25 项通过
  - `cargo clippy -- -D warnings`：零告警
  - 便携版构建成功，启动实测通过：主页、版本列表、版本设置、模组搜索/详情、账户切换、设置各标签、联机页、插件页（开服/内网穿透/种子地图）
  - 下载链路实测：通过 `/api/mods/download-version` 下载 Sodium 至临时目录，进度 100%、文件大小 1912496 字节，校验通过
- 2026-10-24 遗留结构债务治理（Phase 9–15）后：
  - `npm run verify`（ESLint + Vitest 40 项 + Vite 构建 + 架构检查 --strict）：通过
  - `cargo clippy -- -D warnings`：零告警；`cargo test`：25 项通过
  - 架构检查零提示：前端单文件均 ≤800 行、Rust 单文件均 ≤1500 行
  - 便携版构建成功，实测通过：版本列表/详情/版本设置五个标签、账户轮播与详情、模组搜索/详情/版本/依赖、个性化壁纸切换、陶瓦联机、私服大厅、Java 管理、本地开服、启动依赖检查与下载
  - `components.css` 拆为 `public/css/components/` 下 13 个域文件，拼接校验与原文件一致
  - 首次启动依赖补全时，Forge 客户端 JAR 源返回 HTTP 403，界面正确提示缺失文件（外部源问题）
- CI run `39972225672`（commit `2729331`）：Linux x86_64 / macOS arm64 / macOS x86_64 全部 success
- CI run `39977012044`（commit `d470688`）：三平台全部 success
- CI run `39977760242`（commit `8f07e29`）：三平台全部 success
- CI run `39978543107`（commit `45ecf3f`）：三平台全部 success
- 最新跨平台提交链：
  - `3b4b273` 完善 macOS/Linux 跨平台适配
  - `3b2fe6e` 修复原生库选择与 Java 运行时细节
  - `2729331` 修正 macOS Java 路径与原生产物选择
  - `d470688` 完善游戏目录、Java 扫描与压缩包路径
  - `8f07e29` 统一 cloud.rs 行尾
  - `45ecf3f` 修正 macOS JDK 目录导入与 LWJGL2 原生库判定

## 10. 建议的下一步

1. 若发版：版本升到 `1.8.0`，同步 Cargo.toml / tauri.conf.json / Info.plist，重新构建 Windows 包，按第 4 节流程发布
2. 可选：修文件浏览器驱动器 403、隐藏非 Windows 的内存优化卡片；补 Linux arm64 构建矩阵
3. 已完成：`index.html` 内联 `onclick` 已全部迁移为 `data-action`（当前 0 处），并新增 Playwright 冒烟覆盖
4. 可选：给前端纯逻辑模块继续补 Vitest（下载任务状态机、依赖聚合、主题色计算）
5. 继续处理后台用户反馈时，先查日志和相关源码，不要直接猜

## 11. 架构加固 Phase 16–19（2026-10-24）

- 提交链：
  - `122f042` 统一文本文件行尾并新增 `.gitattributes`
  - `b31f1ac` 拆分安装编排为 `InstallCtx` + `install/stages/*`（`perform_installation` 约 40 行）
  - `3724d45` 首屏按页面懒加载功能模块 + 静态弹窗/SVG 图标注入（`index.html` 710 → 483 行）
  - `0c4093f` 安装链路 mock 服务集成测试（只产出单一实例、保留已有原版）
  - `e825f51` Playwright 前端冒烟与 CI `frontend-e2e` job
- 实测：
  - 首屏 JS 846 KB → 约 752 KB；新增护栏：单 chunk >600 KB 或首屏 >800 KB 判失败
  - `cargo clippy -- -D warnings` 零告警；`cargo test` 27 项通过
  - `npm run verify` 通过；`npm run test:e2e` 通过
  - 便携版实测：24 个页面导航、版本设置打开、弹窗动作、下载页切换均无模块加载/引用错误
