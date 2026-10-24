/* page-resourcepacks - 资源包页 Vue 组件
 * 通用按钮与搜索框走 components/verse 语义层；自研 custom-select 保持原样。
 */
import { openFolder } from '../../features/launch/java.js';
import VButton from '@/components/verse/VButton.vue';
import VInput from '@/components/verse/VInput.vue';

const PageResourcepacks = {
  components: { VButton, VInput },
  setup() {
    return { openFolder };
  },
  template: `
          <div class="page-header">
            <h2>材质包</h2>
            <div class="page-actions">
              <VButton variant="secondary" @click="openFolder('resourcepacks')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                打开文件夹
              </VButton>
            </div>
          </div>
          <div class="mod-filter-bar">
            <div class="search-bar">
              <VInput type="text" id="resourcepack-search-input" placeholder="搜索材质包..." class="flex-1" />
              <VButton variant="accent" id="resourcepack-search-btn">搜索</VButton>
            </div>
            <div class="filter-row">
              <div class="filter-group">
                <label class="filter-label">游戏版本</label>
                <div class="custom-select custom-select-sm" id="resourcepack-filter-version-wrapper">
                  <div class="custom-select-trigger" id="resourcepack-filter-version-trigger">
                    <span class="custom-select-value" id="resourcepack-filter-version-value">全部</span>
                    <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </div>
                  <div class="custom-select-dropdown" id="resourcepack-filter-version-dropdown">
                    <div class="custom-select-options" id="resourcepack-filter-version-options"></div>
                  </div>
                </div>
              </div>
              <div class="filter-group">
                <label class="filter-label">分辨率</label>
                <div class="custom-select custom-select-sm" id="resourcepack-filter-resolution-wrapper">
                  <div class="custom-select-trigger" id="resourcepack-filter-resolution-trigger">
                    <span class="custom-select-value" id="resourcepack-filter-resolution-value">全部</span>
                    <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </div>
                  <div class="custom-select-dropdown" id="resourcepack-filter-resolution-dropdown">
                    <div class="custom-select-options" id="resourcepack-filter-resolution-options"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div id="resourcepack-browse-list" class="mod-list">
            <div class="loading-spinner"><div class="spinner"></div></div>
          </div>
          <div class="pagination">
            <VButton variant="secondary" size="sm" id="resourcepack-prev-btn">上一页</VButton>
            <span id="resourcepack-page-info" class="page-info">1/1</span>
            <VButton variant="secondary" size="sm" id="resourcepack-next-btn">下一页</VButton>
          </div>
  `
};

export default PageResourcepacks;
