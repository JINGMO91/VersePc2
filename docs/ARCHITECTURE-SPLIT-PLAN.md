# 架构拆分续作计划

> 面向当前仓库的存量大文件，按“低风险优先、行为不变、每阶段独立验证”的原则继续拆分。
> 关联文档：[ARCHITECTURE.md](../ARCHITECTURE.md)

## 一、当前基线

最近一次完整门禁结果：

| 项目 | 当前值 |
| --- | --- |
| JS 循环依赖 | 0 |
| ESLint | 0 warning |
| 前端单测 | 33 个文件 / 180 项通过 |
| Rust 测试 | 80 项通过 |
| Rust Clippy | `-D warnings` 通过 |
| 首屏 JS | 约 545 KB（上限 800 KB） |
| npm 漏洞 | 0 |

待继续拆分的大文件（业务源码，不含 vendor / 测试 / 覆盖率产物）：

| 排名 | 文件 | 行数 | 主要问题 |
| --- | --- | --- | --- |
| 1 | `frontend/src/vue/pages/page-version-settings.js` | 735 | 页面 methods 过长，混入模组、导出、存档、置顶等多组职责 |
| 2 | `frontend/src/features/mods/favorites.js` | 725 | 数据加载、列表渲染、多选批量、收藏夹管理混在一个模块 |
| 3 | `frontend/src/features/misc/feedback.js` | 701 | 日志收集、附件管理、表单校验、环境信息混在一起 |
| 4 | `frontend/src/features/mods/resource.js` | 700 | 导入弹窗、列表、详情、安装四条链路同文件 |
| 5 | `src-tauri/src/api/skins.rs` | 1266 | 通用皮肤、微软皮肤库、披风、上传 Mojang 混在一起 |
| 6 | `src-tauri/src/modpack/curseforge_shared.rs` | 1260 | 文件系统工具、JAR 修复、版本链、加载器兼容混在一起 |
| 7 | `src-tauri/src/lib.rs` | 1099 | 窗口命令、移动端逻辑、初始化编排混在入口 |
| 8 | `src-tauri/src/api/mods/deps.rs` | 1061 | 依赖解析、版本匹配、下载编排集中在一个路由文件 |
| 9 | `src-tauri/src/api/launch.rs` | 1053 | 启动前检查、参数构建、进程启动集中在一个文件 |
| 10 | `src-tauri/src/api/system.rs` | 1014 | 系统信息、Java、更新、窗口能力混合 |

## 二、拆分原则

1. **行为不变**：只移动代码与调整导入，不改业务逻辑、DOM 结构、接口路径、状态字段。
2. **单一职责**：每个新模块只承担一组相关职责，文件名能直接说明用途。
3. **依赖方向不变**：`core` 不依赖 `features` / `vue`；页面方法模块只依赖 `core` 与同域 `features`。
4. **不新增耦合**：跨模块回调继续走 `core/lazy-loaders.js`；页面导航继续走 `core/navigation.js`。
5. **每个阶段独立提交**：一个阶段一个 commit，失败可单独回退，不把多个阶段塞进同一次提交。
6. **不碰存量边界**：`frontend/public/css/**` 与 `frontend/public/js/*.bundle.js` 不在本计划范围内。
7. **验证后再进入下一阶段**：上一阶段门禁未全绿，不开始下一阶段。

## 三、阶段计划

### P1 版本设置页方法拆分（低风险，先做）

**目标文件**：`frontend/src/vue/pages/page-version-settings.js`，735 行 → 目标 ≤ 220 行。

**拆分方式**：保留 `data`、`computed`、`watch`、`mounted`、组件注册与模板引用，只把 `methods` 按职责移到三个模块，并在 `methods` 中用对象展开合并。

| 新模块 | 负责方法 | 预计行数 |
| --- | --- | --- |
| `frontend/src/vue/pages/version-settings-methods-core.js` | `openFor`、`close`、`loadSettings`、`saveSetting`、`onCustomNameInput`、Java 相关、CustomSelect、快捷入口、内存、存档、置顶 | 约 300 |
| `frontend/src/vue/pages/version-settings-methods-mods.js` | 模组卡片：`loadIcon`、`formatModName`、`previewMod`、`openTranslate`、`toggleMod`、从文件安装、去下载模组 | 约 150 |
| `frontend/src/vue/pages/version-settings-methods-export.js` | 概览动作、脚本导出、导出树、开始导出、模组更新弹窗入口 | 约 140 |

**注意点**：

- 方法通过 `this` 访问 `data` / `computed`，对象展开不会改变 `this` 绑定。
- 被移动方法使用的 import 要一并迁移到对应方法模块；页面文件只保留 `data` / `computed` 使用的 import。
- `refreshJavaOptions`、`syncCustomSelects`、`refreshMemoryUsage` 等被其他方法调用的，仍作为 `this.xxx()` 调用，不需要额外注册。

**验证**：

- `npm run lint`
- `npm run test`
- `npm run build:web`
- 启动便携版，进入“版本设置 → 概览 / 模组 / 导出”三个页签，确认无异常、无控制台错误。

### P2 收藏页拆分（低风险）

**目标文件**：`frontend/src/features/mods/favorites.js`，725 行 → 目标 ≤ 100 行（保留门面导出）。

| 新模块 | 负责函数 | 预计行数 |
| --- | --- | --- |
| `favorites-data.js` | `loadFavoritesData`、`renderFavFolderSelect`、`renderFavPage`、`fetchFavProjects`、`openFavItemDetail`、子收藏夹切换与列表渲染 | 约 260 |
| `favorites-selection.js` | 多选开关、单项选择、全选、批量移除、批量下载、选择栏刷新 | 约 170 |
| `favorites-manage.js` | 收藏夹菜单、新建/重命名/删除、导入/导出、备注编辑、收藏按钮状态与 `showFavSelectDropdown` | 约 290 |

`favorites.js` 改为门面：统一 re-export，保持现有导入路径不变。

**验证**：`npm run verify` + Playwright `e2e/mods.spec.mjs` + 便携版收藏页实测。

### P3 问题反馈页拆分（低风险）

**目标文件**：`frontend/src/features/misc/feedback.js`，701 行 → 目标 ≤ 120 行。

| 新模块 | 负责函数 | 预计行数 |
| --- | --- | --- |
| `feedback-logs.js` | `collectAutoLogs`、日志文件读取、自动日志列表渲染、环境信息采集与渲染 | 约 300 |
| `feedback-attachments.js` | 文件选择、添加/移除附件、附件列表渲染、大小格式化 | 约 160 |
| `feedback-form.js` | 类型/分类选择、表单读取、校验、验证码、提交 | 约 220 |

**验证**：`npm run verify` + 便携版反馈页实测（附件选择、自动日志、表单校验）。

### P4 资源页拆分（低风险）

**目标文件**：`frontend/src/features/mods/resource.js`，700 行 → 目标 ≤ 120 行。

| 新模块 | 负责函数 | 预计行数 |
| --- | --- | --- |
| `resource-import-modal.js` | `showImportNameModal`、`getImportStageText` | 约 220 |
| `resource-list.js` | `loadResourcePage`、`setupResourceEvents`、`loadResourceList`、`preloadResourceVersions` | 约 170 |
| `resource-detail.js` | `openResourceDetail` 及其详情渲染 | 约 140 |
| `resource-install.js` | `quickInstallResource`、`showVersionSelectDialog` | 约 130 |

`resource.js` 保留门面导出；`registerLazyLoader('resource:open-detail', ...)` 继续在门面注册，避免登记表分散。

**验证**：`npm run verify` + Playwright `e2e/mods.spec.mjs` + 便携版资源页/详情实测。

### P5 Rust 皮肤 API 模块化（中风险）

**目标文件**：`src-tauri/src/api/skins.rs`，1266 行 → 目标 ≤ 500 行（`mod.rs`）。

目录改为：

```text
src-tauri/src/api/skins/
  mod.rs      # 路由分发 + 通用皮肤 + 头像导出 + 公共 PNG/Base64 工具
  ms.rs       # 微软账号本地皮肤库 + 上传 Mojang
  capes.rs    # 披风本地库、选择、删除、会话拉取
  common.rs   # write_skin_log、is_png、png_response、base64_decode、fetch_remote_bytes
```

**注意点**：

- `include_bytes!("../../resources/*.png")` 在子目录中要改为 `../../../resources/*.png`。
- 跨文件使用的函数统一提升为 `pub(super)`；只在 `mod.rs` 使用的保持私有。
- `pub async fn handle(...)` 的签名与路由分支保持不变，`api/mod.rs` 的调用路径不变。

**验证**：`cargo check`、`cargo test`、`cargo clippy -D warnings` + 便携版账户页皮肤/披风实测。

### P6 CurseForge 共享工具拆分（中风险）

**目标文件**：`src-tauri/src/modpack/curseforge_shared.rs`，1260 行 → 目标 ≤ 400 行（保留门面）。

| 新模块 | 负责内容 |
| --- | --- |
| `curseforge_fs.rs` | `dedupe_version_id`、路径安全、资源包识别与迁移、manifest、并发与超时计算 |
| `curseforge_repair.rs` | `is_jar_intact`、`is_jar_intact_deep`、损坏扫描、PowerShell/zip/unzip 修复、重新打包 |
| `curseforge_chain.rs` | `cleanup_version_chain`、`find_version_chain`、`resolve_version_json` |
| `curseforge_compat.rs` | `verify_loader_libs`、`verify_import_libs`、`ensure_loader_compat`、版本比较与模组依赖扫描 |

`curseforge_shared.rs` 只保留 `pub use` 门面，保证现有 `crate::modpack::curseforge_shared::*` 导入不变。

**验证**：`cargo test`（含整合包导入与修复相关测试）、`cargo clippy` + 便携版整合包导入实测。

### P7 其余 Rust 大文件（中高风险，需先审计）

按顺序处理，每个文件单独一个阶段：

1. `src-tauri/src/api/mods/deps.rs` 1061 行：按“依赖解析 / 版本匹配 / 下载编排 / 路由处理”拆分。
2. `src-tauri/src/api/launch.rs` 1053 行：按“启动前检查 / 参数构建 / 进程启动 / 路由处理”拆分。
3. `src-tauri/src/api/system.rs` 1014 行：按“系统信息 / Java / 更新 / 窗口能力”拆分。
4. `src-tauri/src/api/game.rs` 1007 行：按“状态查询 / 进程控制 / 日志”拆分。
5. `src-tauri/src/lib.rs` 1099 行：把窗口命令与移动端分支移到独立模块，入口只保留初始化和 `generate_handler!`。

**执行前提**：先输出函数清单与调用关系，再确定边界，禁止凭感觉切分。每个文件完成后单独跑 Rust 测试与 Clippy。

### P8 门禁收紧（最后做）

- 将 `scripts/check-architecture.mjs` 的超大文件阈值从 JS 800 / Rust 1500 下调到 JS 650 / Rust 900。
- 每完成一个阶段，同步更新 `ARCHITECTURE.md` 的“当前指标”和“存量边界”。
- 覆盖率与测试密度继续沿用现有棘轮，不因拆分降低阈值。
- 拆分完成后复核：循环依赖仍为 0、ESLint 仍为 0 warning、首屏仍低于 800 KB。

## 四、每阶段统一验收清单

- [ ] `npm run lint` 通过
- [ ] `npm run test` 通过
- [ ] `npm run arch:cycles` 为 0
- [ ] `npm run build:web` 成功
- [ ] `node scripts/check-architecture.mjs --strict` 通过
- [ ] `cargo test` 通过（涉及 Rust 时）
- [ ] `cargo clippy -- -D warnings` 通过（涉及 Rust 时）
- [ ] 便携版对应页面实测无异常（涉及 UI 时）
- [ ] 更新 `ARCHITECTURE.md` 指标
- [ ] 单独提交并推送

## 五、风险与回滚

| 风险 | 应对 |
| --- | --- |
| 方法迁移后 `this` 绑定错误 | 方法模块只导出普通对象，页面 `methods` 中展开；实测对应页签 |
| 未迁移的 import 造成构建失败 | 每阶段先跑 lint 与 build，再跑运行时实测 |
| Rust 子模块可见性错误 | 先 `cargo check`，再 `cargo test`；只提升实际跨文件使用的符号 |
| 并行开发冲突 | 每阶段开始前 `git status`，只暂存本阶段文件，不混入其它改动 |
| 行为回归 | 每阶段一个 commit；实测失败直接回退该 commit，不继续叠加 |

## 六、明确不做

- 不迁移 `frontend/public/css/**` 历史样式到 Tailwind。
- 不修改 `frontend/public/js/*.bundle.js` 第三方生成产物。
- 不为拆分而引入新的抽象层、事件总线或全局对象。
- 不调整现有 API 路由、存储字段与用户可见行为。

## 七、执行记录

| 阶段 | 状态 | 提交 | 备注 |
| --- | --- | --- | --- |
| P1 版本设置页方法拆分 | 已完成 | 本次提交 | `page-version-settings.js` 735→146 行；新增 core/mods/export 三模块（309/160/144 行），48 个方法名与拆分前一致，lint/test/build/架构检查与便携版五页签实测均通过 |
| P2 收藏页拆分 | 已完成 | 本次提交 | `favorites.js` 724→59 行；新增 data/manage/selection/state 四模块（276/243/197/7 行），公开函数全部经门面 re-export，Playwright 模组页冒烟与便携版收藏页/子页实测通过 |
| P3 问题反馈页拆分 | 已完成 | 本次提交 | `feedback.js` 700→77 行；新增 logs/form/attachments/validate/state 五模块（186/288/88/71/35 行），公开导出保持门面转发，便携版反馈页环境信息、自动日志、校验与附件实测通过 |
| P4 资源页拆分 | 已完成 | 本次提交 | `resource.js` 700→30 行；新增 list/detail/install/import-modal/state 五模块（184/145/120/235/21 行），动作注册与懒加载登记保留门面；Playwright 冒烟与便携版材质包列表、详情、返回、光影置顶实测通过。架构检查的内联样式棘轮因并行改动 `page-settings-other.js` 暂报 30/29，与本阶段无关 |
| P5 皮肤 API 模块化 | 待开始 | — | — |
| P6 CurseForge 共享工具拆分 | 待开始 | — | — |
| P7 其余 Rust 大文件 | 待开始 | — | 需先审计 |
| P8 门禁收紧 | 待开始 | — | 最后执行 |
