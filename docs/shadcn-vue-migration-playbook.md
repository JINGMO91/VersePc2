# shadcn-vue 页面迁移 playbook

- 适用阶段：P3 批量迁移
- 试点页：`frontend/src/vue/pages/page-feedback.js`（问题反馈）
- 配套文档：[shadcn-vue-migration-plan.md](./shadcn-vue-migration-plan.md)

## 1. 迁移前必读

### 1.1 环境事实

| 事实 | 说明 |
| --- | --- |
| Tailwind 只启用了 theme + utilities | 没有 preflight。`input/textarea/select` 的颜色与字体靠 `tailwind.css` 里的最小补充重置继承，新建表单控件时不要假设有浏览器默认样式 |
| 现有 CSS 全部是无层样式 | Tailwind 的 utilities 也刻意不放进 cascade layer，否则层内样式会输给无层样式 |
| 主题只有一套 | 语义 token 全部映射到 `--bg-*` / `--accent` / `--border`，禁止新增第二套变量 |
| 暗色靠 `data-theme` | Tailwind 的 `dark:` 变体已重绑定到 `[data-theme="dark"]`，不要用 `.dark` 类 |
| 页面用 template 字符串 | 复用运行时编译器；新建 `components/` 下的文件用 `.vue`，页面文件继续用 `.js` + 字符串模板 |

### 1.2 验证方式

主应用在纯浏览器下无法启动（`tauri-bridge` 返回空对象，`updater-ui.js` 模块顶层调用 `api.updater.onStatusChanged` 会中断整个模块图，属既有问题）。因此页面级视觉回归走独立预览页：

```powershell
npm run dev:web
# 组件基座：http://localhost:1420/dev-components.html
# 单页预览：http://localhost:1420/dev-page.html?p=feedback
#           可选值见 frontend/src/dev-page-entry.js 的 PAGES 白名单，新增页面时同步登记
```

预览页底部有亮色 / 暗色 / 自定义三个主题按钮，右下角可切换页面。

## 2. 组件层结构

```
frontend/src/
  styles/tailwind.css          # 样式入口：theme + utilities 两层、暗色变体、语义 token 映射
  lib/utils.js                 # cn()：clsx + tailwind-merge
  components/
    ui/                        # shadcn-vue 生成的原语，不直接引用，升级时整体替换
    verse/                     # 语义封装层：VButton / VInput / VTextarea
  vue/pages/page-*.js          # 页面组件（模板字符串写法）
  vue/mount.js                 # 页面挂载清单
  dev-page-entry.js            # 单页预览白名单（dev only）
frontend/dev-page.html         # 单页预览入口（dev only，不参与构建）
frontend/dev-components.html   # 组件基座预览（dev only）
docs/templates/page-template.js  # 新增页面模板，复制后按注释步骤接入
```

业务代码只依赖 `components/verse`；`components/ui` 是 shadcn 的产物，换库或升级时只改 `verse` 这一层。

## 3. 迁移步骤

1. **登记预览**：把页面加入 `frontend/src/dev-page-entry.js` 的 `PAGES` 白名单
2. **抓基线**：切换亮色 / 暗色各截图一次，记录关键控件的 computed style（背景、边框、圆角、高度）
3. **替换控件**：按下表把通用控件换成封装组件，页面专有交互保留原有 `class` 作为 JS 钩子
4. **补样式**：只写组件封装未覆盖的差异（间距、字号、尺寸微调），优先用 Tailwind 工具类
5. **删旧 CSS**：确认该选择器无跨页复用后删除；**全局类（`.btn` / `.card` / `.text-input`）不要删**，它们仍被未迁移页面使用
6. **回归**：亮色 + 暗色 + 自定义三种主题；空状态、错误提示、禁用态、交互切换
7. **跑校验**：`npm run lint && npm run test && npm run build:web && node scripts/check-architecture.mjs --strict`

## 4. 控件对照表

| 旧写法 | 新写法 | 注意 |
| --- | --- | --- |
| `<button class="btn btn-accent">` | `<VButton variant="accent">` | 对应 `.btn-primary` / `.btn-accent` |
| `<button class="btn btn-secondary">` | `<VButton variant="secondary">` | 对应 `.btn-secondary` |
| `<button class="btn btn-secondary btn-sm">` | `<VButton variant="secondary" size="sm">` | |
| 危险操作按钮 | `<VButton variant="danger">` | |
| `<input class="text-input">` | `<VInput>` | 需要 `id` 供 JS 读取时保留 `id` |
| `<textarea class="text-input">` | `<VTextarea>` | 文本域默认 `min-h-16`，需要高一点就加 `min-h-[140px]` |
| `<input type="checkbox">` | `<Checkbox>` | |
| `<select>` | `<Select>` 系列 | |
| 自研模态框 | `<Dialog>` 系列 | 走 Teleport，不受页面容器影响 |
| 自研下拉 | `<DropdownMenu>` 系列 | |
| 顶部通知 | 暂用现有 `showToast()` | sonner 未接入，见第 8 节 |

## 5. 硬性规则

- 业务代码只从 `@/components/verse/*` 引用；禁止直接 `import` `@/components/ui/*`（封装层是换库时的唯一改动点）
- 颜色只用语义 token：`bg-background`、`text-foreground`、`text-muted-foreground`、`border-border`、`bg-primary`、`text-primary-foreground`
- 禁止写死十六进制色值
- 禁止 `!important` 覆盖组件样式；需要新样式时在 `verse` 层加 `variant`
- 禁止覆盖 shadcn 组件内部的 `data-*` 选择器
- 单个 `.vue` 文件 ≤ 200 行，超出即拆子组件；上限受架构护栏约束（单文件 ≤ 800 行）
- 事件绑定一律用 `@click` / `@input` / `@change`，**不要用内联 `onclick=` / `oninput=`**（模板字符串里的内联处理器是普通 HTML 属性，靠 window 全局名解析，试点页原有三处内联 `oninput=` 和一处 `onchange=` 就因此失效）
- 组件暴露的方法必须写进 `setup()` 的返回对象，模板才能访问
- 迁移任一控件前，先按第 7 节的清单确认它没有被 features 层命令式操作样式

## 6. 常见坑（试点页与批量迁移实际踩到的）

| 现象 | 原因 | 解法 |
| --- | --- | --- |
| 输入框在暗色主题下黑字不可读 | 跳过 preflight 后 input 不继承文字颜色 | 已在 `tailwind.css` 补最小的 `color/font: inherit`，不要再删 |
| 输入内容、字数统计、按钮启用态全不响应 | 模板字符串里的 `oninput=` / `onchange=` 被 Vue 当作普通 HTML 属性，靠 window 全局名解析，而这些函数并没挂到 window | 改成 `@input` / `@change` / `@keydown`，并把函数加入 `setup()` 返回对象 |
| **按钮点了没反应、或点了之后外观不再变化** | 元素的激活态由 features 层用 `classList` 切换 `.btn-primary` / `.btn-secondary`，或直接重写 `innerHTML` | **不要**把这类元素换成 `VButton`；保留原生 `<button>` 与旧类。迁移前先 grep `classList.add/remove/toggle('btn` |
| Tailwind 生成了 `.table` / `.hidden` / `.flex` 等意外规则 | 自动扫描把旧文案数据误判为类名 | 用 `@import "tailwindcss/utilities.css" source(none)` + `@source` 限定目录，新目录要显式加 `@source` |
| 工具类压不住旧的 `button {...}` 规则 | 层内样式输给无层样式 | utilities 已不放进 layer，保持现状即可 |
| shadcn CLI 生成 `import { cn } from "cn"` | CLI 在该环境下的已知问题 | 统一改为 `@/lib/utils`，不要安装 `cn` 包 |
| 状态高亮要重写一套 CSS | 业务代码用 `classList` 切换 `.active` | 已提供 `is-active:` 变体，直接写 `is-active:border-primary` |
| 受控输入框把业务代码读到的值清空 | `VInput` 的 `modelValue` 默认 `undefined`，非受控；一旦传值就会被 Vue 回写 | 业务按 `id` 直接读 DOM 的输入框不要传 `modelValue`；需要默认值时用 `default-value` |
| `.vset-input` 等旧类删除后布局塌陷 | 旧类里带了 `flex:1` / `max-width` 这类布局约束 | 替换时把布局约束用工具类补回（如 `max-w-[300px]`、`flex-1`） |
| 反引号模板里出现 `\"` | 用脚本批量替换时按转义字符串模板生成的 | 反引号模板不需要转义引号，替换后清理 |

## 7. 迁移前的必做检查（清单）

1. `grep -n "classList.add\\|classList.remove\\|classList.toggle" features/ core/` —— 确认目标元素没有命令式 class 切换
2. `grep -n "<id>" features/ core/` —— 确认 `id` 只被读取（`disabled` / `textContent` / `value` 都安全），没有被改 class 或整体重写 `innerHTML`
3. `grep -n "oninput=\\|onchange=\\|onclick=\\|onkeydown=" <page>.js` —— 逐个确认目标函数是否在 `plugin-compat.js` 里挂到了 window；没挂的就是「改成 `@input` 并加进 `setup()` 返回对象」
4. 替换后跑 `node .scratch/check-markup.mjs`（若仍保留该脚本）确认标签开闭配对

## 8. 已知未完成项

- **`vue-sonner` 已从基座移除**：实测容器能渲染、toast 也能进 DOM，但不传/传 `duration` 都在约 1 秒内自行 dismiss（500ms 采样时 opacity 已为 0）。已排除预打包双实例（`optimizeDeps.exclude` 无效）、跨 app 挂载、`position` 缺省三种可能，且 2.0.9 已是最新版本。通知统一用现有 `#toast-container` + `showToast()`。`tailwind.css` 保留 `--popover` / `--popover-foreground` 别名供 Dialog / Popover 使用。
- shadcn 的 `--color-destructive` 只映射了 `var(--red)`，没有配套的 `-foreground`，用到危险色文字时注意对比度
- **自研 `.modal` 与 `.custom-select` 未迁移到 `Dialog` / `Select`**：显示状态与选项由 features 层命令式驱动（`style.display`、`customSelectInstances`）。换成组件会改变焦点管理与动画行为，与计划自身「交互行为不变」的约束冲突；且当前环境跑不了真实 Tauri 应用，这类改造无法验证。建议单独立项、在能跑真机的环境里做。
- 全站 31 个 CSS 尚未收敛，`.btn` / `.card` / `.text-input` 等全局类仍被未迁移结构（JS 动态生成的标记、自研模态框）使用，需要等这些结构迁移完才能删
- 页面模板里还有 29 处超长内联 `style`（已由架构检查的棘轮守住，只减不增）

## 9. 本期已确认可用的行为（回归证据）

- 迁移后的 `VButton` 点击事件正常触发（在预览页用日志确认过），`as-child` 包裹 `DialogTrigger` / `DropdownMenuTrigger` / `TooltipTrigger` 也正常
- `VInput` 在非受控模式下可被业务代码按 `id` 直接读 `value`（反馈页校验、字数统计、提交按钮启用逻辑均实测通过）
- `default-value` 可用于给不受 Vue 状态驱动的输入框提供初始值（开服页 MyServer / 25565 / 2048 实测保留）
