// launch-state.js — 模块共享可变状态
// 仅本域子模块读写，门面不重新声明状态。
export const S = {
  launching: false,
  launchDlPollInterval: null,
  gameLogUnlisten: null,
  gameExitUnlisten: null,
  _gameStatusTimer: null,
  _gameWasRunning: false,
  _gameStatusErrorCount: 0,
  MAX_STATUS_ERRORS: 5,
  LAUNCH_STEP_PROGRESS: { 'auth': 5, 'java-check': 15, 'version-resolve': 25, 'files-check': 40, 'natives-extract': 55, 'assets-check': 65, 'download': 75, 'build-args': 85, 'launching': 95 },
};
