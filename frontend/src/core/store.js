// core/store.js — 设置存储薄封装
// 统一走 Tauri 桥接层，供后续 feature 模块替换散落的 electronAPI.store 调用。
import { bridge } from './tauri-bridge.js';

export const store = {
  get: (key) => bridge.store.get(key),
  set: (key, value) => bridge.store.set(key, value),
  delete: (key) => bridge.store.delete(key),
};
