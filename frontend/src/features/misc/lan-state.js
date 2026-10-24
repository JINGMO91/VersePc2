// lan-state.js — 模块共享可变状态
// 仅本域子模块读写，门面不重新声明状态。
export const S = {
  terracottaGamePoll: null,
  redstoneGamePoll: null,
  enderlinkGamePoll: null,
  terracottaPollTimer: null,
  _terracottaPollRefresher: null,
  terracottaState: { mode: null, connected: false },
  _lastTerracottaStateIndex: -1,
  _terracottaPollFailCount: 0,
  _redstoneServers: [],
  _redstoneRunning: false,
  _redstoneServerIdx: 0,
  _enderlinkNodes: [],
  _enderlinkRunning: false,
  _enderlinkOpening: false,
  _enderlinkNodeIdx: 0,
};
