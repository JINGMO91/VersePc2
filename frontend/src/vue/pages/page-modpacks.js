/* page-modpacks - 整合包页 Vue 组件
 * 通用按钮与搜索框走 components/verse 语义层；自研 custom-select 保持原样。
 */
import VButton from '@/components/verse/VButton.vue';
import VInput from '@/components/verse/VInput.vue';

const PageModpacks = {
  components: { VButton, VInput },
  template: `
          <div class="page-header">
            <h2>整合包</h2>
          </div>
          <div class="mod-filter-bar">
            <div class="search-bar">
              <VInput type="text" id="modpack-search-input" placeholder="搜索整合包..." class="flex-1" />
              <VButton variant="accent" id="modpack-search-btn">搜索</VButton>
            </div>
            <div class="filter-row">
              <div class="filter-group">
                <label class="filter-label">加载器</label>
                <div class="custom-select custom-select-sm" id="modpack-filter-loader-wrapper">
                  <div class="custom-select-trigger" id="modpack-filter-loader-trigger">
                    <span class="custom-select-value" id="modpack-filter-loader-value">全部</span>
                    <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </div>
                  <div class="custom-select-dropdown" id="modpack-filter-loader-dropdown">
                    <div class="custom-select-options" id="modpack-filter-loader-options"></div>
                  </div>
                </div>
              </div>
              <div class="filter-group">
                <label class="filter-label">游戏版本</label>
                <div class="custom-select custom-select-sm" id="modpack-filter-version-wrapper">
                  <div class="custom-select-trigger" id="modpack-filter-version-trigger">
                    <span class="custom-select-value" id="modpack-filter-version-value">全部</span>
                    <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </div>
                  <div class="custom-select-dropdown" id="modpack-filter-version-dropdown">
                    <div class="custom-select-options" id="modpack-filter-version-options"></div>
                  </div>
                </div>
              </div>
              <div class="filter-group">
                <label class="filter-label">下载源</label>
                <div class="custom-select custom-select-sm" id="modpack-filter-source-wrapper">
                  <div class="custom-select-trigger" id="modpack-filter-source-trigger">
                    <span class="custom-select-value" id="modpack-filter-source-value">全部</span>
                    <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </div>
                  <div class="custom-select-dropdown" id="modpack-filter-source-dropdown">
                    <div class="custom-select-options" id="modpack-filter-source-options"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div id="modpack-browse-list" class="mod-list">
            <div class="loading-spinner"><div class="spinner"></div></div>
          </div>
          <div class="pagination">
            <VButton variant="secondary" size="sm" id="modpack-prev-btn">上一页</VButton>
            <span id="modpack-page-info" class="page-info">1/1</span>
            <VButton variant="secondary" size="sm" id="modpack-next-btn">下一页</VButton>
          </div>
  `
};

export default PageModpacks;
