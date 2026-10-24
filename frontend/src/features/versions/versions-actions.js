// versions-actions.js — 版本域 data-action 注册
import { openVersionSettings as openVersionSettings } from './version-settings.js';
import { pinBtnToggle as pinBtnToggle } from './pinned-store.js';
import { registerActions as registerActions } from '../../core/actions.js';
import { retryLoadVersions, quickDeleteErrorVersion, toggleErrorVersions } from './versions-list.js';
import { selectLoaderVersion } from './versions-install.js';
import { deleteVersion } from './versions-delete.js';
import { selectFabricApiVersion, selectFabricApiDetailVersion } from './versions-loaders.js';
import { navigateToPage } from './versions-nav.js';

registerActions({
  retryLoadVersions,
  pinVersion: (event, el, versionId, name, loaderText) => {
    pinBtnToggle(el, 'version', versionId, name, { versionId, loaderText }, '取消置顶', '置顶版本');
  },
  deleteVersion: (event, el, versionId) => deleteVersion(versionId),
  openVersionSettings: (event, el, versionId, versionName) => openVersionSettings(versionId, versionName),
  toggleErrorVersions: (event, el, id) => toggleErrorVersions(id),
  quickDeleteErrorVersion: (event, el, versionId) => quickDeleteErrorVersion(versionId),
  selectLoaderVersion: (event, el, version) => selectLoaderVersion(version),
  selectFabricApiVersion: (event, el, versionId, displayText) => selectFabricApiVersion(versionId || '', displayText),
  selectFabricApiDetailVersion: (event, el, versionId, displayText) => selectFabricApiDetailVersion(versionId || '', displayText),
  navigateToPage: (event, el, page) => navigateToPage(page),
});
