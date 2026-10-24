/* 新增页面模板 — 复制本文件为 page-<名称>.js 后按需删改
 *
 * 使用步骤：
 * 1. 复制为 frontend/src/vue/pages/page-<名称>.js
 * 2. 在 frontend/index.html 的 .content-area 里加容器：<div id="page-<名称>" class="page"></div>
 * 3. 在 frontend/src/vue/mount.js 的 OTHER_PAGES 里登记：[名称, '#page-<名称>', () => import('./pages/page-<名称>.js')]
 * 4. 在 frontend/src/vue/mount.js 所在页面切换逻辑里加导航入口（index.html 的 .sidebar-nav 里加 data-page）
 * 5. 在 frontend/src/dev-page-entry.js 的 PAGES 里登记，方便单独预览
 *
 * 硬性约定（详见 docs/shadcn-vue-migration-playbook.md）：
 * - 通用控件只用 @/components/verse/*，禁止直接 import @/components/ui/*
 * - 颜色只用语义 token（bg-background / text-foreground / text-muted-foreground / border-border / bg-primary）
 * - 事件绑定用 @click / @input / @change；不要写内联 onclick= / oninput=（那是普通 HTML 属性，靠 window 全局名解析，会静默失效）
 * - 模板里用到的函数必须写进 setup() 的返回对象，否则模板访问不到
 * - 新增样式用 Tailwind 工具类；不要再新建独立 CSS 文件（架构检查会报错）
 * - 迁移/替换任何元素前，先确认 features 层没有用 classList 切换它的 .btn-* / .active 类，也没有重写它的 innerHTML
 */
import VButton from '@/components/verse/VButton.vue';
import VInput from '@/components/verse/VInput.vue';
import VTextarea from '@/components/verse/VTextarea.vue';

const PageExample = {
  components: { VButton, VInput, VTextarea },
  setup() {
    // 模板里引用到的函数/响应式数据都要在这里返回
    const onSubmit = () => {};
    const onKeywordInput = () => {};
    return { onSubmit, onKeywordInput };
  },
  template: `
    <div class="page-header">
      <h2>页面标题</h2>
      <div class="page-actions">
        <VButton variant="secondary" size="sm" @click="onSubmit()">次要操作</VButton>
        <VButton variant="accent" @click="onSubmit()">主要操作</VButton>
      </div>
    </div>

    <div class="card">
      <h3>表单区块</h3>
      <div class="form-group">
        <label>字段名</label>
        <VInput id="example-field" placeholder="请输入" @input="onKeywordInput()" />
        <span class="form-hint">字段说明</span>
      </div>
      <div class="form-group">
        <label>多行字段</label>
        <VTextarea id="example-detail" class="min-h-[120px]" placeholder="请输入描述" />
        <span class="form-hint">字段说明</span>
      </div>
    </div>

    <!-- 列表容器：内容由 features 层渲染时保留 id，不要换成组件 -->
    <div id="example-list" class="example-list"></div>
  `
};

export default PageExample;
