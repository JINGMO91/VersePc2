// game-store.test.js — 游戏运行状态共享 store 与时钟生命周期单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameStore, startGameClock, stopGameClock } from './game-store.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  stopGameClock();
  gameStore.now = 0;
  gameStore.instances = [];
  gameStore.running = false;
});

afterEach(() => {
  stopGameClock();
  vi.useRealTimers();
});

describe('gameStore', () => {
  it('保存实例列表与运行标记', () => {
    gameStore.instances = [{ id: '1.20.1' }];
    gameStore.running = true;
    expect(gameStore.instances).toHaveLength(1);
    expect(gameStore.running).toBe(true);
  });
});

describe('game clock', () => {
  it('启动后每秒刷新，重复启动不会创建多个定时器', () => {
    startGameClock();
    startGameClock();
    vi.advanceTimersByTime(3000);
    expect(gameStore.now).toBe(3000);
  });

  it('停止后不再更新，可安全重复停止', () => {
    startGameClock();
    vi.advanceTimersByTime(1000);
    stopGameClock();
    stopGameClock();
    vi.advanceTimersByTime(5000);
    expect(gameStore.now).toBe(1000);
  });
});
