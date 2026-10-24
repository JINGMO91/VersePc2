# VersePC2 引入 shadcn-vue 迁移规划

- 制定日期：2026-10-24
- 目标：把现有手写 CSS 的界面逐步迁移到 shadcn-vue（Reka UI + Tailwind CSS v4）组件体系
- 推进方式：分阶段、每阶段可构建可发布，不做大爆炸式全量替换
- 约束：迁移期间功能与交互行为不变；P0 阶段必须做到零视觉差异

## 1. 目标与非目标

### 1.1 目标

- 建立统一的组件基座，消灭各页面重复手写的按钮、输入框、下拉框、开关、弹窗、标签页样式
- 让视觉语言现代化（圆角、层级阴影、焦点环、过渡动效），并与现有主题变量保持一致
- 每个阶段结束都能通过 `npm run verify`，可正常打包发布

### 1.2 非目标

- 不重写 `frontend/index.html` 骨架（侧边栏、启动栏、壁纸层、灵动岛、窗口控制条保持原样）
- 不引入 Nuxt / SSR / Pinia，不换状态管理方案
- 不动 `src-tauri`（Rust 侧）任何代码
- 不一次性删除 `frontend/public/css/**`，只随页面迁移逐步收缩

## 2. 现状约束（已核实）

| 项目 | 现状 | 影响 |
| --- | --- | --- |
| 页面挂载 | 25 个页面各自 `createApp(comp).mount(sel)`，见 `frontend/src/vue/mount.js` | 组件库的 provide/inject（Dialog、Toast）按 app 隔离，全局只挂一次的东西需要额外处理 |
| 组件写法 | 全部是 `.js` 里的 template 字符串，无 `.vue` SFC | shadcn-vue CLI 产出 SFC，必须先接 `@vitejs/plugin-vue` |
| 构建配置 | `vite.config.mjs` 无任何 Vue 插件；`vue` 别名指向 `vue/dist/vue.esm-bundler.js` | 该别名提供运行时编译器，字符串模板依赖它，不能删 |
| 样式 | 31 个手写 CSS，位于 `frontend/public/css/**`（Vite 原样复制，不参与处理） | Tailwind 入口必须放在 `frontend/src/` 并由 `main.js` 引入 |
| 主题 | `data-theme="light\|dark\|custom"` + CSS 变量（`--bg-primary`、`--accent`、`--border`、`--radius` 等），见 `frontend/public/css/base.css` | 必须做 token 映射，禁止出现第二套主题系统 |
| 特色效果 | 液态玻璃、壁纸（图片/视频/网页/场景/全景）、自定义主题 | 半透明与模糊效果可能被组件背景色覆盖，需专项验证 |
| 架构护栏 | `scripts/check-architecture.mjs`：单文件 >800 行告警、禁止 `window.*` 赋值、index.html 只允许 1 个业务脚本 | 新增组件不得触发护栏违规 |
| 打包形态 | Tauri 桌面端，本地加载，无 SSR，首屏有 splash 时序 | 无 SSR 顾虑；但需关注首屏 JS 体积与挂载顺序 |

## 3. 技术选型与版本

已核对与当前 Vite 8 的兼容性：

| 包 | 版本 | 作用 |
| --- | --- | --- |
| `@vitejs/plugin-vue` | 6.0.10 | 支持 Vite 5/6/7/8，提供 SFC 编译 |
| `tailwindcss` | 4.3.3 | 工具类引擎，配置写在 CSS 内（`@theme`），无需 `tailwind.config.js` |
| `@tailwindcss/vite` | 4.3.3 | Vite 插件，支持 Vite 5.2+/8 |
| `shadcn-vue`（CLI） | 2.8.2 | 生成组件源码到项目内，不是运行时依赖 |
| `reka-ui` | 最新 | shadcn-vue 的无障碍行为底层（原 Radix Vue） |
| `lucide-vue-next` | 最新 | 图标库 |
| `class-variance-authority` / `clsx` / `tailwind-merge` | 最新 | 变体与 class 合并，shadcn 组件标准依赖 |

选型理由：shadcn-vue 的组件是**拷贝进仓库的源码**，样式完全可改，适合启动器这种强定制视觉；Reka UI 只提供键盘与无障碍行为，不会强行套一层设计语言。

## 4. 核心风险与对策

### 4.1 Tailwind Preflight 会破坏现有样式（最高风险）

Preflight 会重置 button、input、border、行高、字体等，现有 31 个 CSS 全部按手写排版设计，一旦引入会导致全站错位。

对策：Tailwind 入口**只引 theme 与 utilities 两层，不引 preflight**。

```css
@import "tailwindcss/theme" layer(theme);
@import "tailwindcss/utilities" layer(utilities);
```

注意：跳过 preflight 后，shadcn 组件里隐含依赖的基础重置（如默认 `border-color`）要由现有 `base.css` 承担，P0 验收必须逐页目测。

### 4.2 双主题系统冲突

shadcn 组件读取 `--background` / `--foreground` / `--primary` / `--border` / `--ring` 等语义 token。若另起一套，暗色、自定义主题、液态玻璃会互相打架。

对策：用 `@theme inline` 把语义 token 直接映射到现有变量，保持单一数据源。

```css
@theme inline {
  --color-background: var(--bg-primary);
  --color-foreground: var(--text-primary);
  --color-card: var(--bg-card);
  --color-muted: var(--bg-secondary);
  --color-muted-foreground: var(--text-muted);
  --color-primary: var(--accent);
  --color-primary-foreground: var(--accent-text);
  --color-border: var(--border);
  --color-ring: var(--accent);
  --radius: var(--radius);
}
```

`[data-theme="dark"]` / `[data-theme="custom"]` 已在 `base.css` 覆盖原始变量，映射层无需重复声明。

### 4.3 25 个独立 Vue 应用

Dialog、DropdownMenu 依赖 Teleport，不受影响；Toast（sonner）这类需要全局挂载一次的组件，若每个 app 各挂一个会出现重复容器。

对策：Toast 统一走现有 `#toast-container`，或在 `mount.js` 里只初始化一次全局容器，禁止在页面组件内挂 Toaster。

### 4.4 SFC 与字符串模板共存

接入 `@vitejs/plugin-vue` 后，两类组件并存：`.vue`（新）与 `.js` 字符串模板（旧）。

对策：保留 `vue: 'vue/dist/vue.esm-bundler.js'` 别名不动；新组件一律 `.vue`，旧页面迁移时再逐步替换。禁止在一个页面里混用两种写法。

### 4.5 视觉特效回归

液态玻璃（`liquid-glass.js`）、壁纸层、自定义主题会给容器加透明度与滤镜，shadcn 组件默认 `bg-background` 可能把效果挡住。

对策：新增 `components/verse/` 语义层，统一把背景类改为透明或 `bg-transparent`，玻璃效果由外层容器控制。

## 5. 阶段总览

| 阶段 | 内容 | 产出 | 验收 |
| --- | --- | --- | --- |
| P0 | 基建：插件、Tailwind、token 桥接 | 可编译的空壳样式层 | 截图零差异 + `npm run verify` |
| P1 | 组件基座：生成首批组件 + 语义封装 + 预览页 | `components/ui` 与 `components/verse` | 预览页可视 + 构建通过 |
| P2 | 试点页迁移 1 个 | 迁移 playbook | 页面回归 + 删减对应旧 CSS |
| P3 | 分批迁移（4 批） | 全站组件化 | 每批一个 PR，构建绿 |
| P4 | 收尾：删死 CSS、护栏升级、文档 | 干净的样式目录 | 全量回归 + 文档更新 |

## 6. 阶段细则

### P0 基建（不改任何视觉）

任务：

1. 切分支 `feat/shadcn-vue`，从 `main` 拉出
2. 安装依赖（见第 3 节版本表）
3. `vite.config.mjs` 增加 `plugins: [vue(), tailwindcss()]`，保留现有 `vue` 别名与 `root`/`base` 配置
4. 新增 `frontend/src/styles/tailwind.css`：theme + utilities 两层 + `@theme inline` 映射 + `@source` 指向 `frontend/src`
5. `frontend/src/main.js` 最前面引入该样式文件
6. 建立 token 对照表（写进本文档第 7 节，作为团队规范）

验收：

- `npm run lint`、`npm run test`、`npm run build:web`、`node scripts/check-architecture.mjs --strict` 全部通过
- 首页、版本管理、模组、设置、账户、云盘六页截图与迁移前逐像素对比无明显差异（亮色 + 暗色各一轮）
- 液态玻璃开启、壁纸开启、自定义主题三种状态下各目测一次

### P1 组件基座（只新增，不改老页面）

任务：

1. 配置 `components.json`（`shadcn-vue init`），`aliases` 指向 `@/components`、`@/lib/utils`
2. 在 `vite.config.mjs` 与 `jsconfig.json` 增加 `@` → `frontend/src` 别名
3. 生成首批组件：`button`、`input`、`label`、`switch`、`checkbox`、`select`、`dialog`、`dropdown-menu`、`tabs`、`tooltip`、`badge`、`card`、`skeleton`、`sonner`
4. 建 `frontend/src/components/verse/` 语义封装层，把 shadcn 原子件包成业务组件（如 `VButton` 对齐现有 `.btn`、`.btn-accent`、`.btn-secondary` 三档）
5. 建仅 dev 可见的组件预览页（`page-components.js` + 路由按钮），用于并排对照旧控件
6. `mount.js` 单独初始化一次 Toast 容器

验收：

- 预览页所有组件在亮色/暗色/自定义主题下可正常渲染
- 新增文件不触发架构护栏（单文件 ≤800 行、无 `window.*`）
- `npm run verify` 通过

### P2 试点页迁移（1 个低风险页面）

任务：

1. 选择「问题反馈」或「设置-其他」作为试点（纯表单、不涉及启动与安装流程）
2. 页面内所有按钮、输入框、开关、下拉、弹窗替换为 `components/verse/` 组件
3. 删除该页在旧 CSS 中对应的选择器（先注释比对，确认无跨页复用后删除）
4. 回归：交互、空状态、错误提示、暗色、自定义主题

产出：`docs/shadcn-vue-migration-playbook.md`（编码规范与禁止事项），后续所有迁移按此执行

### P3 批量迁移（每批一个 PR）

按风险从低到高：

1. 设置类：`page-settings-launch` → `page-settings-personalize` → `page-settings-other` → `page-java`
2. 资源列表类：`page-mods` → `page-modpacks` → `page-datapacks` → `page-resourcepacks` → `page-shaders`
3. 账户与工具：`page-accounts` → `page-cloud` → `page-toolbox` → `page-downloads`
4. 首页与版本：`page-home` → `page-versions` → `page-version-detail` → `page-version-settings`（动效最多，最后做）

每批完成标准：该批页面无旧 `.btn` / `.modal` / `.custom-select` 残留，对应 CSS 段落删除，`npm run verify` 通过。

### P4 收尾

任务：

1. 按选择器引用扫描删除死 CSS（重点：`components/base-ui.css`、`dialogs.css`、`version-ui.css`）
2. `check-architecture.mjs` 增加规则：新页面禁止新增独立 CSS 文件、禁止在业务代码里出现内联 `style` 大段块
3. 更新架构交接文档，补充组件层说明与新增页面模板

## 7. 迁移 playbook（P2 产出，此处先列草案）

- 组件只从 `@/components/verse/*` 引用，业务代码禁止直接 `import` `@/components/ui/*`
- 颜色只用语义 token（`bg-background`、`text-muted-foreground`、`border-border`），禁止写死十六进制
- 禁止用 `!important` 覆盖组件样式；需要变体时在 `verse` 层加 `variant`
- 禁止覆盖 shadcn 组件内部生成的选择器（`data-*` 属性除外）
- 单个 `.vue` 文件 ≤ 200 行，超出即拆子组件
- 组件内不写中文硬编码文案以外的业务逻辑，数据仍走 `features/` 层

## 8. 回滚方案

- P0/P1 只在新增文件与配置层改动，回滚即删除 `tailwind.css`、`components/`、`components.json` 并还原 `vite.config.mjs`
- P2 之后按批次回滚：每批迁移单独 PR，保留旧 CSS 直到该批验收通过再删
- 依赖层面：`package.json` 新增依赖均为 dev 用途或纯前端包，移除不影响 Rust 构建

## 9. 进度记录

| 阶段 | 状态 | 完成日期 | 备注 |
| --- | --- | --- | --- |
| P0 基建 | 已完成 | 2026-10-24 | 只引 theme + utilities，跳过 preflight；token 经 `@theme inline` 映射到现有变量 |
| P1 组件基座 | 已完成 | 2026-10-24 | 已生成 16 个组件；预览页 `frontend/dev-components.html` |
| P2 试点页 | 已完成 | 2026-10-24 | 试点页「问题反馈」，产出迁移 playbook |
| P3 批量迁移 | 已完成 | 2026-10-24 | 4 批共 19 个页面；100+ 通用控件迁移完成 |
| P4 收尾 | 已完成 | 2026-10-24 | 护栏两项 + 死 CSS 核减 + 组件层文档与页面模板 |

### 执行记录

- P0：`vue` 别名保留，新增 `@` → `frontend/src`。Tailwind 用 `source(none)` 关闭自动扫描，只扫 `src/vue` 与 `src/components`，避免旧文案被误判成工具类名。
- P1：`components.json` 的风格名必须写 `reka-vega`（`vega` 在 registry 里不存在）。CLI 会误生成 `import { cn } from "cn"` 并安装同名 npm 包，已统一改为 `@/lib/utils` 并移除该包。
- P1：预览入口有两个。`frontend/dev-components.html` 看组件基座，`frontend/dev-page.html?p=<页面名>` 看单个真实页面；两者都是 dev-only，不参与构建。之所以需要独立入口：纯浏览器下 `tauri-bridge` 返回空对象，`updater-ui.js` 模块顶层调用 `api.updater.onStatusChanged` 会中断整个模块图，`npm run dev:web` 无法加载主应用（既有问题，与本次迁移无关）。预览页会给 `window.__TAURI__` 注入最小桩，让依赖 bridge 的页面也能渲染。
- P2：反馈类型与问题分类磁贴改为 Tailwind 工具类，新增 `is-active:` 变体对接现有 `classList` 切换逻辑，旧 CSS 中两组磁贴规则已删除。试点页原有 3 处内联 `oninput=` 与 1 处 `onchange=` 因绑不到组件作用域而失效（既有 bug），改为 `@input` / `@change` 后修复。
- P2：跳过 preflight 导致 `input/textarea/select` 不继承文字颜色，暗色主题下黑字不可读，已在 `tailwind.css` 补最小重置。
- P3：19 个页面分批迁移，100+ 个通用控件换成 `components/verse` 封装。识别出**命令式样式切换**这一类隐患：`#mod-multiselect-toggle` 与 `#md-fav-btn` 的激活态由 features 层用 `classList` 切换 `.btn-primary/.btn-secondary` 并重写 `innerHTML`，换成组件后切换将失去视觉反馈，故保留原生按钮与旧类。另写脚本扫描全部 88 个转换后带 id 的元素，确认无其他同类依赖。
- P3：又修复多处失效的内联事件绑定（settings-other 的 `onkeydown`、mods 的 `oninput`、cloud 的 `@input`、accounts 的 `@change` 等）。**仍有存量失效项**：`#sponsor-search-input` 的 `oninput="filterSponsors(...)"`、`page-mods` / `page-mod-favorites` 上 4 处 checkbox/select 的内联处理器，这些是非替换元素上的绑定，留给后续单独处理。
- P4：`check-architecture.mjs` 增加两项护栏。一是**存量样式快照**：`frontend/public` 下未登记的 CSS 文件直接报错，阻止继续新增手写 CSS。二是**内联样式棘轮**：页面模板中 ≥120 字符的 `style="..."` 只允许减少（基线 29 处），增加即报错。
- P4：死 CSS 按引用逐个核实后核减 132 行，涉及 `components/base-ui.css` 与 `modal.css`。整站 31 个 CSS 的全局类（`.btn` / `.card` / `.text-input`）仍被 JS 动态生成的标记与自研模态框使用，需等这些结构迁移完才能删；`components/theme.css`、`components/version-ui.css`、`dialogs.css` 本轮未发现可安全删除的整块规则，留待结构迁移后一并处理。
- 待办：`vue-sonner` 的 Toaster 未接入，通知继续用现有 `#toast-container`。
- 待办：自研 `.modal` 与 `.custom-select` 未迁移到 `Dialog` / `Select`。它们的显示状态与选项由 features 层命令式驱动（`style.display`、`customSelectInstances`），替换需要同步改写交互代码，风险独立，建议单独立项。

### 验证方式

每个阶段用 `frontend/dev-page.html` 做亮色 / 暗色 / 自定义三态视觉回归，再跑 `npm run verify`。

- P2 实测项：磁贴选中态切换、字数统计、表单校验提示、提交按钮启用逻辑、暗色对比度、文本域高度。
- P3 实测项：19 个页面全部在预览页渲染成功（无「页面渲染失败」横幅、按钮数量非零）；抽样检查按钮 computed style（边框 1px、圆角 6px、高 36px、图标可见）、暗色主题适配、server-host 表单默认值（MyServer / 25565 / 2048）保留。

