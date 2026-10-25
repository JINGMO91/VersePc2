// @vitest-environment jsdom
// translate-modal-tabs.test.js — 汉化弹窗页签切换单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { switchTranslateTab } from './translate-modal-tabs.js';

beforeEach(() => {
  document.body.innerHTML = `
    <div class="mod-translate-tab active" data-tab="quick"></div>
    <div class="mod-translate-tab" data-tab="auto"></div>
    <div class="mod-translate-tab" data-tab="manual"></div>
    <div id="mod-translate-tab-quick"></div>
    <div id="mod-translate-tab-auto" style="display:none"></div>
    <div id="mod-translate-tab-manual" style="display:none"></div>
  `;
});

describe('switchTranslateTab', () => {
  it('切换 active 页签并显示对应面板', () => {
    switchTranslateTab('auto');
    expect(document.querySelector('.mod-translate-tab[data-tab="quick"]').classList.contains('active')).toBe(false);
    expect(document.querySelector('.mod-translate-tab[data-tab="auto"]').classList.contains('active')).toBe(true);
    expect(document.getElementById('mod-translate-tab-auto').style.display).toBe('');
    expect(document.getElementById('mod-translate-tab-quick').style.display).toBe('none');
  });

  it('切回手写页签', () => {
    switchTranslateTab('manual');
    expect(document.getElementById('mod-translate-tab-manual').style.display).toBe('');
    expect(document.getElementById('mod-translate-tab-auto').style.display).toBe('none');
  });

  it('页签不存在时静默返回', () => {
    document.body.innerHTML = '';
    expect(() => switchTranslateTab('auto')).not.toThrow();
  });
});
