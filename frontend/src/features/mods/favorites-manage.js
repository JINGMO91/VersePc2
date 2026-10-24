// 收藏夹管理：菜单、新建/重命名/删除、导入导出、备注、收藏按钮状态与收藏夹下拉。
import { API } from '../../core/api.js';
import { escapeHtml } from '../../core/utils.js';
import { showToast } from '../misc/ui-components.js';
import { appState } from '../../core/app-state.js';
import { actionAttrs } from '../../core/actions.js';
import { loadFavoritesData, renderFavFolderSelect, renderFavPage, renderFavSubList } from './favorites-data.js';

// 编辑收藏项目备注
async function editFavNote(projectId) {
  const currentFav = appState._favorites.find((f) => f.id === appState._currentFavId);
  if (!currentFav) return;
  const oldNote = currentFav.notes && currentFav.notes[projectId] ? currentFav.notes[projectId] : '';
  const note = prompt('编辑备注:', oldNote);
  if (note === null) return;
  try {
    await API.updateFavNote(appState._currentFavId, projectId, note);
    if (!currentFav.notes) currentFav.notes = {};
    if (note) currentFav.notes[projectId] = note;
    else delete currentFav.notes[projectId];
    renderFavPage();
    showToast('备注已更新', 'success');
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

// 显示收藏夹管理菜单（新建/重命名/删除）
function showFavManageMenu() {
  closeFavMenus();
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'fav-manage-menu';
  menu.id = 'fav-manage-menu-popup';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.innerHTML = '<div class="fav-manage-menu-item"' + actionAttrs('createNewFavorite') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新建收藏夹</div>' +
    '<div class="fav-manage-menu-item"' + actionAttrs('renameCurrentFavorite') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>重命名当前收藏夹</div>' +
    '<div class="fav-manage-menu-item danger"' + actionAttrs('deleteCurrentFavorite') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>删除当前收藏夹</div>';
  document.body.appendChild(menu);
  setTimeout(() => { document.addEventListener('click', closeFavMenusHandler, { once: true }); }, 0);
}

// 关闭所有收藏夹相关弹出菜单
function closeFavMenus() {
  document.querySelectorAll('.fav-manage-menu, .fav-select-dropdown').forEach((el) => { el.remove(); });
}

// 点击菜单外部时关闭菜单
function closeFavMenusHandler(e) {
  if (!e.target.closest('.fav-manage-menu') && !e.target.closest('.fav-select-dropdown')) {
    closeFavMenus();
  }
}

// 新建收藏夹
async function createNewFavorite() {
  closeFavMenus();
  const name = prompt('请输入收藏夹名称:');
  if (!name) return;
  try {
    const result = await API.createFavorite(name);
    if (result && result.favorite) {
      appState._favorites.push(result.favorite);
      appState._currentFavId = result.favorite.id;
      renderFavFolderSelect();
      renderFavPage();
      showToast('收藏夹已创建', 'success');
    }
  } catch (e) {
    showToast('创建失败', 'error');
  }
}

// 重命名当前收藏夹
async function renameCurrentFavorite() {
  closeFavMenus();
  const fav = appState._favorites.find((f) => f.id === appState._currentFavId);
  if (!fav) return;
  const name = prompt('请输入新名称:', fav.name);
  if (!name || name === fav.name) return;
  try {
    await API.renameFavorite(appState._currentFavId, name);
    fav.name = name;
    renderFavFolderSelect();
    showToast('重命名成功', 'success');
  } catch (e) {
    showToast('重命名失败', 'error');
  }
}

// 删除当前收藏夹（至少保留一个）
async function deleteCurrentFavorite() {
  closeFavMenus();
  if (appState._favorites.length <= 1) {
    showToast('至少保留一个收藏夹', 'error');
    return;
  }
  const fav = appState._favorites.find((f) => f.id === appState._currentFavId);
  if (!fav) return;
  if (!confirm('确定要删除收藏夹"' + fav.name + '"吗？')) return;
  try {
    await API.deleteFavorite(appState._currentFavId);
    appState._favorites = appState._favorites.filter((f) => f.id !== appState._currentFavId);
    appState._currentFavId = appState._favorites.length > 0 ? appState._favorites[0].id : '';
    renderFavFolderSelect();
    renderFavPage();
    showToast('收藏夹已删除', 'success');
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

// 导出当前收藏夹内容到剪贴板
function exportCurrentFav() {
  const fav = appState._favorites.find((f) => f.id === appState._currentFavId);
  if (!fav) return;
  const data = JSON.stringify(fav.favs);
  navigator.clipboard.writeText(data).then(() => {
    showToast('已复制到剪贴板', 'success');
  }).catch(() => {
    prompt('复制以下内容:', data);
  });
}

// 显示导入收藏夹对话框
function showFavImportModal() {
  const data = prompt('请粘贴收藏分享码:');
  if (!data) return;
  importFavData(data);
}

// 导入收藏数据
async function importFavData(data) {
  try {
    const result = await API.importFavorite(data, appState._currentFavId);
    if (result && result.success) {
      await loadFavoritesData();
      renderFavPage();
      showToast('已导入 ' + result.imported + ' 个项目', 'success');
    }
  } catch (e) {
    showToast('导入失败: ' + e.message, 'error');
  }
}

// 更新所有收藏心形按钮的激活状态
function updateFavHeartButtons() {
  document.querySelectorAll('.fav-heart-btn').forEach((btn) => {
    const projectId = btn.dataset.projectId;
    if (!projectId) return;
    const isFav = appState._favorites.some((f) => f.favs.includes(projectId));
    btn.classList.toggle('active', isFav);
  });
}

// 显示收藏夹选择下拉菜单（选择收藏到哪个收藏夹）
function showFavSelectDropdown(projectId, anchorEl) {
  closeFavMenus();
  const rect = anchorEl.getBoundingClientRect();
  const dropdown = document.createElement('div');
  dropdown.className = 'fav-select-dropdown';
  dropdown.id = 'fav-select-dropdown-popup';
  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';

  const isFavInAny = appState._favorites.some((f) => f.favs.includes(projectId));
  let innerHtml = '';
  if (isFavInAny) {
    innerHtml += '<div class="fav-select-item" style="color:var(--red)"' + actionAttrs('removeFromAllFavs', projectId) + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>取消所有收藏</div>';
  }

  appState._favorites.forEach((f) => {
    const has = f.favs.includes(projectId);
    innerHtml += '<div class="fav-select-item' + (has ? ' active' : '') + '"' + actionAttrs('toggleFavForProject', f.id, projectId, has) + '>';
    if (has) {
      innerHtml += '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
    } else {
      innerHtml += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
    }
    innerHtml += (has ? '取消收藏 ' : '收藏到 ') + escapeHtml(f.name) + '</div>';
  });
  dropdown.innerHTML = innerHtml;
  document.body.appendChild(dropdown);
  setTimeout(() => { document.addEventListener('click', closeFavMenusHandler, { once: true }); }, 0);
}

// 切换项目在某收藏夹中的收藏状态
async function toggleFavForProject(favId, projectId, isRemove) {
  closeFavMenus();
  try {
    if (isRemove) {
      await API.removeFromFavorite(favId, projectId);
      const fav = appState._favorites.find((f) => f.id === favId);
      if (fav) fav.favs = fav.favs.filter((id) => id !== projectId);
      showToast('已取消收藏', 'success');
    } else {
      await API.addToFavorite(favId, projectId);
      const fav2 = appState._favorites.find((f) => f.id === favId);
      if (fav2 && !fav2.favs.includes(projectId)) fav2.favs.push(projectId);
      showToast('已添加到收藏夹', 'success');
    }
    renderFavFolderSelect();
    updateFavHeartButtons();
    if (document.getElementById('page-mod-favorites') && document.getElementById('page-mod-favorites').classList.contains('active')) {
      renderFavPage();
    }
    if (document.getElementById('mod-fav-section') && document.getElementById('mod-fav-section').style.display !== 'none') {
      renderFavSubList();
    }
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

// 从所有收藏夹中移除指定项目
async function removeFromAllFavs(projectId) {
  closeFavMenus();
  try {
    for (let i = 0; i < appState._favorites.length; i++) {
      const fav = appState._favorites[i];
      if (fav.favs.includes(projectId)) {
        await API.removeFromFavorite(fav.id, projectId);
        fav.favs = fav.favs.filter((id) => id !== projectId);
      }
    }
    renderFavFolderSelect();
    updateFavHeartButtons();
    if (document.getElementById('mod-fav-section') && document.getElementById('mod-fav-section').style.display !== 'none') {
      renderFavSubList();
    }
    showToast('已取消所有收藏', 'success');
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

export {
  editFavNote, showFavManageMenu, closeFavMenus, closeFavMenusHandler, createNewFavorite,
  renameCurrentFavorite, deleteCurrentFavorite, exportCurrentFav, showFavImportModal, importFavData,
  updateFavHeartButtons, showFavSelectDropdown, toggleFavForProject, removeFromAllFavs
};
