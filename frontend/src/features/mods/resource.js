/**
 * @file resource.js
 * @description 资源管理门面 - 汇总整合包/数据包/材质包/光影包的浏览、详情、安装与导入
 */
import { registerActions } from '../../core/actions.js';
import { pinBtnToggle } from '../versions/pinned-store.js';
import { registerLazyLoader } from '../../core/lazy-loaders.js';
import { showImportNameModal, getImportStageText, __resIsTauri } from './resource-import-modal.js';
import { loadResourcePage, setupResourceEvents, loadResourceList, preloadResourceVersions } from './resource-list.js';
import { openResourceDetail } from './resource-detail.js';
import { quickInstallResource, showVersionSelectDialog } from './resource-install.js';
import { resourceState, _resourceReqId, typeNames, typeIcons } from './resource-state.js';

registerActions({
  openResourceDetail: (event, el, id, type, source) => openResourceDetail(id, type, source),
  loadResourceList: (event, el, type) => loadResourceList(type),
  pinResource: (event, el, id, name, source, icon) => {
    pinBtnToggle(el, 'shader', id, name, { projectId: id, source, icon }, '取消置顶', '置顶光影');
  },
});

// 迁移过渡：保持旧脚本与模板可用的导入路径
export {
  showImportNameModal, getImportStageText, loadResourcePage, setupResourceEvents,
  loadResourceList, preloadResourceVersions, openResourceDetail, quickInstallResource,
  showVersionSelectDialog, resourceState, _resourceReqId, typeNames, typeIcons, __resIsTauri
};

// 详情返回栈恢复历史资源时调用
registerLazyLoader('resource:open-detail', (projectId, type, source) => openResourceDetail(projectId, type, source));
