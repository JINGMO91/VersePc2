// dev-components-entry.js — 组件预览独立入口
// 只加载样式与预览页，不引入业务模块，避免 Tauri 桥接缺失导致的中断。
import './styles/tailwind.css';
import { createApp } from 'vue';
import PageComponents from './vue/pages/page-components.js';

createApp(PageComponents).mount('#preview');
