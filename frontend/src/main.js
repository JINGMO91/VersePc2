// main.js — 前端模块入口
// 迁移期间：core 模块在此加载，并由 legacy/globals.js 暴露为旧脚本依赖的全局名。
import './legacy/globals.js';

export const buildMode = 'vite';
