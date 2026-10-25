# 架构说明

VersePC2 是一个基于 Tauri 2 的 Minecraft 桌面启动器：Rust 负责系统能力与安装/启动链路，前端使用 Vite 构建的原生 ES Module + Vue 3 组件。本文件面向代码评审者，说明分层、约束、质量门禁与当前指标。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2（WebView2 / WKWebView） |
| 后端 | Rust stable，axum 内部 HTTP 服务 |
| 前端 | 原生 ES Module、Vue 3、Vite 8（Rolldown） |
| UI | Tailwind CSS 4、shadcn-vue 原语、自研 `components/verse` 语义层 |
| 测试 | Vitest、Playwright、Rust `cargo test`（axum mock server） |

## 目录结构

```text
frontend/
  index.html                 # 唯一的业务模块入口，不含内联业务脚本
  src/main.js                # 启动编排：静态模板/图标挂载 → 注册 → 初始化
  src/core/                  # 中立基础层：状态、API、动作委托、导航中转、懒加载中转
  src/features/<domain>/     # 业务域（versions、mods、accounts、settings、launch、misc…）
  src/vue/pages/             # 页面级 Vue 组件（按页面动态加载）
  src/vue/modals/            # 静态弹窗模板与挂载逻辑
  src/components/ui/         # shadcn-vue 原语（无业务语义）
  src/components/verse/      # 语义化组件层（按钮、输入框、文本框…）
src-tauri/src/
  install/                   # 安装编排：context + stages（version_json/client_jar/libraries/assets/loader）
  modloaders/                # Forge/Fabric/NeoForge/Quilt 元数据与合并安装
  versions/                  # 版本扫描、清单、修复、导出
  api/                       # 内部 HTTP 路由（mods、launch、game、system…）
  modpack/                   # 整合包解析与安装
e2e/                         # Playwright 前端冒烟（mock Tauri 宿主）
scripts/check-architecture.mjs  # 架构护栏（CI 阻断项）
.github/workflows/verify.yml    # Lint / 测试 / 循环依赖 / 依赖审计 / 构建 / Rust 检查
```

## 分层与依赖方向

依赖只能自上而下，禁止反向引用：

1. `core` 不依赖任何 `features` 或 `vue`。
2. `features/*` 可以依赖 `core` 与同域模块；跨域调用必须走中立入口。
3. `vue/pages` 只负责视图与事件绑定，业务实现留在 `features`。
4. `components/ui` 无业务逻辑；`components/verse` 只做语义封装。

跨域回调通过两个中立中转层解耦，避免页面模块与公共组件互相 import：

- `core/navigation.js`：注册/调用页面导航与版本详情打开。
- `core/lazy-loaders.js`：按名称注册/触发页面模块能力（刷新列表、填充筛选器、打开详情等）。

页面模块本身在 `features/versions/versions-nav.js` 的 `PAGE_LOADERS` 中以静态字面量动态 `import()` 登记，保证构建期可分析、运行期按页分包。

## 质量门禁

一条命令覆盖前端全部阻断项：

```bash
npm run verify
```

等价于依次执行：

| 步骤 | 命令 | 当前结果 |
| --- | --- | --- |
| ESLint | `npm run lint` | 0 error / 0 warning |
| 单元测试 | `npm run test` | 95 个文件 / 1410 项通过 |
| 覆盖率棘轮 | `npm run test:coverage:check` | core 90.9% / features 55.4% / 总 57.0% 基线 |
| 循环依赖 | `npm run arch:cycles`（madge） | 0 条 |
| 生产构建 | `npm run build:web` | 成功，无构建警告 |
| 架构护栏 | `node scripts/check-architecture.mjs --strict` | 通过 |
| 依赖审计 | `npm run audit` | 0 漏洞 |

`npm run verify` 保持快速门禁；`npm run verify:full` 额外执行覆盖率统计、覆盖率棘轮与测试密度棘轮。

后端与外层：

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:e2e
```

CI（`.github/workflows/verify.yml`）包含：Lint、前端单测、循环依赖、依赖审计、构建、架构护栏、Playwright 冒烟、Rust 测试与 Clippy。

## 架构护栏明细

`scripts/check-architecture.mjs` 会阻断以下回退：

- 生成目录（`frontend-tauri`、`frontend-dist`）被 Git 跟踪。
- `frontend/index.html` 出现多个业务脚本标签（目标为单模块入口）。
- `window.*` 赋值扩散到 `core/plugin-compat.js` 与 legacy 层之外。
- 新增未登记的独立 CSS 文件（存量样式以快照名单登记，新页面必须使用 Tailwind / 语义组件）。
- 页面模板中超长内联 `style` 超过基线（只允许下降）。
- 首屏 JS 总量超过 800 KB，或单个分包超过 600 KB。
- 650/900 行级超大业务文件以警告形式报告，提示继续拆分（前端 650 行、Rust 900 行）。
- 业务文件超过前端 700 行或 Rust 1200 行时阻断；测试文件不计入该硬阈值。
- `core` 层反向 import `features` 或 `vue`（`plugin-compat.js` 为唯一登记例外）。
- `features` 层反向 import `vue/pages` 或 `vue/modals`。
- `features` 跨域依赖按域到域的边登记，只允许减少；新增跨域调用必须走 `core` 中立入口。
- 模块加载即执行 `setInterval` / `document.addEventListener` / `window.*` 的文件按顶层副作用登记，新增即阻断。
- `features` 直接访问 `window.__TAURI__` / `window.__TAURI_INTERNALS__` 按文件登记存量，只允许下降；新增访问必须走 `core/tauri-bridge.js`。
- `components` 层 import `features`、`vue` 或 `core`。
- 覆盖率与测试密度低于 `scripts/coverage-baseline.json` / `scripts/test-density-baseline.json`（只升不降）。

## 当前指标

| 指标 | 数值 |
| --- | --- |
| 前端业务 JS/MJS 文件 | 230 |
| Vue SFC | 61 |
| Rust 文件 | 187 |
| 前端最大业务文件 | `features/misc/server-host.js` 622 行 |
| Rust 最大文件 | `transfer.rs` 961 行 |
| 首屏 JS（入口 + modulepreload） | 17 个文件，548 KB（上限 800 KB） |
| 最大生产分包 | `vue.esm-bundler` 173.2 KB；业务入口 `main` 166.5 KB（上限 600 KB） |
| JS 循环依赖 | 0 |
| ESLint | 0 warning |
| npm 依赖漏洞 | 0 |
| Rust Clippy | `-D warnings` 通过 |
| Rust 测试 | 123 项通过（含基础版本安装、重复安装、缺失版本等 5 个 mock 服务集成场景） |
| 前端单测 | 95 个文件 / 1410 项 |
| 前端行覆盖 | core 90.9% / features 55.4% / 总计 57.0%（棘轮基线） |
| Playwright E2E | 7 个 spec（启动、导航、设置、版本错误、模组、Java、云盘） |

## 测试策略

- **Vitest**：纯函数与状态逻辑，覆盖工具函数、API 封装、动作委托、导航/懒加载中转、桥接层、版本卡片、模组版本排序、安装路径、置顶存储、下载任务状态机、主题算法、壁纸路径、联机状态与修复计划等；`npm run test:coverage` 产出覆盖率并按基线棘轮。
- **Playwright**：以 mock `window.__TAURI_INTERNALS__` 的方式启动真实构建产物，验证静态模板注入、全页面导航、设置开关、版本接口失败提示、模组页渲染，以及“无未注册动作”的运行期约束。
- **Rust**：单元测试与 axum mock server 集成测试；测试通过 `storage::override_data_dir` 隔离数据目录，并覆盖“原版 + 加载器合并安装只产生单一实例”等关键行为。
- **手动验证**：涉及 UI 与启动链路的改动，按“构建 → 启动软件 → 进入对应页面操作”的流程实测。
- **本轮实测记录（2026-10-24 ~ 10-25）**：便携构建启动后通过 WebView2 调试端口完成 20 个页面导航，并覆盖版本设置五页签、收藏页/子页、反馈页、资源列表与详情、账户皮肤/披风、整合包最小 mrpack 端到端导入、启动诊断/依赖检查/JVM CDS/崩溃分析/路径命令；结果为 0 个未捕获异常。

## 存量边界

以下内容属于有意保留的存量边界，不计入业务源码质量指标：

- `frontend/public/js/*.bundle.js`：第三方运行时（Three.js、skinview3d 等）的生成产物，不手改；首屏与页面按需加载均不包含它们。
- `frontend/public/css/**`：历史页面样式，已在架构检查中登记为快照；新页面禁止新增独立 CSS，存量随页面迁移逐步减少。
- 超大业务文件：核心拆分（版本设置、收藏、反馈、资源、皮肤 API、CurseForge 工具、依赖/启动/系统/游戏接口、更新器）已完成，前端业务文件最大为 `features/misc/server-host.js` 622 行；Rust 超过 900 行告警线的仅剩 `transfer.rs` 961、`server_host/mod.rs` 951，列为后续可选优化项。

## 更新链路资源优化（2026-10-25）

排查结论（依据 `data/logs/updater-download.log` 与 `updater.rs`）：

- 每次重试/换源都新建 `reqwest::Client`，连接池与 TLS 会话被丢弃；同时 30 秒“总请求超时”会把 74 MB 安装包在慢速镜像上反复截断，触发多轮续传。
- 下载完成后用 8 KB 缓冲同步重读整包做 SHA-256；本机实测 74 MB 哈希约 8–10 秒，表现为一段持续的 CPU/磁盘占用，并阻塞异步运行时。
- 进度事件每 300 ms 推送一次且前端每次重建进度 DOM；检查更新会等待全部镜像源返回后才结束。
- `data/updates` 缺少清理，实测残留旧安装包 74 MB 与断点文件 37 MB。

已做优化：

- 下载复用单一 HTTP 客户端（`connect_timeout` 15 秒、总超时 1800 秒），传输停滞由 60 秒无数据检测负责。
- 全新下载在流式写入时同步计算 SHA-256，不再二次读盘；断点续传走 `spawn_blocking` + 1 MB 缓冲异步校验。
- 检查更新改为首个有效源返回即取消其余请求；进度事件节流到 500 ms，前端只更新文本与宽度。
- 自动下载延后 2 秒启动，并自动清理超过 7 天的更新缓存。

## 约定

- 新增页面：在 `PAGE_LOADERS` 登记动态 import；禁止在启动路径静态引入页面模块。
- 新增跨模块回调：在 `core/lazy-loaders.js` 注册名称，不要为了回调 import 具体页面模块。
- 新增导航：通过 `core/navigation.js`，不要让业务模块反向依赖 `versions-nav`。
- 公共组件不得 import 页面或业务模块。
- 新增样式：优先 Tailwind 工具类与 `components/verse`；确需独立 CSS 文件时必须在 `check-architecture.mjs` 登记并说明原因。
- 代码注释使用中文，不写入与实现无关的来源说明。
