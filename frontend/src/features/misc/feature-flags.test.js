// @vitest-environment jsdom
// feature-flags.test.js — 功能开关与合规提示页单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { VERSE_FEATURES, showLegalNotice } from './feature-flags.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('功能开关', () => {
  it('默认开放版本下载与联机', () => {
    expect(VERSE_FEATURES.versionDownload).toBe(true);
    expect(VERSE_FEATURES.lan).toBe(true);
  });
});

describe('showLegalNotice', () => {
  it('切走当前页并激活提示页与对应导航按钮', () => {
    document.body.innerHTML = `
      <div class="page active" id="page-home"></div>
      <div class="page" id="page-legal-notice"></div>
      <button class="nav-btn active" data-page="home"></button>
      <div class="nav-submenu-group"><button class="nav-sub-btn" data-page="versions"></button></div>
    `;

    showLegalNotice('versions');

    expect(document.getElementById('page-home').classList.contains('active')).toBe(false);
    expect(document.getElementById('page-legal-notice').classList.contains('active')).toBe(true);
    const nav = document.querySelector('.nav-sub-btn[data-page="versions"]');
    expect(nav.classList.contains('active')).toBe(true);
    expect(nav.closest('.nav-submenu-group').classList.contains('open')).toBe(true);
    expect(document.querySelector('.nav-btn[data-page="home"]').classList.contains('active')).toBe(false);
  });

  it('提示页不存在时静默返回', () => {
    expect(() => showLegalNotice('versions')).not.toThrow();
  });
});
