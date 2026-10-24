/**
 * @file favorites.js
 * @description 收藏夹管理门面 - 汇总数据渲染、多选批量与管理动作，并注册全局动作
 */
import { openModDetail } from './mod-detail.js';
import { appState } from '../../core/app-state.js';
import { registerActions } from '../../core/actions.js';
import {
  loadFavoritesData, renderFavFolderSelect, renderFavPage, fetchFavProjects,
  enterFavSubPage, exitFavSubPage, populateFavSubFolderSelect, onFavSubFolderChange,
  renderFavSubFolderSelect, onFavSubSearch, renderFavSubList, setupFavSearchListeners
} from './favorites-data.js';
import {
  toggleFavSubMultiSelect, toggleFavSubItemSelect, toggleFavSubSelectAll, updateFavSubMultiBar,
  batchRemoveFavSub, batchDownloadFavSub, toggleFavItemSelect, toggleFavMultiSelect,
  toggleFavSelectAll, updateFavSelectUI, removeFavItem, batchRemoveFavorites, batchDownloadFavorites
} from './favorites-selection.js';
import {
  editFavNote, showFavManageMenu, closeFavMenus, closeFavMenusHandler, createNewFavorite,
  renameCurrentFavorite, deleteCurrentFavorite, exportCurrentFav, showFavImportModal, importFavData,
  updateFavHeartButtons, showFavSelectDropdown, toggleFavForProject, removeFromAllFavs
} from './favorites-manage.js';

// 打开收藏项目详情（多选模式下切换选中状态）
function openFavItemDetail(projectId, source) {
  if (appState._favMultiSelectMode) {
    toggleFavItemSelect(projectId);
    return;
  }
  openModDetail(projectId, source);
}

registerActions({
  openFavItemDetail: (event, el, projectId, source) => openFavItemDetail(projectId, source),
  toggleFavItemSelect: (event, el, projectId) => toggleFavItemSelect(projectId),
  editFavNote: (event, el, projectId) => editFavNote(projectId),
  removeFavItem: (event, el, projectId) => removeFavItem(projectId),
  toggleFavSubItemSelect: (event, el, projectId) => toggleFavSubItemSelect(projectId),
  showFavSelectDropdown: (event, el, projectId) => showFavSelectDropdown(projectId, el),
  createNewFavorite,
  renameCurrentFavorite,
  deleteCurrentFavorite,
  removeFromAllFavs: (event, el, projectId) => removeFromAllFavs(projectId),
  toggleFavForProject: (event, el, favId, projectId, isRemove) => toggleFavForProject(favId, projectId, isRemove),
});

// 迁移过渡：保持旧脚本与模板可用的导入路径
export {
  loadFavoritesData, renderFavFolderSelect, renderFavPage, fetchFavProjects, openFavItemDetail,
  enterFavSubPage, exitFavSubPage, populateFavSubFolderSelect, onFavSubFolderChange,
  renderFavSubFolderSelect, onFavSubSearch, renderFavSubList, toggleFavSubMultiSelect,
  toggleFavSubItemSelect, toggleFavSubSelectAll, updateFavSubMultiBar, batchRemoveFavSub,
  batchDownloadFavSub, toggleFavItemSelect, toggleFavMultiSelect, toggleFavSelectAll,
  updateFavSelectUI, removeFavItem, batchRemoveFavorites, editFavNote, showFavManageMenu,
  closeFavMenus, closeFavMenusHandler, createNewFavorite, renameCurrentFavorite,
  deleteCurrentFavorite, exportCurrentFav, showFavImportModal, importFavData,
  batchDownloadFavorites, updateFavHeartButtons, showFavSelectDropdown, toggleFavForProject,
  removeFromAllFavs, setupFavSearchListeners
};
