// plugin-compat.js — 插件运行时的公开接口层
// 已安装插件的模板与脚本按既有约定直接调用启动器提供的函数名。
// 模块化后这些函数不再自动挂到 window，此处集中补回，仅作为插件兼容接口。
import { showToast, showConfirmDialog } from '../features/misc/ui-components.js';
import { navigateToPage } from '../features/versions/versions-nav.js';

// 开服模块体积较大，兼容接口改为按需加载；调用签名不变，返回 Promise
const loadServerHost = () => import('../features/misc/server-host.js');

function exposeServerHost(name) {
  window[name] = (...args) => loadServerHost().then((m) => m[name](...args));
}

[
  'initServerHostPage',
  '_shDetach',
  '_shShowProgress',
  'serverHostRefreshVersions',
  'serverHostDetectLoader',
  'serverHostRefreshList',
  'serverHostCreate',
  'serverHostStart',
  'serverHostStop',
  'serverHostSendCommand',
  'serverHostSyncMods',
  'serverHostDelete',
  'serverHostOpenFolder',
].forEach(exposeServerHost);
window.serverHostClearConsole = (...args) => loadServerHost().then((m) => m._shClearConsole(...args));

window.showToast = showToast;
window.showConfirmDialog = showConfirmDialog;
window.navigateToPage = navigateToPage;
