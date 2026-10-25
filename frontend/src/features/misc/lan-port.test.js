// @vitest-environment jsdom
// lan-port.test.js — 局域网端口探测单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../core/api.js';
import { bridge } from '../../core/tauri-bridge.js';
import { detectLanPort } from './lan-port.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  delete bridge.redstoneOnline;
  vi.restoreAllMocks();
});

describe('detectLanPort', () => {
  it('游戏运行中优先返回运行时端口', async () => {
    vi.spyOn(API, 'getGameStatus').mockResolvedValue({ running: true, lanPort: 25565 });
    await expect(detectLanPort()).resolves.toBe(25565);
  });

  it('游戏未运行时回退到红石端口扫描', async () => {
    vi.spyOn(API, 'getGameStatus').mockResolvedValue({ running: false });
    bridge.redstoneOnline = { scanPort: vi.fn().mockResolvedValue({ ok: true, port: 25566 }) };
    await expect(detectLanPort()).resolves.toBe(25566);
  });

  it('所有来源失败时返回 null', async () => {
    vi.spyOn(API, 'getGameStatus').mockRejectedValue(new Error('offline'));
    await expect(detectLanPort()).resolves.toBeNull();
  });
});
