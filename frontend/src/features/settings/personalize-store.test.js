// @vitest-environment jsdom
// personalize-store.test.js — 个性化设置加载与保存单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCommandCalls,
  installTauriMock,
  resetTauriMock,
} from '../../test-utils/tauri-mock.js';

let store;
let state;

const STORE_VALUES = {
  versepc_theme: 'dark',
  versepc_wallpaper: 'starry',
  versepc_glass_effect: '1',
  versepc_liquid_glass: '0',
  versepc_nav_width: '200',
  versepc_window_remember_size: '0',
  versepc_window_start_fullscreen: '1',
};

beforeEach(async () => {
  installTauriMock({
    commands: {
      store_get: ({ key }) => (key in STORE_VALUES ? STORE_VALUES[key] : null),
      store_set: true,
      store_delete: true,
    },
  });
  vi.resetModules();
  store = await import('./personalize-store.js');
  state = await import('./personalize-apply.js');
});

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('loadPersonalizeStateIntoStore', () => {
  it('读取单项键并归一化旧值与范围', async () => {
    await store.loadPersonalizeStateIntoStore();
    const st = state.getPersonalizeState();
    expect(st.theme).toBe('dark');
    expect(st.wallpaper).toBe('panorama');
    expect(st.glassEffect).toBe(true);
    expect(st.liquidGlass).toBe(false);
    expect(st.navWidth).toBe(160);
    expect(st.rememberWindowSize).toBe(false);
    expect(st.startFullscreen).toBe(true);
  });

  it('没有单项键时使用默认值', async () => {
    resetTauriMock();
    installTauriMock({ commands: { store_get: () => null, store_set: true, store_delete: true } });
    await store.loadPersonalizeStateIntoStore();
    const st = state.getPersonalizeState();
    expect(st.theme).toBe('light');
    expect(st.wallpaper).toBe('none');
    expect(st.navWidth).toBe(80);
    expect(st.rememberWindowSize).toBe(true);
  });
});

describe('savePersonalizeSettings', () => {
  it('写入单项键与兼容旧字段', async () => {
    const st = state.getPersonalizeState();
    st.theme = 'dark';
    st.wallpaper = 'panorama';
    st.glassEffect = true;
    st.hideNavLabels = true;
    st.navWidth = 120;

    await store.savePersonalizeSettings();

    const sets = getCommandCalls()
      .filter((call) => call.cmd === 'store_set')
      .map((call) => call.args);
    const values = Object.fromEntries(sets.map((item) => [item.key, item.value]));

    expect(values.versepc_theme).toBe('dark');
    expect(values.versepc_wallpaper).toBe('panorama');
    expect(values.versepc_glass_effect).toBe('1');
    expect(values.versepc_nav_hide_labels).toBe('1');
    expect(values.versepc_nav_width).toBe(120);
    expect(JSON.parse(values.versepc_personalize_settings)).toMatchObject({
      theme: 'dark',
      sidebarLabels: false,
    });
  });
});
