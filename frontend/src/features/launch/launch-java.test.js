// @vitest-environment jsdom
// launch-java.test.js — Java 检测与 CDS 归档状态单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTauriMock, resetTauriMock } from '../../test-utils/tauri-mock.js';

let javaMod;

function mountJava() {
  document.body.innerHTML = `
    <div id="java-detect-result"></div>
    <input id="setting-java-path" />
    <div id="stat-java"></div>
    <select id="launch-version-select"><option value="">未选择</option><option value="1.20.1">1.20.1</option></select>
    <div id="cds-status-text"></div>
  `;
}

async function loadJava(routes = {}, commands = {}) {
  installTauriMock({
    apiRoutes: {
      '/api/java/detect': {
        javaList: [
          { path: 'C:/jdk-8/bin/java.exe', version: '1.8.0_301', majorVersion: 8, is64Bit: false },
          { path: 'C:/jdk-17/bin/java.exe', version: '17.0.1', majorVersion: 17, is64Bit: true },
        ],
      },
      '/api/jvm/generate-cds': { success: true, sizeKB: 128 },
      '/api/jvm/cds-status': { available: true, sizeKB: 64 },
      ...routes,
    },
    commands,
  });
  vi.resetModules();
  return import('./launch-java.js');
}

beforeEach(() => {
  mountJava();
});

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('detectJava', () => {
  it('优先选择 Java 17 以上并写入输入框与统计', async () => {
    javaMod = await loadJava();
    await javaMod.detectJava();
    expect(document.getElementById('setting-java-path').value).toBe('C:/jdk-17/bin/java.exe');
    expect(document.getElementById('java-detect-result').textContent).toContain('找到 Java 17.0.1');
    expect(document.getElementById('stat-java').textContent).toBe('17');
  });

  it('没有 Java 时提示手动配置', async () => {
    javaMod = await loadJava({ '/api/java/detect': { javaList: [] } });
    await javaMod.detectJava();
    expect(document.getElementById('java-detect-result').textContent).toContain('未检测到Java');
  });

  it('接口失败显示检测失败', async () => {
    javaMod = await loadJava({
      '/api/java/detect': () => {
        throw new Error('offline');
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await javaMod.detectJava();
    expect(document.getElementById('java-detect-result').textContent).toBe('检测失败');
  });
});

describe('checkJavaOnStartup', () => {
  it('只更新统计数字', async () => {
    javaMod = await loadJava();
    await javaMod.checkJavaOnStartup();
    expect(document.getElementById('stat-java').textContent).toBe('17');
  });

  it('失败时静默处理', async () => {
    javaMod = await loadJava({
      '/api/java/detect': () => {
        throw new Error('offline');
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(javaMod.checkJavaOnStartup()).resolves.toBeUndefined();
  });
});

describe('CDS 归档', () => {
  it('未选择版本时提示', async () => {
    javaMod = await loadJava();
    await javaMod.generateCdsArchive();
    expect(document.getElementById('cds-status-text').textContent).toBe('');
  });

  it('生成成功写入状态', async () => {
    javaMod = await loadJava();
    document.getElementById('launch-version-select').value = '1.20.1';
    await javaMod.generateCdsArchive();
    expect(document.getElementById('cds-status-text').textContent).toContain('已生成');
  });

  it('生成失败写入失败状态', async () => {
    javaMod = await loadJava({ '/api/jvm/generate-cds': { success: false, error: '失败' } });
    document.getElementById('launch-version-select').value = '1.20.1';
    await javaMod.generateCdsArchive();
    expect(document.getElementById('cds-status-text').textContent).toContain('生成失败');
  });

  it('归档状态查询', async () => {
    javaMod = await loadJava();
    document.getElementById('launch-version-select').value = '1.20.1';
    await javaMod.checkCdsStatus();
    expect(document.getElementById('cds-status-text').textContent).toContain('归档已就绪');

    javaMod = await loadJava({ '/api/jvm/cds-status': { available: false } });
    document.getElementById('launch-version-select').value = '1.20.1';
    await javaMod.checkCdsStatus();
    expect(document.getElementById('cds-status-text').textContent).toBe('未生成归档');
  });
});
