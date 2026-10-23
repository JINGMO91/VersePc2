// legacy/globals.js — 前端迁移过渡层
// 只在这里把 core 模块暴露为旧脚本依赖的全局名；
// 所有 feature 模块迁移完成后删除本文件。
import * as utils from '../core/utils.js';
import * as apiModule from '../core/api.js';
import { bridge } from '../core/tauri-bridge.js';

// Tauri 桥接层兼容别名（旧脚本大量直接使用 window.bridge / window.electronAPI）
window.bridge = bridge;
window.electronAPI = bridge;
window.__TAURI_PROXY__ = { apiProxy: bridge.apiProxy };

// 业务 API 挂到统一通信面
bridge.api = apiModule.API;

// 工具函数与 API 辅助函数保持全局可用
for (const [name, value] of Object.entries(utils)) {
  window[name] = value;
}
for (const [name, value] of Object.entries(apiModule)) {
  window[name] = value;
}
