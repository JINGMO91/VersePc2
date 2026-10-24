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

## 2. 迁移步骤

1. **登记预览**：把页面加入 `frontend/src/dev-page-entry.js` 的 `PAGES` 白名单
2. **抓基线**：切换亮色 / 暗色各截图一次，记录关键控件的 computed style（背景、边框、圆角、高度）
3. **替换控件**：按下表把通用控件换成封装组件，页面专有交互保留原有 `class` 作为 JS 钩子
4. **补样式**：只写组件封装未覆盖的差异（间距、字号、尺寸微调），优先用 Tailwind 工具类
5. **删旧 CSS**：确认该选择器无跨页复用后删除；**全局类（`.btn` / `.card` / `.text-input`）不要删**，它们仍被未迁移页面使用
6. **回归**：亮色 + 暗色 + 自定义三种主题；空状态、错误提示、禁用态、交互切换
7. **跑校验**：`npm run lint && npm run test && npm run build:web && node scripts/check-architecture.mjs --strict`

## 3. 控件对照表

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
| 顶部通知 | 暂用现有 `showToast()` | sonner 未接入，见第 6 节 |

## 4. 硬性规则

- 业务代码只从 `@/components/verse/*` 引用；禁止直接 `import` `@/components/ui/*`（封装层是换库时的唯一改动点）
- 颜色只用语义 token：`bg-background`、`text-foreground`、`text-muted-foreground`、`border-border`、`bg-primary`、`text-primary-foreground`
- 禁止写死十六进制色值
- 禁止 `!important` 覆盖组件样式；需要新样式时在 `verse` 层加 `variant`
- 禁止覆盖 shadcn 组件内部的 `data-*` 选择器
- 单个 `.vue` 文件 ≤ 200 行，超出即拆子组件；上限受架构护栏约束（单文件 ≤ 800 行）
- 事件绑定一律用 `@click` / `@input` / `@change`，**不要用内联 `onclick=` / `oninput=`**（模板字符串里的内联处理器默认绑不到作用域，试点页原有三处内联 `oninput=` 和一处 `onchange=` 就因此失效）
- 组件暴露的方法必须写进 `setup()` 的返回对象，模板才能访问

## 5. 常见坑（试点页实际踩到的）

| 现象 | 原因 | 解法 |
| --- | --- | --- |
| 输入框在暗色主题下黑字不可读 | 跳过 preflight 后 input 不继承文字颜色 | 已在 `tailwind.css` 补最小的 `color/font: inherit`，不要再删 |
| 输入内容、字数统计、按钮启用态全不响应 | 内联 `oninput=` 绑定不到组件作用域 | 改成 `@input`，并把函数加入 `setup()` 返回对象 |
| Tailwind 生成了 `.table` / `.hidden` / `.flex` 等意外规则 | 自动扫描把旧文案数据误判为类名 | 用 `@import "tailwindcss/utilities.css" source(none)` + `@source` 限定目录，新目录要显式加 `@source` |
| 工具类压不住旧的 `button {...}` 规则 | 层内样式输给无层样式 | utilities 已不放进 layer，保持现状即可 |
| shadcn CLI 生成 `import { cn } from "cn"` | CLI 在该环境下的已知问题 | 统一改为 `@/lib/utils`，不要安装 `cn` 包 |
| 状态高亮要重写一套 CSS | 业务代码用 `classList` 切换 `.active` | 已提供 `is-active:` 变体，直接写 `is-active:border-primary` |

## 6. 已知未完成项

- `vue-sonner` 的 `Toaster` 未接入，通知继续用现有 `#toast-container` 与 `showToast()`
- shadcn 的 `--color-destructive` 只映射了 `var(--red)`，没有配套的 `-foreground`，用到危险色文字时注意对比度
- 全站 31 个 CSS 尚未收敛，`.btn` / `.card` / `.text-input` 等全局类要等所有页面迁移完（P4）才能删
