// init-setup-state.js — 模块共享可变状态
// 仅本域子模块读写，门面不重新声明状态。
export const S = {
  initSubTiming: null,
};
