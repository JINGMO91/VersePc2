/* page-datapacks - 数据包页 Vue 组件
 * 通用按钮与搜索框走 components/verse 语义层；列表与分页结构保持原样。
 */
import VButton from '@/components/verse/VButton.vue';
import VInput from '@/components/verse/VInput.vue';

const PageDatapacks = {
  components: { VButton, VInput },
  template: `
          <div class="page-header">
            <h2>数据包</h2>
          </div>
          <div class="mod-filter-bar">
            <div class="search-bar">
              <VInput type="text" id="datapack-search-input" placeholder="搜索数据包..." class="flex-1" />
              <VButton variant="accent" id="datapack-search-btn">搜索</VButton>
            </div>
            <div class="filter-row">
              <div class="filter-group">
                <label class="filter-label">游戏版本</label>
                <div class="custom-select custom-select-sm" id="datapack-filter-version-wrapper">
                  <div class="custom-select-trigger" id="datapack-filter-version-trigger">
                    <span class="custom-select-value" id="datapack-filter-version-value">全部</span>
                    <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </div>
                  <div class="custom-select-dropdown" id="datapack-filter-version-dropdown">
                    <div class="custom-select-options" id="datapack-filter-version-options"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div id="datapack-browse-list" class="mod-list">
            <div class="loading-spinner"><div class="spinner"></div></div>
          </div>
          <div class="pagination">
            <VButton variant="secondary" size="sm" id="datapack-prev-btn">上一页</VButton>
            <span id="datapack-page-info" class="page-info">1/1</span>
            <VButton variant="secondary" size="sm" id="datapack-next-btn">下一页</VButton>
          </div>
  `
};

export default PageDatapacks;
