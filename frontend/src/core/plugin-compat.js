// plugin-compat.js — 插件运行时的公开接口层
// 已安装插件的模板与脚本按既有约定直接调用启动器提供的函数名。
// 模块化后这些函数不再自动挂到 window，此处集中补回，仅作为插件兼容接口。
import { showToast, showConfirmDialog } from '../features/misc/ui-components.js';
import { navigateToPage } from '../features/versions/versions.js';
import {
  initServerHostPage,
  _shDetach,
  _shShowProgress,
  serverHostRefreshVersions,
  serverHostDetectLoader,
  serverHostRefreshList,
  serverHostCreate,
  serverHostStart,
  serverHostStop,
  serverHostSendCommand,
  serverHostSyncMods,
  serverHostDelete,
  serverHostOpenFolder,
  _shClearConsole,
} from '../features/misc/server-host.js';

window.initServerHostPage = initServerHostPage;
window._shDetach = _shDetach;
window._shShowProgress = _shShowProgress;
window.serverHostRefreshVersions = serverHostRefreshVersions;
window.serverHostDetectLoader = serverHostDetectLoader;
window.serverHostRefreshList = serverHostRefreshList;
window.serverHostCreate = serverHostCreate;
window.serverHostStart = serverHostStart;
window.serverHostStop = serverHostStop;
window.serverHostSendCommand = serverHostSendCommand;
window.serverHostSyncMods = serverHostSyncMods;
window.serverHostDelete = serverHostDelete;
window.serverHostOpenFolder = serverHostOpenFolder;
window.serverHostClearConsole = _shClearConsole;
window.showToast = showToast;
window.showConfirmDialog = showConfirmDialog;
window.navigateToPage = navigateToPage;
