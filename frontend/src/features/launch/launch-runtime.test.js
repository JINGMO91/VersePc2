// @vitest-environment jsdom
// launch-runtime.test.js — 游戏实例列表与控制台日志单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { gameStore } from '../../core/game-store.js';
import { appendConsoleLine, updateGameInstanceList } from './launch-runtime.js';

beforeEach(() => {
  gameStore.instances = [];
  gameStore.running = false;
  document.body.innerHTML = '';
});

describe('updateGameInstanceList', () => {
  it('写入共享 store 并渲染实例卡片', () => {
    document.body.innerHTML = '<div id="game-instance-list"></div>';
    updateGameInstanceList([
      { sessionId: 's1', versionId: '1.20.1', pid: 100, startTime: Date.now() - 61_000, lanPort: 25565 },
    ]);

    expect(gameStore.running).toBe(true);
    expect(gameStore.instances).toHaveLength(1);
    const container = document.getElementById('game-instance-list');
    expect(container.style.display).toBe('flex');
    expect(container.textContent).toContain('1.20.1');
    expect(container.textContent).toContain('PID: 100');
    expect(container.textContent).toContain('LAN:25565');
    expect(container.querySelector('[data-action="stopGameInstance"]')).not.toBeNull();
  });

  it('空列表清空并隐藏容器', () => {
    document.body.innerHTML = '<div id="game-instance-list" style="display:flex">old</div>';
    updateGameInstanceList([]);
    expect(gameStore.running).toBe(false);
    expect(gameStore.instances).toEqual([]);
    expect(document.getElementById('game-instance-list').innerHTML).toBe('');
    expect(document.getElementById('game-instance-list').style.display).toBe('none');
  });

  it('没有兼容容器时仍更新 store', () => {
    updateGameInstanceList([{ sessionId: 's2', versionId: '1.21', pid: 1, startTime: Date.now() }]);
    expect(gameStore.running).toBe(true);
  });
});

describe('appendConsoleLine', () => {
  it('追加带类型的日志行并限制最大行数', () => {
    document.body.innerHTML = '<div id="console-output"></div>';
    appendConsoleLine('hello', 'info');
    const output = document.getElementById('console-output');
    expect(output.textContent).toContain('hello');
    expect(output.querySelector('.console-line.info')).not.toBeNull();

    for (let i = 0; i < 510; i++) appendConsoleLine(`line ${i}`);
    expect(output.children.length).toBe(500);
  });

  it('没有日志容器时静默返回', () => {
    expect(() => appendConsoleLine('x')).not.toThrow();
  });
});
