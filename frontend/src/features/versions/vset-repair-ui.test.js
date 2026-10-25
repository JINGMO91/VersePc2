// @vitest-environment jsdom
// vset-repair-ui.test.js — 修复弹窗与诊断结果弹窗单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTauriMock, resetTauriMock } from '../../test-utils/tauri-mock.js';

let repair;
let S;

async function loadRepair(routes = {}) {
  installTauriMock({
    apiRoutes: {
      '/api/version/repair-cancel': { success: true },
      '/api/version/diagnose': {
        issues: [
          { type: 'critical', message: '客户端 JAR 缺失', solution: '点击文件修复' },
          { type: 'warning', message: '库文件损坏', solution: '重新下载' },
        ],
      },
      ...routes,
    },
  });
  vi.resetModules();
  ({ S } = await import('./vset-state.js'));
  const { appState } = await import('../../core/app-state.js');
  appState.currentSettingsVersionId = '1.20.1';
  return import('./vset-repair.js');
}

function mountRepair() {
  document.body.innerHTML = `
    <div id="repair-modal" style="display:none">
      <div id="repair-modal-title"></div>
      <div id="repair-progress-fill"></div>
      <div id="repair-stage"></div>
      <div id="repair-percent"></div>
      <div id="repair-message"></div>
      <div id="repair-file-count"></div>
      <button id="repair-cancel-btn"></button>
    </div>
  `;
}

beforeEach(() => {
  mountRepair();
  vi.useFakeTimers();
});

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('修复弹窗', () => {
  it('打开时重置进度与状态', () => {
    return loadRepair().then((mod) => {
      repair = mod;
      repair.showRepairModal('1.20.1');
      expect(document.getElementById('repair-modal-title').textContent).toBe('文件修复 - 1.20.1');
      expect(document.getElementById('repair-progress-fill').style.width).toBe('0%');
      expect(document.getElementById('repair-stage').textContent).toBe('准备中...');
      expect(document.getElementById('repair-modal').style.display).toBe('flex');
    });
  });

  it('关闭时清理会话与定时器', async () => {
    repair = await loadRepair();
    S.currentRepairSessionId = 's1';
    S.repairPollTimer = setTimeout(() => {}, 1000);
    repair.closeRepairModal();
    expect(S.currentRepairSessionId).toBeNull();
    expect(S.repairPollTimer).toBeNull();
    expect(document.getElementById('repair-modal').style.display).toBe('none');
  });

  it('取消修复调用接口并更新状态', async () => {
    repair = await loadRepair();
    S.currentRepairSessionId = 's1';
    repair.cancelRepair();
    expect(document.getElementById('repair-stage').textContent).toBe('修复已取消');
    expect(document.getElementById('repair-cancel-btn').style.display).toBe('none');
    vi.advanceTimersByTime(1500);
    expect(document.getElementById('repair-modal').style.display).toBe('none');
  });
});

describe('诊断结果', () => {
  it('渲染问题列表并支持关闭', async () => {
    repair = await loadRepair();
    repair.showDiagnoseDialog({
      issues: [
        { type: 'critical', message: 'JAR 缺失', solution: '修复文件' },
        { type: 'info', message: '版本可更新', solution: '前往下载' },
      ],
    });
    const overlay = document.querySelector('.modal');
    expect(overlay.textContent).toContain('版本诊断结果');
    expect(overlay.textContent).toContain('JAR 缺失');
    expect(overlay.textContent).toContain('严重');
    expect(overlay.textContent).toContain('版本可更新');
    overlay.querySelector('.diagnose-close').click();
    vi.advanceTimersByTime(200);
    expect(document.querySelector('.modal')).toBeNull();
  });

  it('诊断成功展示弹窗', async () => {
    repair = await loadRepair();
    await repair.diagnoseVersion();
    expect(document.body.textContent).toContain('客户端 JAR 缺失');
    expect(document.body.textContent).toContain('库文件损坏');
  });

  it('诊断失败只提示不弹窗', async () => {
    repair = await loadRepair({
      '/api/version/diagnose': () => {
        throw new Error('offline');
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await repair.diagnoseVersion();
    expect(document.querySelector('.modal')).toBeNull();
  });

  it('未选择版本时直接返回', async () => {
    repair = await loadRepair();
    const { appState } = await import('../../core/app-state.js');
    appState.currentSettingsVersionId = null;
    await repair.diagnoseVersion();
    expect(document.querySelector('.modal')).toBeNull();
  });
});
