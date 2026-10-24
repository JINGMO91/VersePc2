// 收藏夹多选与批量操作：主页/子页面选中切换、全选、批量取消收藏与批量下载。
import { API } from '../../core/api.js';
import { showToast } from '../misc/ui-components.js';
import { quickInstallMod, showModDownloadModal } from './mod-install.js';
import { appState } from '../../core/app-state.js';
import { favSubState } from './favorites-state.js';
import { fetchFavProjects, renderFavFolderSelect, renderFavPage, renderFavSubList } from './favorites-data.js';
import { updateFavHeartButtons } from './favorites-manage.js';

// 切换子页面多选模式
function toggleFavSubMultiSelect() {
  favSubState.multiSelect = !favSubState.multiSelect;
  favSubState.selected.clear();
  const bar = document.getElementById('fav-sub-multi-bar');
  const toggle = document.getElementById('fav-sub-multi-toggle');
  if (bar) bar.style.display = favSubState.multiSelect ? 'flex' : 'none';
  if (toggle) toggle.textContent = favSubState.multiSelect ? '取消多选' : '多选';
  updateFavSubMultiBar();
  renderFavSubList();
}

// 切换子页面单个项目选中状态
function toggleFavSubItemSelect(projectId) {
  if (favSubState.selected.has(projectId)) {
    favSubState.selected.delete(projectId);
  } else {
    favSubState.selected.add(projectId);
  }
  updateFavSubMultiBar();
  const checkbox = document.querySelector('.mod-checkbox[data-mod-id="' + projectId + '"]');
  if (checkbox) checkbox.classList.toggle('checked', favSubState.selected.has(projectId));
}

// 子页面全选/取消全选
function toggleFavSubSelectAll(checked) {
  const currentFav = appState._favorites.find((f) => f.id === favSubState.currentFavId);
  if (!currentFav) return;
  favSubState.selected.clear();
  if (checked) {
    currentFav.favs.forEach((id) => { favSubState.selected.add(id); });
  }
  updateFavSubMultiBar();
  document.querySelectorAll('#fav-sub-list .mod-checkbox').forEach((cb) => {
    cb.classList.toggle('checked', favSubState.selected.has(cb.getAttribute('data-mod-id')));
  });
}

// 更新子页面多选操作栏状态
function updateFavSubMultiBar() {
  const countEl = document.getElementById('fav-sub-selected-count');
  const removeBtn = document.getElementById('fav-sub-batch-remove');
  const downloadBtn = document.getElementById('fav-sub-batch-download');
  if (countEl) countEl.textContent = '已选 ' + favSubState.selected.size + ' 个';
  if (removeBtn) removeBtn.disabled = favSubState.selected.size === 0;
  if (downloadBtn) downloadBtn.disabled = favSubState.selected.size === 0;
}

// 批量取消子页面选中项目的收藏
async function batchRemoveFavSub() {
  if (favSubState.selected.size === 0) return;
  if (!confirm('确定取消收藏选中的 ' + favSubState.selected.size + ' 个项目？')) return;
  try {
    for (const projectId of favSubState.selected) {
      await API.removeFromFavorite(favSubState.currentFavId, projectId);
      const fav = appState._favorites.find((f) => f.id === favSubState.currentFavId);
      if (fav) fav.favs = fav.favs.filter((id) => id !== projectId);
    }
    favSubState.selected.clear();
    updateFavSubMultiBar();
    showToast('已取消收藏', 'success');
    renderFavSubList();
    renderFavFolderSelect();
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

// 批量下载子页面选中项目
async function batchDownloadFavSub() {
  if (favSubState.selected.size === 0) return;
  try {
    const projects = await fetchFavProjects(Array.from(favSubState.selected));
    projects.forEach((p) => {
      if (p.id) quickInstallMod(p.id, p.source || 'modrinth', '', '');
    });
    showToast('已开始下载 ' + favSubState.selected.size + ' 个模组', 'success');
  } catch (e) {
    showToast('批量下载失败', 'error');
  }
}

// 切换单个项目选中状态
function toggleFavItemSelect(projectId) {
  if (appState._favSelectedItems.has(projectId)) {
    appState._favSelectedItems.delete(projectId);
  } else {
    appState._favSelectedItems.add(projectId);
  }
  updateFavSelectUI();
  const cb = document.querySelector('.fav-item[data-id="' + CSS.escape(projectId) + '"] .fav-item-checkbox');
  if (cb) cb.checked = appState._favSelectedItems.has(projectId);
}

// 切换主页多选模式
function toggleFavMultiSelect() {
  appState._favMultiSelectMode = !appState._favMultiSelectMode;
  appState._favSelectedItems.clear();
  const bar = document.getElementById('fav-multiselect-bar');
  if (bar) bar.style.display = appState._favMultiSelectMode ? 'flex' : 'none';
  const btn = document.getElementById('fav-multiselect-toggle');
  if (btn) btn.classList.toggle('active', appState._favMultiSelectMode);
  renderFavPage();
}

// 主页全选/取消全选
function toggleFavSelectAll(checked) {
  const currentFav = appState._favorites.find((f) => f.id === appState._currentFavId);
  if (!currentFav) return;
  appState._favSelectedItems.clear();
  if (checked) currentFav.favs.forEach((id) => { appState._favSelectedItems.add(id); });
  updateFavSelectUI();
  renderFavPage();
}

// 更新主页多选操作栏状态
function updateFavSelectUI() {
  const count = appState._favSelectedItems.size;
  const countEl = document.getElementById('fav-selected-count');
  if (countEl) countEl.textContent = '已选 ' + count + ' 个';
  const removeBtn = document.getElementById('fav-batch-remove-btn');
  if (removeBtn) removeBtn.disabled = count === 0;
  const downloadBtn = document.getElementById('fav-batch-download-btn');
  if (downloadBtn) downloadBtn.disabled = count === 0;
}

// 取消单个项目收藏
async function removeFavItem(projectId) {
  if (!appState._currentFavId) return;
  try {
    await API.removeFromFavorite(appState._currentFavId, projectId);
    const fav = appState._favorites.find((f) => f.id === appState._currentFavId);
    if (fav) fav.favs = fav.favs.filter((id) => id !== projectId);
    renderFavFolderSelect();
    renderFavPage();
    updateFavHeartButtons();
    showToast('已取消收藏', 'success');
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

// 批量取消主页选中项目的收藏
async function batchRemoveFavorites() {
  if (appState._favSelectedItems.size === 0) return;
  const count = appState._favSelectedItems.size;
  if (!confirm('确定要取消收藏 ' + count + ' 个项目吗？')) return;
  try {
    const idsToRemove = Array.from(appState._favSelectedItems);
    for (let i = 0; i < idsToRemove.length; i++) {
      await API.removeFromFavorite(appState._currentFavId, idsToRemove[i]);
    }
    const fav = appState._favorites.find((f) => f.id === appState._currentFavId);
    if (fav) fav.favs = fav.favs.filter((id) => !appState._favSelectedItems.has(id));
    appState._favSelectedItems.clear();
    updateFavSelectUI();
    renderFavFolderSelect();
    renderFavPage();
    updateFavHeartButtons();
    showToast('已取消 ' + count + ' 个收藏', 'success');
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

// 批量下载主页选中项目
async function batchDownloadFavorites() {
  if (appState._favSelectedItems.size === 0) return;
  const ids = Array.from(appState._favSelectedItems);
  showToast('正在准备下载 ' + ids.length + ' 个模组...', 'info');
  for (let i = 0; i < ids.length; i++) {
    try {
      const result = await API.downloadMod(ids[i], 'modrinth', '', '');
      if (result.success && result.sessionId) {
        showModDownloadModal(result.fileName, result.sessionId, result.path || '');
      }
    } catch (e) {
      console.error('下载失败:', ids[i], e);
    }
  }
  showToast('批量下载已启动', 'success');
}

export {
  toggleFavSubMultiSelect, toggleFavSubItemSelect, toggleFavSubSelectAll, updateFavSubMultiBar,
  batchRemoveFavSub, batchDownloadFavSub, toggleFavItemSelect, toggleFavMultiSelect,
  toggleFavSelectAll, updateFavSelectUI, removeFavItem, batchRemoveFavorites, batchDownloadFavorites
};
