// versions-actions.js — 版本域 data-action 注册
import { pinBtnToggle as pinBtnToggle } from './pinned-store.js';
import { registerActions as registerActions } from '../../core/actions.js';
import { retryLoadVersions, quickDeleteErrorVersion, toggleErrorVersions } from './versions-list.js';
import { deleteVersion } from './versions-delete.js';
import { navigateToPage } from './versions-nav.js';

// 版本设置 / 安装 / 加载器模块体积较大，只在真正触发对应动作时加载
const loadVersionSettings = () => import('./version-settings.js');
const loadVersionsInstall = () => import('./versions-install.js');
const loadVersionsLoaders = () => import('./versions-loaders.js');

function callPageModule(loader, name, ...args) {
  loader()
    .then((mod) => {
      const fn = mod[name];
      if (typeof fn === 'function') fn(...args);
    })
    .catch((e) => console.error('[Actions] 模块加载失败:', name, e));
}

registerActions({
  retryLoadVersions,
  pinVersion: (event, el, versionId, name, loaderText) => {
    pinBtnToggle(el, 'version', versionId, name, { versionId, loaderText }, '取消置顶', '置顶版本');
  },
  deleteVersion: (event, el, versionId) => deleteVersion(versionId),
  openVersionSettings: (event, el, versionId, versionName) => callPageModule(loadVersionSettings, 'openVersionSettings', versionId, versionName),
  toggleErrorVersions: (event, el, id) => toggleErrorVersions(id),
  quickDeleteErrorVersion: (event, el, versionId) => quickDeleteErrorVersion(versionId),
  selectLoaderVersion: (event, el, version) => callPageModule(loadVersionsInstall, 'selectLoaderVersion', version),
  selectFabricApiVersion: (event, el, versionId, displayText) => callPageModule(loadVersionsLoaders, 'selectFabricApiVersion', versionId || '', displayText),
  selectFabricApiDetailVersion: (event, el, versionId, displayText) => callPageModule(loadVersionsLoaders, 'selectFabricApiDetailVersion', versionId || '', displayText),
  navigateToPage: (event, el, page) => navigateToPage(page),
});
