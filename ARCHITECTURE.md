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
| 单元测试 | `npm run test` | 40 项通过 |
| 循环依赖 | `npm run arch:cycles`（madge） | 0 条 |
| 生产构建 | `npm run build:web` | 成功，无构建警告 |
| 架构护栏 | `node scripts/check-architecture.mjs --strict` | 通过 |
| 依赖审计 | `npm run audit` | 0 漏洞 |

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
- 400/800/1500 行级超大文件以警告形式报告，提示继续拆分。

## 当前指标

| 指标 | 数值 |
| --- | --- |
| 前端业务 JS/MJS 文件 | 221 |
| Vue SFC | 61 |
| Rust 文件 | 167 |
| 前端最大业务文件 | `dynamic-island-agent.js` 799 行 |
| Rust 最大文件 | `modloaders/shared.rs` 1389 行 |
| 首屏 JS（入口 + modulepreload） | 17 个文件，545.5 KB（上限 800 KB） |
| 最大生产分包 | `vue.esm-bundler` 173.2 KB；业务入口 `main` 166.2 KB（上限 600 KB） |
| JS 循环依赖 | 0 |
| ESLint | 0 warning |
| npm 依赖漏洞 | 0 |
| Rust Clippy | `-D warnings` 通过 |
| Rust 测试 | 27 项通过（含安装链路 mock 服务集成测试） |

## 测试策略

- **Vitest**：纯函数与状态逻辑，覆盖工具函数、API 封装、动作委托、版本卡片、模组版本排序、修复计划等。
- **Playwright**：以 mock `window.__TAURI_INTERNALS__` 的方式启动真实构建产物，验证静态模板注入、弹窗关闭、标签切换，以及“无未注册动作”的运行期约束。
- **Rust**：单元测试与 axum mock server 集成测试；测试通过 `storage::override_data_dir` 隔离数据目录，并覆盖“原版 + 加载器合并安装只产生单一实例”等关键行为。
- **手动验证**：涉及 UI 与启动链路的改动，按“构建 → 启动软件 → 进入对应页面操作”的流程实测。
- **本轮实测记录（2026-10-24）**：便携构建启动后通过 WebView2 调试端口依次打开 20 个页面，并完成“模组列表 → 模组详情 → 返回”链路；结果为 0 个未捕获异常、0 个控制台错误、0 个中转层缺失警告。

## 约定

- 新增页面：在 `PAGE_LOADERS` 登记动态 import；禁止在启动路径静态引入页面模块。
- 新增跨模块回调：在 `core/lazy-loaders.js` 注册名称，不要为了回调 import 具体页面模块。
- 新增导航：通过 `core/navigation.js`，不要让业务模块反向依赖 `versions-nav`。
- 公共组件不得 import 页面或业务模块。
- 新增样式：优先 Tailwind 工具类与 `components/verse`；确需独立 CSS 文件时必须在 `check-architecture.mjs` 登记并说明原因。
- 代码注释使用中文，不写入与实现无关的来源说明。
