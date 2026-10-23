// core/store.js — 设置存储薄封装
// 统一走 Tauri 桥接层，供后续 feature 模块替换散落的 electronAPI.store 调用。
export const store = {
  get: (key) => window.electronAPI.store.get(key),
  set: (key, value) => window.electronAPI.store.set(key, value),
  delete: (key) => window.electronAPI.store.delete(key),
};
