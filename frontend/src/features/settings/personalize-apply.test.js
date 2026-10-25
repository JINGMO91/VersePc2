// @vitest-environment jsdom
// personalize-apply.test.js — 个性化设置的 DOM/存储副作用单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCommandCalls,
  installTauriMock,
  resetTauriMock,
} from '../../test-utils/tauri-mock.js';

let apply;

beforeEach(async () => {
  installTauriMock();
  vi.resetModules();
  apply = await import('./personalize-apply.js');
  document.body.className = '';
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('data-no-glass');
  document.documentElement.removeAttribute('data-liquid-glass');
});

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

function lastStoreSet() {
  return getCommandCalls()
    .filter((call) => call.cmd === 'store_set')
    .pop();
}

describe('导航宽度', () => {
  it('夹取到 64-160 并写入 CSS 变量与存储', () => {
    apply.applyNavWidthValue(300);
    expect(apply.getPersonalizeState().navWidth).toBe(160);
    expect(document.body.style.getPropertyValue('--classic-sidebar-width')).toBe('160px');
    expect(lastStoreSet().args).toEqual({ key: 'versepc_nav_width', value: 160 });

    apply.applyNavWidthValue(10);
    expect(apply.getPersonalizeState().navWidth).toBe(64);
  });

  it('非法值回退 80', () => {
    apply.applyNavWidthValue('abc');
    expect(apply.getPersonalizeState().navWidth).toBe(80);
  });
});

describe('导航栏名称', () => {
  it('简约模式下切换 show-nav-labels 类', () => {
    document.body.classList.add('minimal-nav');
    apply.applyHideNavLabelsValue(true);
    expect(document.body.classList.contains('show-nav-labels')).toBe(false);
    expect(apply.getPersonalizeState().hideNavLabels).toBe(true);
    expect(lastStoreSet().args).toEqual({ key: 'versepc_nav_hide_labels', value: '1' });

    apply.applyHideNavLabelsValue(false);
    expect(document.body.classList.contains('show-nav-labels')).toBe(true);
  });

  it('经典侧栏不挂 show-nav-labels 类', () => {
    apply.applyHideNavLabelsValue(false);
    expect(document.body.classList.contains('show-nav-labels')).toBe(false);
  });
});

describe('玻璃与窗口选项', () => {
  it('毛玻璃开关切换 data-no-glass', () => {
    apply.applyGlassEffectValue(false);
    expect(document.documentElement.hasAttribute('data-no-glass')).toBe(true);
    apply.applyGlassEffectValue(true);
    expect(document.documentElement.hasAttribute('data-no-glass')).toBe(false);
  });

  it('窗口记忆关闭时清理旧尺寸', () => {
    apply.applyRememberWindowSizeValue(false);
    expect(apply.getPersonalizeState().rememberWindowSize).toBe(false);
    const commands = getCommandCalls();
    expect(commands.some((call) => call.cmd === 'store_delete' && call.args.key === 'versepc_window_state')).toBe(true);
  });

  it('启动全屏状态写入共享状态', () => {
    apply.applyStartFullscreenValue(true);
    expect(apply.getPersonalizeState().startFullscreen).toBe(true);
    expect(lastStoreSet().args).toEqual({ key: 'versepc_window_start_fullscreen', value: '1' });
  });
});

describe('主题色变量', () => {
  it('深色与浅色主题写入不同 accent', () => {
    apply.applyThemeColors('dark');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ffffff');
    apply.applyThemeColors('light');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#1a1a1a');
  });
});
