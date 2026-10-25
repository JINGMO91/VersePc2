// @vitest-environment jsdom
// accounts-skin-utils.test.js — 皮肤背景切换单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { accountsState } from './accounts-state.js';
import { setSkinBg } from './accounts-skin-utils.js';

beforeEach(() => {
  document.body.innerHTML = '';
  accountsState._skinViewer = null;
  accountsState._currentSkinBg = 'white';
});

describe('setSkinBg', () => {
  it('记录颜色并更新详情背景与按钮状态', () => {
    document.body.innerHTML = `
      <div id="acct-detail-left" class="bg-black"></div>
      <button class="acct-bg-btn active" data-bg="white"></button>
      <button class="acct-bg-btn" data-bg="black"></button>
    `;
    setSkinBg('white');
    expect(accountsState._currentSkinBg).toBe('white');
    expect(document.getElementById('acct-detail-left').classList.contains('bg-black')).toBe(false);
    const buttons = [...document.querySelectorAll('.acct-bg-btn')];
    expect(buttons.find((b) => b.dataset.bg === 'white').classList.contains('active')).toBe(true);
    expect(buttons.find((b) => b.dataset.bg === 'black').classList.contains('active')).toBe(false);
  });

  it('黑色背景同步皮肤预览底色', () => {
    accountsState._skinViewer = { background: 0xffffff };
    setSkinBg('black');
    expect(accountsState._currentSkinBg).toBe('black');
    expect(accountsState._skinViewer.background).toBe(0x000000);
  });
});
