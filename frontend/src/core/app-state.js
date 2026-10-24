// core/app-state.js — 应用级共享状态
// 所有模块通过 appState 显式读写，不再依赖 app.js 的隐式全局变量。
export const appState = {
  // 版本列表
  currentVersionTab: 'release',
  allVersions: [],
  installedVersions: [],
  versionIconsTimestamp: Date.now(),
  launchDepPollTimer: null,
  currentLaunchVersionId: '',
  quickPlayWorld: '',
  _cachedLastLaunchVersion: '',
  _launchCounted: false,
  javaInstallPollTimer: null,
  currentSettingsVersionId: null,

  // 自定义下拉框实例（跨模块共享）
  homeVersionCustomSelect: null,
  launchVersionCustomSelect: null,
  modloaderGameVersionCustomSelect: null,
  modloaderVersionCustomSelect: null,

  // 模组列表与搜索
  currentModTab: 'installed-mods',
  modSearchOffset: 0,
  modSearchTotal: 0,
  modSearchQuery: '',
  modSearchResults: [],
  _modDownloadVersionId: '',
  currentInstallSessionId: null,
  currentLoaderType: 'fabric',
  modMultiSelectMode: false,
  modSelectedIds: new Set(),
  modSelectedVersions: new Map(),

  // 模组详情
  currentModDetailId: null,
  currentModDetailSource: 'modrinth',
  modDetailHistory: [],
  modDetailVersions: [],
  modDownloadPollTimers: [],
  _isRestoringModDetail: false,

  // 收藏夹
  _favorites: [],
  _currentFavId: '',
  _favMultiSelectMode: false,
  _favSelectedItems: new Set(),
  _favSearchQuery: '',

  // 账户与启动
  msAuthPollInterval: null,
  gameLogEventSource: null,
  previousPage: null,
};
