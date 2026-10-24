// translate-modal-tabs.js — 汉化弹窗页签切换
// 弹窗模板在启动时注入，页签动作必须同步注册，不能依赖懒加载的版本设置模块。
import { registerActions } from '../../core/actions.js';

export function switchTranslateTab(tab) {
  const tabs = document.querySelectorAll('.mod-translate-tab');
  if (!tabs.length) return;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  ['quick', 'auto', 'manual'].forEach((name) => {
    const panel = document.getElementById(`mod-translate-tab-${name}`);
    if (panel) panel.style.display = tab === name ? '' : 'none';
  });
}

registerActions({
  switchTranslateTab: (event, el, tab) => switchTranslateTab(tab),
});
