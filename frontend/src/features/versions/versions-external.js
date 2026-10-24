// versions-external.js — 外部版本文件夹管理
import { API as API } from '../../core/api.js';
import { vmHolders as vmHolders } from '../../core/vm-holders.js';
import { escapeHtml as escapeHtml } from '../../core/utils.js';
import { showToast as showToast, showModal as showModal, hideModal as hideModal } from '../misc/ui-components.js';
import { versionsState as S, getSelectedFolder } from './versions-state.js';
import { loadVersions, renderInstalledVersionsInto } from './versions-list.js';

async function addExternalFolder() {
  document.getElementById('external-folder-path').value = '';
  document.getElementById('external-folder-name').value = '';
  document.getElementById('external-folder-preview').style.display = 'none';
  document.getElementById('external-folder-error').style.display = 'none';
  document.getElementById('external-folder-confirm-btn').disabled = true;
  const detectEl = document.getElementById('external-folder-detect');
  if (detectEl) detectEl.style.display = 'none';
  const resultEl = document.getElementById('external-folder-detect-result');
  if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }
  S.pendingExternalFolderPath = '';
  showModal('external-folder-modal');
}

function closeExternalFolderModal() {
  hideModal('external-folder-modal');
  S.pendingExternalFolderPath = '';
}

async function autoDetectExternalFolders() {
  if (S._detectingFolders) return;
  S._detectingFolders = true;

  const detectEl = document.getElementById('external-folder-detect');
  const resultEl = document.getElementById('external-folder-detect-result');
  const errorEl = document.getElementById('external-folder-error');
  if (errorEl) errorEl.style.display = 'none';
  if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }

  try {
    // 显示跨盘搜索加载动画（rose-loader 会自动把 .spinner 升级为玫瑰曲线动画）
    if (detectEl) detectEl.style.display = 'block';

    const res = await API.autoDetectFolders();
    const folders = (res && res.folders) || [];

    if (folders.length === 0) {
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px">未在磁盘上找到包含 versions 子目录的 Minecraft 版本文件夹。</div>';
      }
      return;
    }

    // 逐个添加找到的文件夹
    let addedCount = 0;
    const added = [];
    const skipped = [];
    for (const f of folders) {
      try {
        const r = await API.addExternalFolder(f.path, f.name || '');
        if (r && r.success) { addedCount++; added.push(f); }
        else { skipped.push({ path: f.path, reason: (r && r.error) || '添加失败' }); }
      } catch (e) {
        skipped.push({ path: f.path, reason: (e && e.message) || '添加失败' });
      }
    }

    if (resultEl) {
      let html = `<div style="font-size:13px;color:var(--text-primary);font-weight:600;margin-bottom:8px">一键识别完成：新增 ${added.length} 个版本文件夹</div>`;
      if (added.length > 0) {
        html += added.map(f =>
          `<div style="font-size:12px;color:var(--text-secondary);padding:3px 0">✓ ${escapeHtml(f.name)}（${escapeHtml(f.path)}）</div>`
        ).join('');
      }
      if (skipped.length > 0) {
        html += `<div style="font-size:12px;color:var(--text-muted);margin-top:6px">${skipped.length} 个已存在或无效：${escapeHtml(skipped.map(s => s.reason).join('；'))}</div>`;
      }
      resultEl.style.display = 'block';
      resultEl.innerHTML = html;
    }

    if (addedCount > 0) {
      // 刷新文件夹选择器与已安装版本列表
      await populateFolderSelector();
      await loadVersions(true);
      const container = document.getElementById('installed-versions-list');
      if (container) renderInstalledVersionsInto(container);
    }
  } catch (e) {
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<div style="color:#ff4d4d;font-size:13px">一键识别失败：' + escapeHtml((e && e.message) || e) + '</div>';
    }
  } finally {
    if (detectEl) detectEl.style.display = 'none';
    S._detectingFolders = false;
  }
}

async function selectExternalFolderPath() {
  try {
    const result = await API.selectExternalFolder();
    if (result.success && result.path) {
      document.getElementById('external-folder-path').value = result.path;
      S.pendingExternalFolderPath = result.path;
      document.getElementById('external-folder-error').style.display = 'none';
      document.getElementById('external-folder-confirm-btn').disabled = false;
    }
  } catch (e) {
    console.error('Select external folder error:', e);
  }
}

async function confirmAddExternalFolder() {
  const folderPath = document.getElementById('external-folder-path').value || S.pendingExternalFolderPath;
  const folderName = document.getElementById('external-folder-name').value.trim();
  if (!folderPath) {
    showToast('请先选择文件夹', 'error');
    return;
  }
  const confirmBtn = document.getElementById('external-folder-confirm-btn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '添加中...';
  try {
    const result = await API.addExternalFolder(folderPath, folderName);
    if (result.success) {
      showToast(`已添加文件夹，发现 ${result.versions.length} 个版本`, 'success');
      if (result.versions && result.versions.length > 0) {
        const listHtml = result.versions.map(v => {
          let typeLabel = '原版';
          if (v.isFabric) typeLabel = 'Fabric';
          else if (v.isForge) typeLabel = 'Forge';
          else if (v.isNeoForge) typeLabel = 'NeoForge';
          return `<div style="padding:4px 0;display:flex;align-items:center;gap:8px"><span style="color:var(--text-primary)">${v.id}</span><span style="color:var(--text-muted);font-size:12px;padding:2px 6px;border-radius:4px;background:var(--bg-tertiary)">${typeLabel}</span></div>`;
        }).join('');
        document.getElementById('external-folder-versions-list').innerHTML = listHtml;
        document.getElementById('external-folder-preview').style.display = 'block';
      }
      setTimeout(() => {
        closeExternalFolderModal();
        loadVersions(true).then(() => {
          setSelectedFolder(folderPath);
          populateFolderSelector();
          const container = document.getElementById('installed-versions-list');
          if (container) renderInstalledVersionsInto(container);
        });
      }, 1500);
    } else {
      document.getElementById('external-folder-error').textContent = result.error || '添加失败';
      document.getElementById('external-folder-error').style.display = 'block';
    }
  } catch (e) {
    document.getElementById('external-folder-error').textContent = '添加失败: ' + e.message;
    document.getElementById('external-folder-error').style.display = 'block';
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = '添加';
  }
}

function setSelectedFolder(folder) {
  S._selectedFolder = folder;
  try { localStorage.setItem('versepc_selected_folder', folder); } catch (e) {}
}

async function populateFolderSelector() {
  S._selectedFolder = getSelectedFolder();
  if (vmHolders.installedVersions && typeof vmHolders.installedVersions.loadFolders === 'function') {
    await vmHolders.installedVersions.loadFolders();
    return;
  }
  const select = document.getElementById('folder-selector');
  if (!select) return;
  let html = '<option value="__internal">游戏文件夹</option>';
  try {
    const result = await API.listExternalFolders();
    const folders = result && result.folders ? result.folders : [];
    if (folders.length > 0) {
      for (const f of folders) {
        const label = f.name || f.path;
        html += `<option value="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}">${escapeHtml(label)}${f.versionCount != null ? ' (' + f.versionCount + ')' : ''}</option>`;
      }
    }
  } catch (e) {}
  select.innerHTML = html;
  select.value = S._selectedFolder;
}

function onFolderSelectorChange() {
  const select = document.getElementById('folder-selector');
  if (!select) return;
  setSelectedFolder(select.value);
  const container = document.getElementById('installed-versions-list');
  if (container) renderInstalledVersionsInto(container);
}

async function refreshInstalledVersions() {
  const container = document.getElementById('installed-versions-list');
  if (container) {
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在刷新...</p></div>';
  }
  S._versionsLoadTime = 0;
  await loadVersions(true);
  await populateFolderSelector();
  if (container) renderInstalledVersionsInto(container);
}

export { addExternalFolder, closeExternalFolderModal, autoDetectExternalFolders, selectExternalFolderPath, confirmAddExternalFolder, getSelectedFolder, setSelectedFolder, populateFolderSelector, onFolderSelectorChange, refreshInstalledVersions };
