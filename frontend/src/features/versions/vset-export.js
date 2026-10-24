import { API as API } from '../../core/api.js';
import { escapeHtml as escapeHtml } from '../../core/utils.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { appState as appState } from '../../core/app-state.js';
import { S } from './vset-state.js';

function toggleExportTree(el) {
  el.classList.toggle('expanded');
}

async function loadExportTreeData() {
  if (!appState.currentSettingsVersionId) return;

  try {
    const data = await API.getVersionExportInfo(appState.currentSettingsVersionId);
    S._exportTreeLoaded = true;

    if (data.gameDesc) {
      const el = document.getElementById('export-game-desc');
      if (el) el.textContent = data.gameDesc;
    }

    if (data.modCount !== undefined) {
      const el = document.getElementById('export-mod-count');
      if (el) el.textContent = `${data.modCount} 个`;
    }

    if (data.savesCount !== undefined) {
      const el = document.getElementById('export-saves-desc');
      if (el) el.textContent = `${data.savesCount} 个存档`;
    }

    const rpList = document.getElementById('export-rp-list');
    if (rpList && data.resourcePacks && data.resourcePacks.length > 0) {
      rpList.innerHTML = data.resourcePacks.map(rp =>
        `<div class="export-tree-item"><input type="checkbox" checked class="export-cb" data-key="rp_${escapeHtml(rp)}"><span class="export-label">${escapeHtml(rp)}</span></div>`
      ).join('');
    } else if (rpList) {
      rpList.innerHTML = '<div class="export-tree-item"><span class="export-label" style="color:var(--text-muted)">暂无资源包</span></div>';
    }

    const savesList = document.getElementById('export-saves-list');
    if (savesList && data.saves && data.saves.length > 0) {
      savesList.innerHTML = data.saves.slice(0, 10).map(s =>
        `<div class="export-tree-item"><input type="checkbox" checked class="export-cb" data-key="save_${escapeHtml(s)}"><span class="export-label">${escapeHtml(s)}</span></div>`
      ).join('') + (data.saves.length > 10 ? `<div class="export-tree-item"><span class="export-label" style="color:var(--text-muted)">... 还有 ${data.saves.length - 10} 个存档</span></div>` : '');
    } else if (savesList) {
      savesList.innerHTML = '<div class="export-tree-item"><span class="export-label" style="color:var(--text-muted)">暂无存档</span></div>';
    }
  } catch (e) {
    console.error('[Export] Load tree data error:', e);
  }
}

function startExport() {
  if (!appState.currentSettingsVersionId) return;
  const name = document.getElementById('export-name')?.value || '';
  const version = document.getElementById('export-version')?.value || '1.0.0';
  const author = document.getElementById('export-author')?.value || '';
  const description = document.getElementById('export-description')?.value || '';

  if (!name.trim()) { showToast('请输入整合包名称', 'error'); return; }

  const selectedKeys = [];
  document.querySelectorAll('.export-cb:checked').forEach(cb => selectedKeys.push(cb.dataset.key));

  showToast('正在导出整合包...', 'info');
  API.exportModpack(appState.currentSettingsVersionId, name, version, author, description, selectedKeys).then(r => {
    if (r.success) {
      showToast(`整合包已导出到 ${r.path}`, 'success');
    } else {
      showToast(r.error || '导出失败', 'error');
    }
  }).catch(e => showToast('导出失败: ' + (e.message || ''), 'error'));
}

function exportLaunchScript() {
  if (!appState.currentSettingsVersionId) return;
  API.exportLaunchScript(appState.currentSettingsVersionId).then(r => {
    if (r.success) showToast('启动脚本已导出', 'success');
    else showToast(r.error || '导出失败', 'error');
  });
}

export { toggleExportTree, loadExportTreeData, startExport, exportLaunchScript };
