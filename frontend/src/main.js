// main.js — 前端模块入口
// 1. legacy/globals.js 先安装 core 全局别名；
// 2. features/registry.js 按原 index.html 顺序导入功能模块；
// 3. 尚未迁移的 app.js / Vue 页面仍由 index.html 以 classic script 加载。
import './legacy/globals.js';
import './features/registry.js';
import './vue/mount.js';

export const buildMode = 'vite';
