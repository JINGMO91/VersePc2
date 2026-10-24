// dev-page-entry.js — 单页独立预览入口
// 只加载样式与目标页面组件，不引入主应用启动流程，避免 Tauri 桥接缺失导致的中断。
import './styles/tailwind.css';
import { createApp } from 'vue';

// 白名单方式列出可预览页面，避免动态拼接路径无法被构建工具静态分析
const PAGES = {
  feedback: () => import('./vue/pages/page-feedback.js'),
  'settings-other': () => import('./vue/pages/page-settings-other.js'),
  java: () => import('./vue/pages/page-java.js'),
  downloads: () => import('./vue/pages/page-downloads.js'),
  cloud: () => import('./vue/pages/page-cloud.js'),
  toolbox: () => import('./vue/pages/page-toolbox.js'),
};

const params = new URLSearchParams(location.search);
const name = params.get('p') || 'feedback';
const select = document.getElementById('vp-page');
if (select && PAGES[name]) select.value = name;

select?.addEventListener('change', () => {
  location.search = `?p=${select.value}`;
});

const stage = document.getElementById('stage');

async function render() {
  const loader = PAGES[name];
  if (!loader) {
    stage.innerHTML = `<div class="vp-error">未知页面：${name}</div>`;
    return;
  }
  try {
    const mod = await loader();
    createApp(mod.default || mod).mount(stage);
  } catch (e) {
    stage.innerHTML = `<div class="vp-error">页面渲染失败：${String(e && e.message ? e.message : e)}</div>`;
  }
}

render();
