// accounts-state.js — 账户域共享可变状态
// 仅本域子模块读写，门面不重新声明状态。
export const accountsState = {
  accPollTimer: null,
  accDlSessionId: null,
  accDlPollTimer: null,
  _skinFigureCache: new Map(),
  _skinFigureQueue: Promise.resolve(),
  _skinCardObserver: null,
  _skinCardTasks: new WeakMap(),
  _avatarMemCache: new Map(),
  _accountsListInitialized: false,
  _carouselCards: [],
  _carouselCurrentIndex: 0,
  _carouselDrag: null,
  ADD_CARD_ID: '__ADD_ACCOUNT__',
  _currentDetailAccount: null,
  _skinViewer: null,
  _skinResizeObserver: null,
  _currentSkinBg: 'white',
  _applyingMsSkin: false,
  tpPendingAuth: null,
};

// 供跨域读取当前详情账户（避免外部模块直接依赖可变状态对象）
export function getCurrentDetailAccount() {
  return accountsState._currentDetailAccount;
}
