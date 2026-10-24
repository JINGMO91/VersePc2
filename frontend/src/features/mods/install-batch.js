import { API as API } from '../../core/api.js';
import { getCustomSelectValue as getCustomSelectValue } from '../misc/custom-select.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { requestLazyLoad } from '../../core/lazy-loaders.js';
import { dlManager as dlManager } from '../versions/custom-download.js';
import { modDetailState } from './detail-state.js';
import { appState as appState } from '../../core/app-state.js';
import { formatModNameWithChinese as formatModNameWithChinese } from './chinese-names.js';
import { S } from './install-state.js';
import { resolveModSavePath } from './install-paths.js';

// 批量安装完成后刷新列表，通过懒加载中转避免依赖页面模块
const loadInstalledMods = () => requestLazyLoad('mods:installed');
const loadMods = () => requestLazyLoad('mods:refresh');
const loadInstalledModsForSettings = () => requestLazyLoad('vset:installed-mods');

function showModDownloadModal(fileName, sessionId, savePath, iconUrl) {
  const taskId = 'mod-' + sessionId;
  const resolvedIcon = iconUrl || modDetailState.data?.icon || '';
  dlManager.add(taskId, fileName || '模组下载', 'mod', sessionId, resolvedIcon);

  appState.modDownloadPollTimers.forEach(t => clearTimeout(t));
  appState.modDownloadPollTimers = [];

  let unknownRetries = 0;
  const poll = async () => {
    try {
      const data = await API.getModDownloadStatus(sessionId);
      dlManager.update(taskId, {
        progress: data.progress || 0,
        status: data.status === 'completed' ? 'completed' : data.status === 'failed' ? 'failed' : 'downloading',
        message: data.message || '下载中...'
      });
      if (data.status === 'completed') {
        showToast(`${fileName} 下载完成`, 'success');
        loadInstalledMods();
        return;
      }
      if (data.status === 'failed') {
        showToast(`下载失败: ${data.message}`, 'error');
        return;
      }
      if (data.status === 'unknown' || !data.status) {
        unknownRetries++;
        if (unknownRetries <= 1) {
          const timer = setTimeout(poll, 3000);
          appState.modDownloadPollTimers.push(timer);
          return;
        }
        dlManager.update(taskId, { status: 'failed', message: '会话已失效' });
        return;
      }
      const timer = setTimeout(poll, 500);
      appState.modDownloadPollTimers.push(timer);
    } catch (e) {
      const timer = setTimeout(poll, 1000);
      appState.modDownloadPollTimers.push(timer);
    }
  };
  const timer = setTimeout(poll, 500);
  appState.modDownloadPollTimers.push(timer);
}

function toggleModMultiSelect() {
  appState.modMultiSelectMode = !appState.modMultiSelectMode;
  const toggleBtn = document.getElementById('mod-multiselect-toggle');
  const bar = document.getElementById('mod-multiselect-bar');
  const hintEl = document.getElementById('mod-filter-hint');
  
  if (appState.modMultiSelectMode) {
    toggleBtn.classList.add('btn-primary');
    toggleBtn.classList.remove('btn-secondary');
    bar.style.display = 'flex';
    appState.modSelectedIds.clear();
    appState.modSelectedVersions.clear();
    
    const gv = getCustomSelectValue('mod-filter-version') || '';
    const ld = getCustomSelectValue('mod-filter-loader') || '';
    let hintParts = [];
    if (gv) hintParts.push(gv);
    if (ld) hintParts.push(ld.charAt(0).toUpperCase() + ld.slice(1));
    if (hintEl) hintEl.textContent = hintParts.length > 0 ? `将下载 ${hintParts.join(' + ')} 版本` : '建议先选择游戏版本和加载器';
    
    updateModSelectUI();
  } else {
    toggleBtn.classList.remove('btn-primary');
    toggleBtn.classList.add('btn-secondary');
    bar.style.display = 'none';
    appState.modSelectedIds.clear();
    appState.modSelectedVersions.clear();
  }
  loadMods();
}

function toggleModSelect(modId) {
  if (appState.modSelectedIds.has(modId)) {
    appState.modSelectedIds.delete(modId);
  } else {
    appState.modSelectedIds.add(modId);
  }
  updateModSelectUI();
  
  const safeId = CSS.escape(modId);
  const checkbox = document.querySelector(`.mod-checkbox[data-mod-id="${safeId}"]`);
  if (checkbox) {
    checkbox.classList.toggle('checked', appState.modSelectedIds.has(modId));
  }
}

function toggleSelectAllMods(checked) {
  const container = document.getElementById('mod-browse-list');
  const items = container.querySelectorAll('.mod-item');
  
  if (checked) {
    items.forEach(item => {
      const checkbox = item.querySelector('.mod-checkbox');
      if (checkbox) {
        const modId = checkbox.dataset.modId;
        appState.modSelectedIds.add(modId);
        checkbox.classList.add('checked');
      }
    });
  } else {
    appState.modSelectedIds.clear();
    items.forEach(item => {
      const checkbox = item.querySelector('.mod-checkbox');
      if (checkbox) checkbox.classList.remove('checked');
    });
  }
  updateModSelectUI();
}

function updateModSelectUI() {
  const countEl = document.getElementById('mod-selected-count');
  const batchBtn = document.getElementById('mod-batch-download-btn');
  const selectAll = document.getElementById('mod-select-all');
  
  if (countEl) countEl.textContent = `已选 ${appState.modSelectedIds.size} 个`;
  if (batchBtn) batchBtn.disabled = appState.modSelectedIds.size === 0;
  
  const container = document.getElementById('mod-browse-list');
  const totalItems = container.querySelectorAll('.mod-checkbox').length;
  if (selectAll) selectAll.checked = totalItems > 0 && appState.modSelectedIds.size >= totalItems;
}

async function batchDownloadMods() {
  if (appState.modSelectedIds.size === 0) return;

  const defaultPath = await resolveModSavePath();
  const folderResult = await API.selectSaveFolder(defaultPath);
  if (folderResult.cancelled) return;
  const savePath = folderResult.path;
  if (!savePath) {
    showToast('未选择文件夹', 'error');
    return;
  }
  localStorage.setItem('lastModSavePath', savePath);

  const currentGameVersion = getCustomSelectValue('mod-filter-version');
  const currentLoader = getCustomSelectValue('mod-filter-loader');
  
  const modIds = Array.from(appState.modSelectedIds);
  const total = modIds.length;
  
  const modInfoMap = {};
  appState.modSearchResults.forEach(m => { modInfoMap[m.id] = m; });

  const batchTaskId = 'batch-' + Date.now();
  const files = modIds.map(id => {
    const info = modInfoMap[id];
    const displayName = info ? formatModNameWithChinese(info.slug || id, info.title) : id;
    return { name: displayName, status: 'pending', size: '' };
  });
  dlManager.add(batchTaskId, `批量下载 ${total} 个模组`, 'mod', '');
  dlManager.update(batchTaskId, { files: files });

  let completed = 0;
  let failed = 0;
  
  for (let i = 0; i < modIds.length; i++) {
    const modId = modIds[i];

    files[i].status = 'downloading';
    dlManager.update(batchTaskId, {
      progress: Math.round((i / total) * 100),
      message: `正在下载 ${i + 1}/${total}`,
      files: [...files]
    });
    
    try {
      const selectedVer = appState.modSelectedVersions.get(modId);
      const versionId = selectedVer?.versionId || '';
      const fileId = selectedVer?.fileId || '';
      const source = selectedVer?.source || 'modrinth';
      const sGame = selectedVer?.gameVersion || '';
      const sLoader = selectedVer?.loader || '';

      let targetPath = savePath;
      if (sGame || sLoader) {
        S._mdSaveGame = sGame;
        S._mdSaveLoader = sLoader;
        const modPath = await resolveModSavePath(versionId);
        if (modPath) targetPath = modPath;
      }

      const result = await API.downloadModVersion(versionId, modId, source, fileId, sGame || currentGameVersion, sLoader || currentLoader, targetPath);
      
      if (result.success) {
        await pollBatchModDownload(result.sessionId, modId);
        completed++;
        files[i].status = 'completed';
      } else {
        failed++;
        files[i].status = 'failed';
      }
    } catch (e) {
      failed++;
      files[i].status = 'failed';
    }
    
    dlManager.update(batchTaskId, {
      progress: Math.round(((i + 1) / total) * 100),
      message: `下载完成 ${completed}/${total}${failed > 0 ? `，失败 ${failed}` : ''}`,
      status: (i + 1 === total) ? (failed === total ? 'failed' : 'completed') : 'downloading',
      files: [...files]
    });
  }
  
  appState.modSelectedIds.clear();
  appState.modSelectedVersions.clear();
  updateModSelectUI();
  
  if (appState.currentSettingsVersionId) {
    loadInstalledModsForSettings();
  }
  loadInstalledMods();
}

function pollBatchModDownload(sessionId, _modId) {
  return new Promise((resolve) => {
    const poll = async () => {
      try {
        const data = await API.getModDownloadStatus(sessionId);
        if (data.status === 'completed') {
          resolve();
          return;
        }
        if (data.status === 'failed') {
          resolve();
          return;
        }
        setTimeout(poll, 500);
      } catch (e) {
        setTimeout(poll, 1000);
      }
    };
    setTimeout(poll, 500);
  });
}

export { showModDownloadModal, toggleModMultiSelect, toggleModSelect, toggleSelectAllMods, updateModSelectUI, batchDownloadMods, pollBatchModDownload };
