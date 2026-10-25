// @vitest-environment jsdom
// versions-install-cancel.test.js — 安装取消流程单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiCalls, installTauriMock, resetTauriMock } from '../../test-utils/tauri-mock.js';

let install;
let appState;

beforeEach(async () => {
  installTauriMock({
    apiRoutes: {
      '/api/install-cancel': { success: true },
    },
  });
  vi.resetModules();
  ({ appState } = await import('../../core/app-state.js'));
  appState.currentInstallSessionId = 'session-1';
  install = await import('./versions-install.js');
});

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  appState.currentInstallSessionId = null;
  vi.restoreAllMocks();
});

describe('closeInstallModal / cancelInstall', () => {
  it('关闭时取消进行中的安装并清空会话', () => {
    install.closeInstallModal();
    expect(appState.currentInstallSessionId).toBeNull();
    const call = getApiCalls().find((item) => item.path === '/api/install-cancel');
    expect(call).toBeDefined();
    expect(call.method).toBe('GET');
  });

  it('没有会话时不发起取消请求', () => {
    appState.currentInstallSessionId = null;
    install.cancelInstall();
    expect(getApiCalls().some((item) => item.path === '/api/install-cancel')).toBe(false);
  });
});
