// @vitest-environment jsdom
// launch-status.test.js — 游戏运行状态轮询与 DOM 同步单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTauriMock, resetTauriMock } from '../../test-utils/tauri-mock.js';

let runtime;
let S;
let gameStore;

function mountStatus() {
  document.body.innerHTML = `
    <div id="status-indicator"></div>
    <div id="status-text"></div>
    <button id="launch-btn"><span>启动游戏</span></button>
    <div id="game-instance-list"></div>
  `;
}

async function loadRuntime(statusRoute) {
  installTauriMock({
    apiRoutes: {
      '/api/game/status': statusRoute,
      '/api/game/exit-analysis': { analysis: null },
    },
  });
  vi.resetModules();
  ({ S } = await import('./launch-state.js'));
  ({ gameStore } = await import('../../core/game-store.js'));
  return import('./launch-runtime.js');
}

beforeEach(() => {
  mountStatus();
  vi.useFakeTimers();
  if (gameStore) {
    gameStore.instances = [];
    gameStore.running = false;
  }
});

afterEach(() => {
  if (S?._gameStatusTimer) clearTimeout(S._gameStatusTimer);
  if (S) {
    S._gameStatusTimer = null;
    S._gameStatusErrorCount = 0;
    S._gameWasRunning = false;
  }
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('updateGameStatus', () => {
  it('运行中时同步状态、按钮与实例列表', async () => {
    runtime = await loadRuntime({
      running: true,
      instances: [{ sessionId: 's1', versionId: '1.20.1', pid: 10, startTime: Date.now() }],
    });

    await runtime.updateGameStatus();

    expect(document.getElementById('status-indicator').classList.contains('running')).toBe(true);
    expect(document.getElementById('status-text').textContent).toBe('游戏运行中');
    expect(document.getElementById('game-instance-list').textContent).toContain('1.20.1');
    expect(gameStore.running).toBe(true);
    expect(S._gameWasRunning).toBe(true);
  });

  it('多个实例显示数量', async () => {
    runtime = await loadRuntime({
      running: true,
      instances: [
        { sessionId: 's1', versionId: '1.20.1', pid: 10, startTime: Date.now() },
        { sessionId: 's2', versionId: '1.21.1', pid: 11, startTime: Date.now() },
      ],
    });
    await runtime.updateGameStatus();
    expect(document.getElementById('status-text').textContent).toBe('2 个游戏运行中');
  });

  it('未运行时恢复就绪状态并清空实例', async () => {
    runtime = await loadRuntime({ running: false, instances: [] });
    await runtime.updateGameStatus();
    expect(document.getElementById('status-indicator').classList.contains('running')).toBe(false);
    expect(document.getElementById('status-text').textContent).toBe('就绪');
    expect(gameStore.running).toBe(false);
    expect(S._gameStatusTimer).not.toBeNull();
  });

  it('接口失败累计错误次数并记录警告', async () => {
    runtime = await loadRuntime(() => {
      throw new Error('offline');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runtime.updateGameStatus();
    expect(S._gameStatusErrorCount).toBe(1);
    expect(S._gameStatusTimer).not.toBeNull();
  });
});
