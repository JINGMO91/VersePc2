// vue/dev-preview.js — 开发环境专用：组件基座预览页接入
// 只在 vite dev 下执行，生产构建不会包含该入口，也不会污染 index.html。
import { createApp } from 'vue';
import PageComponents from './pages/page-components.js';

function ensureNavButton() {
  if (document.querySelector('.nav-btn[data-page="components"]')) return;
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;
  const btn = document.createElement('button');
  btn.className = 'nav-btn';
  btn.setAttribute('data-page', 'components');
  btn.title = '组件预览';
  btn.innerHTML = '<span>组件</span>';
  nav.appendChild(btn);
}

function ensurePageContainer() {
  let el = document.getElementById('page-components');
  if (el) return el;
  const area = document.querySelector('.content-area');
  if (!area) return null;
  el = document.createElement('div');
  el.id = 'page-components';
  el.className = 'page';
  area.appendChild(el);
  return el;
}

export function mountDevPreview() {
  if (!import.meta.env.DEV) return;
  const el = ensurePageContainer();
  if (!el) return;
  ensureNavButton();
  createApp(PageComponents).mount(el);
}
