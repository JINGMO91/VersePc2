// @vitest-environment jsdom
// private-server-crud.test.js — 私服列表加载、保存、删除与状态检查单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTauriMock, resetTauriMock } from '../../test-utils/tauri-mock.js';

let api;
let store;
let S;

const SERVERS = [
  { id: 's1', name: '服务器一', address: 'mc.example.com:25565' },
  { id: 's2', name: '服务器二', address: 'mc2.example.com:25565' },
];

beforeEach(async () => {
  installTauriMock({
    commands: {
      private_server_list: () => ({ ok: true, servers: SERVERS.map((server) => ({ ...server })) }),
      private_server_save: () => ({ ok: true }),
      private_server_check: () => ({ online: true, latency: 30, playersOnline: 2, playersMax: 20, version: '1.20.1', motd: 'hi' }),
      private_server_copy_address: () => ({ ok: true }),
      private_server_icon: () => ({ ok: false }),
    },
  });
  vi.resetModules();
  store = await import('./private-server-state.js');
  S = store.S;
  api = await import('./private-server-list.js');
});

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('loadPrivateServers', () => {
  it('从桥接层读取服务器列表', async () => {
    await api.loadPrivateServers();
    expect(S.privateServerList).toEqual(SERVERS);
  });

  it('桥接层失败时清空列表', async () => {
    resetTauriMock();
    installTauriMock({ commands: { private_server_list: () => Promise.reject(new Error('offline')) } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await api.loadPrivateServers();
    expect(S.privateServerList).toEqual([]);
  });
});

describe('getPrivateServerById / deletePrivateServer', () => {
  beforeEach(async () => {
    await api.loadPrivateServers();
  });

  it('按 id 查找服务器', () => {
    expect(api.getPrivateServerById('s1').name).toBe('服务器一');
    expect(api.getPrivateServerById('missing')).toBeUndefined();
  });

  it('确认后删除并保存', async () => {
    vi.stubGlobal('confirm', () => true);
    await api.deletePrivateServer('s1');
    expect(S.privateServerList.map((s) => s.id)).toEqual(['s2']);
  });

  it('取消删除时保留列表', async () => {
    vi.stubGlobal('confirm', () => false);
    await api.deletePrivateServer('s1');
    expect(S.privateServerList).toHaveLength(2);
  });
});

describe('savePrivateServers / checkPrivateServerStatus', () => {
  it('保存成功返回 true', async () => {
    S.privateServerList = [...SERVERS];
    await expect(api.savePrivateServers()).resolves.toBe(true);
  });

  it('检查状态写入缓存', async () => {
    S.privateServerList = [...SERVERS];
    await api.checkPrivateServerStatus('s1');
    expect(S.privateServerCheckCache.s1).toMatchObject({
      online: true,
      latency: 30,
      playersOnline: 2,
      playersMax: 20,
      version: '1.20.1',
    });
  });

  it('服务器不存在时直接返回', async () => {
    S.privateServerCheckCache = {};
    await api.checkPrivateServerStatus('missing');
    expect(S.privateServerCheckCache.missing).toBeUndefined();
  });
});
