// @vitest-environment jsdom
// core/plugin-compat.test.js — 插件兼容接口层单元测试
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { serverHostCreate, clearConsole, showToast, showConfirmDialog } = vi.hoisted(() => ({
  serverHostCreate: vi.fn(async (...args) => ({ args })),
  clearConsole: vi.fn(async () => 'cleared'),
  showToast: vi.fn(),
  showConfirmDialog: vi.fn(),
}));

vi.mock('../features/misc/server-host.js', () => ({
  initServerHostPage: vi.fn(),
  _shDetach: vi.fn(),
  _shShowProgress: vi.fn(),
  serverHostRefreshVersions: vi.fn(),
  serverHostDetectLoader: vi.fn(),
  serverHostRefreshList: vi.fn(),
  serverHostCreate,
  serverHostStart: vi.fn(),
  serverHostStop: vi.fn(),
  serverHostSendCommand: vi.fn(),
  serverHostSyncMods: vi.fn(),
  serverHostDelete: vi.fn(),
  serverHostOpenFolder: vi.fn(),
  _shClearConsole: clearConsole,
}));

vi.mock('../features/misc/ui-components.js', () => ({ showToast, showConfirmDialog }));

let navigation;

beforeAll(async () => {
  vi.resetModules();
  navigation = await import('./navigation.js');
  await import('./plugin-compat.js');
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  for (const key of [
    'showToast',
    'showConfirmDialog',
    'navigateToPage',
    'serverHostCreate',
    'initServerHostPage',
    'serverHostClearConsole',
  ]) {
    delete window[key];
  }
});

describe('plugin-compat', () => {
  it('暴露全局提示与导航函数', async () => {
    expect(window.showToast).toBe(showToast);
    expect(window.showConfirmDialog).toBe(showConfirmDialog);
    expect(window.navigateToPage).toBe(navigation.navigateToPage);
  });

  it('开服接口按需加载并透传参数', async () => {
    const result = await window.serverHostCreate('1.20.1', '新服');

    expect(serverHostCreate).toHaveBeenCalledWith('1.20.1', '新服');
    expect(result).toEqual({ args: ['1.20.1', '新服'] });
  });

  it('清空控制台走独立的兼容入口', async () => {
    await expect(window.serverHostClearConsole()).resolves.toBe('cleared');
    expect(clearConsole).toHaveBeenCalled();
  });

  it('多个开服接口均暴露为函数', () => {
    expect(typeof window.initServerHostPage).toBe('function');
    expect(typeof window.serverHostStart).toBe('function');
    expect(typeof window.serverHostSyncMods).toBe('function');
  });
});
