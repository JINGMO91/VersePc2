// @vitest-environment jsdom
// java-mgr.test.js — Java 管理页列表渲染单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTauriMock, resetTauriMock } from '../../test-utils/tauri-mock.js';

let javaMgr;

async function loadJavaMgr(route) {
  installTauriMock({
    apiRoutes: { '/api/java/installed': route },
  });
  vi.resetModules();
  return import('./java-mgr.js');
}

beforeEach(() => {
  document.body.innerHTML = '<div id="installed-java-list"></div>';
});

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('loadInstalledJava', () => {
  it('渲染 Java 版本、来源与当前使用标记', async () => {
    javaMgr = await loadJavaMgr({
      java: [
        {
          path: 'C:/Java/jdk-17/bin/java.exe',
          version: '17.0.1',
          majorVersion: 17,
          source: 'bundled',
          isJdk: true,
          is64Bit: true,
        },
        {
          path: 'C:/Java/jre-8/bin/java.exe',
          version: '1.8.0_301',
          majorVersion: 8,
          source: 'manual',
          isJdk: false,
          is64Bit: false,
        },
      ],
      currentJavaPath: 'C:/Java/jdk-17/bin/java.exe',
      detecting: false,
    });

    await javaMgr.loadInstalledJava();

    const text = document.getElementById('installed-java-list').textContent;
    expect(text).toContain('Java 17 (17.0.1)');
    expect(text).toContain('内置');
    expect(text).toContain('JDK');
    expect(text).toContain('当前使用');
    expect(text).toContain('Java 8 (1.8.0_301)');
    expect(text).toContain('手动');
    expect(text).toContain('JRE');
  });

  it('空列表显示未检测到', async () => {
    javaMgr = await loadJavaMgr({ java: [], currentJavaPath: '', detecting: false });
    await javaMgr.loadInstalledJava();
    expect(document.getElementById('installed-java-list').textContent).toContain('未检测到已安装的Java');
  });

  it('检测中保持加载提示', async () => {
    vi.useFakeTimers();
    javaMgr = await loadJavaMgr({ java: [], currentJavaPath: '', detecting: true });
    await javaMgr.loadInstalledJava();
    expect(document.getElementById('installed-java-list').textContent).toContain('正在检测Java...');
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('接口失败显示检测失败', async () => {
    javaMgr = await loadJavaMgr(() => {
      throw new Error('offline');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await javaMgr.loadInstalledJava();
    expect(document.getElementById('installed-java-list').textContent).toContain('检测Java失败');
  });
});
