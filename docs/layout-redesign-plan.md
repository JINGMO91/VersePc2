# VersePC2 布局重做计划（Modrinth App 风格）

> 状态：执行中（P1、P2 已完成）
> 基准：Modrinth App（Theseus）— `modrinth/code` → `apps/app-frontend`，Tauri 2 + Vue 3 + Tailwind
> 约束：**主页 `page-home` 不改**，保留现有可拖动控件与位置记忆体系

## 1. 目标与非目标

### 目标

- 统一页面骨架：吸顶页头工具条 + 实色卡片面板 + 一致的间距/圆角/阴影体系
- 统一控件视觉：原生 `input`/`select`、自研 `custom-select`、旧 `.btn` 在同一屏内高度、圆角、边框、聚焦态一致（**不替换元素类型**，交互零改动）
- 让列表页、详情页、版本设置页与新基础层（页头、卡片）视觉一致
- 宽屏/全屏下版面稳定：内容 1440px 居中，列表与表单不再无限拉伸

### 非目标

- 不改主页（`frontend/src/vue/pages/page-home.js`）
- 不改侧栏液态玻璃样式与导航交互
- 不迁移 `.modal` / `.custom-select` 的**交互实现**（属于独立的结构迁移项目，本计划只做展示层对齐）
- 不改数据流与业务逻辑

## 2. 已完成（基础层，commit e20eb3c）

| 项 | 规格 | 文件 |
| --- | --- | --- |
| 页头 | 52px 吸顶工具条，半透明 + blur + 底部 1px `--border`，标题 20px/600 | `frontend/public/css/layout.css` |
| 卡片 | `--bg-card` 实色、`calc(--radius-lg + 2px)`、padding 20、1px 边框、轻阴影 | 同上 |
| 区块标题 | `.card h3` 14px/600、正文色、下边距 14 | 同上 |
| 内容宽度 | `max-width: 1440px` 居中，padding 64/32/32 | 同上 |
| 页签 | 分段控件，选中态浅色卡片 + 轻阴影 | `frontend/public/css/versions.css` |
| 间距 | 卡片间距统一 20px | `settings.css` / `cloud.css` |

## 3. 现状盘点（脚本实测，2026-10-24）

> `btn` = 旧类按钮数量，`VBtn` = `VButton` 数量，`input` = 原生输入框，`sel` = 原生下拉，`csel` = 自研下拉引用

| 页面 | btn | VBtn | input | VInput | sel | csel | 页头 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| page-mods | 3 | 14 | 2 | 2 | 1 | 36 | 有（页签在头部） |
| page-modpacks | 0 | 3 | 0 | 1 | 0 | 22 | 有 |
| page-resourcepacks | 0 | 4 | 0 | 1 | 0 | 15 | 有 |
| page-datapacks | 0 | 3 | 0 | 1 | 0 | 7 | 有 |
| page-versions | 0 | 11 | 0 | 2 | 0 | 13 | **无** |
| page-accounts | 19 | 7 | 2 | 4 | 1 | 0 | **无** |
| page-settings-launch | 0 | 8 | 13 | 5 | 6 | 0 | 有 |
| page-settings-other | 10 | 22 | 12 | 3 | 4 | 0 | 有 |
| page-settings-personalize | 0 | 8 | 14 | 0 | 1 | 1 | 有 |
| page-mod-detail | 5 | 3 | 0 | 0 | 0 | 0 | **自有头部** |
| page-version-detail | 1 | 3 | 4 | 0 | 0 | 0 | 有 |
| page-version-settings | 0 | 0 | 0 | 0 | 0 | 1 | **无** |
| page-downloads | 0 | 1 | 1 | 0 | 0 | 0 | **无** |

结论：问题不在某几个页面，而是**三代控件混用**——旧 `.btn`（38 处）、原生表单控件（48 输入 + 12 下拉）、自研 `custom-select`（约 100 处引用）与 shadcn 组件同屏出现，这是「拼凑感」的主要来源。

## 4. 设计规格（验收依据）

- **页头**：高 52px（±1）、sticky、标题 20/600、操作按钮右对齐、底部 1px 分隔线
- **内容**：1440px 居中；页面内卡片间距 20px；页头与首卡片间距 20px
- **卡片**：实色 `--bg-card`、圆角 `calc(--radius-lg + 2px)`、padding 20、1px `--border`、`0 1px 2px rgba(0,0,0,.04)`
- **列表行**：图标 48×48（圆角 10）、标题 14/600、描述 12 `--text-secondary`（最多 1 行省略）、meta 11 `--text-muted`、行内边距 12/16、hover `--bg-hover`
- **空状态**：40px 图标（`--text-muted` 40% 透明）+ 14px 标题 + 12px 提示，上下留白 48px，垂直居中
- **页签**：分段控件容器 `--bg-tertiary` + 2px padding，选中项浅色卡片
- **详情页头**：32px 圆形 ghost 返回键 + 标题 20/600 + 12px muted 副标题，与列表页页头同高
- **表单**：输入/下拉统一高度 32–36px、圆角 `--radius`、聚焦环用 `--accent`

## 5. 阶段计划

### P1 页头收口（已执行）

- 已核对：`page-versions`、`page-downloads` 实际已有 `.page-header`（盘点脚本因类名带附加 class 而漏计），无需新增
- `page-installed-versions`、`page-version-detail`：去掉页头内联 `gap/padding` 覆盖，改用 `.page-header.detail-header`（左对齐紧凑排列，适配带返回键的页头）
- `page-accounts`：`.accts-header-row` 对齐规格（52px、底部细线、标题 20/600）
- `page-version-settings`：`.vset-title` 18/700 → 20/600
- `page-mod-detail`：`.moddetail-page-header` 对齐规格（min-height 52、左右内边距归零、底部细线、标题 20/600）
- 验收：页头高度 52px、标题 20/600、无横向溢出；构建与 Playwright 冒烟通过

### P2 列表页统一（已执行）

覆盖：模组、整合包、数据包、材质包、光影、已安装版本

- `.mod-item`：玻璃拟态 → 实色 `--bg-card` + 1px 边框，行内边距 12/16、圆角 12px，悬停改为 `--bg-hover`（不再整行描强调色）
- `.mod-icon`：圆角 6 → 10px；图标 48px 不变
- `.mod-name` 字重 500 → 600；`.mod-desc` 颜色 `--text-muted` → `--text-secondary`
- `.version-item`：同步改为实色面板 + 12px 圆角；`.version-list` 列表间距 4 → 8px
- 筛选行与分页器已符合规格，未改动
- 验收：行高 82px、圆角 12、图标圆角 10、标题 600、无横向溢出；构建与冒烟通过

### P3 详情页

- 模组详情：头部（64 图标 + 标题 + 来源标签 + 主操作）→ 页签吸顶 → 正文/侧栏两栏
- 版本详情、版本设置：卡片、列表行、按钮与新体系对齐
- 验收：详情页与列表页头部同规格；侧栏在滚动时保持可见

### P4 表单控件视觉收敛

- 不替换业务控件实现，统一**视觉**：原生 `input`/`select` 与 shadcn 输入框统一高度（32–36px）、圆角 `--radius`、1px 边框、聚焦环 `--accent`
- 设置页里遗留的 `.btn` 与 `VButton` 统一高度/圆角/内边距（旧按钮样式通过覆盖类收敛，不改元素类型）
- 命令式 `classList` 切换的元素（`#mod-multiselect-toggle`、`#md-fav-btn` 等）保持原样
- 验收：同屏控件高度与圆角一致；`npm run verify` 通过；交互回归

### P5 细节巡检

- 空状态、加载态、提示条（`.hint`）统一字号与颜色
- 弹窗内部排版对齐卡片规格（只改样式，不改交互）
- 亮/暗双主题逐页截图对比
- 验收：全站截图无对齐/间距异常

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 命令式切换样式的元素换成组件后失去反馈 | 沿用既有清单，保留原生元素与旧类 |
| 自研下拉由 `customSelectInstances` 驱动，直接换 `VSelect` 会断交互 | 本计划只做 CSS 对齐，组件替换放到结构迁移项目 |
| 原生输入框有内联事件，换组件后失效 | 本计划不换元素类型，只统一视觉 |
| 宽屏两列布局改动影响内容较高的页面 | 仅在 ≥1400px 生效，窄窗口保持单列 |

## 7. 每阶段验证

1. `npm run verify`（lint + 单测 + 构建 + 架构护栏）
2. `npx playwright test`（构建产物冒烟）
3. 浏览器逐页截图：1600×900 与 2560×1440，亮/暗各一轮
4. 横向溢出检查：每页 `scrollWidth ≤ clientWidth`

## 8. 参照

- [Modrinth Monorepo（apps/app-frontend）](https://github.com/modrinth/code/tree/main/apps/app-frontend)
- [Theseus 开发文档](https://docs.modrinth.com/contributing/theseus/)
- [Spacedrive（顶栏/内容区结构参考）](https://github.com/spacedriveapp/spacedrive)
