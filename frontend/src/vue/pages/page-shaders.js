/* page-shaders - 光影页 Vue 组件
 * 通用按钮与搜索框走 components/verse 语义层；列表与分页结构保持原样。
 */
import { openFolder } from '../../features/launch/java.js';
import VButton from '@/components/verse/VButton.vue';
import VInput from '@/components/verse/VInput.vue';

const PageShaders = {
  components: { VButton, VInput },
  setup() {
    return { openFolder };
  },
  template: `
          <div class="page-header">
            <h2>光影包</h2>
            <div class="page-actions">
              <VButton variant="secondary" @click="openFolder('shaderpacks')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                打开文件夹
              </VButton>
            </div>
          </div>
          <div class="mod-filter-bar">
            <div class="search-bar">
              <VInput type="text" id="shader-search-input" placeholder="搜索光影包..." class="flex-1" />
              <VButton variant="accent" id="shader-search-btn">搜索</VButton>
            </div>
          </div>
          <div id="shader-browse-list" class="mod-list">
            <div class="loading-spinner"><div class="spinner"></div></div>
          </div>
          <div class="pagination">
            <VButton variant="secondary" size="sm" id="shader-prev-btn">上一页</VButton>
            <span id="shader-page-info" class="page-info">1/1</span>
            <VButton variant="secondary" size="sm" id="shader-next-btn">下一页</VButton>
          </div>
  `
};

export default PageShaders;
