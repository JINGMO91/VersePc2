/* page-downloads - 下载页 Vue 组件 */
import { dlManager } from '../../features/versions/custom-download.js';

import { clearCompletedDownloads } from '../../features/versions/custom-download.js';
import VButton from '@/components/verse/VButton.vue';

const PageDownloads = {
  components: { VButton },
  setup() {
    // dlManager 原为内联 oninput 调用的全局对象，改为模板事件后必须暴露到作用域
    return { clearCompletedDownloads, dlManager };
  },
  template: `
          <div class="page-header dl-page-header">
            <h2>下载管理</h2>
            <div class="page-actions dl-page-actions">
              <div class="dl-search">
                <svg class="dl-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input type="text" id="dl-search-input" class="dl-search-input" placeholder="搜索下载任务..." @input="dlManager.applySearch($event.target.value)">
              </div>
              <VButton variant="secondary" size="sm" @click="clearCompletedDownloads()">清空已完成</VButton>
            </div>
          </div>
          <div id="download-queue-list" class="dl-queue-list">
            <p class="empty-text" id="dl-empty-hint">暂无下载任务</p>
          </div>
  `
};

export default PageDownloads;
