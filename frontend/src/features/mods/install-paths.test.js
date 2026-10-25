// @vitest-environment jsdom
// install-paths.test.js — 已安装版本匹配优先级单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let API;
let ensureInstalledVersions;
let matchInstalledVersion;
let appState;

beforeEach(async () => {
  vi.resetModules();
  ({ API } = await import('../../core/api.js'));
  ({ ensureInstalledVersions, matchInstalledVersion } = await import('./install-paths.js'));
  ({ appState } = await import('../../core/app-state.js'));
  appState.installedVersions = [];
  vi.restoreAllMocks();
});

afterEach(() => {
  appState.installedVersions = [];
  vi.restoreAllMocks();
});

const versions = [
  { id: '1.20.1', baseVersion: '1.20.1' },
  { id: '1.20.1-forge-47.2.0', baseVersion: '1.20.1', isForge: true },
  { id: '1.20.1-fabric-0.15.0', baseVersion: '1.20.1', isFabric: true },
  { id: '1.20.4-fabric-0.15.0', baseVersion: '1.20.4', isFabric: true },
];

describe('ensureInstalledVersions', () => {
  it('已有列表时直接返回，不重复请求', async () => {
    appState.installedVersions = [{ id: '1.20.1' }];
    const spy = vi.spyOn(API, 'getVersions');
    await expect(ensureInstalledVersions()).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('拉取后写入共享状态', async () => {
    vi.spyOn(API, 'getVersions').mockResolvedValue({
      installed: [{ id: '1.20.1' }],
      versions: [{ id: '1.21.1' }],
    });
    await expect(ensureInstalledVersions()).resolves.toBe(true);
    expect(appState.installedVersions).toEqual([{ id: '1.20.1' }]);
    expect(appState.allVersions).toEqual([{ id: '1.21.1' }]);
  });

  it('接口失败时返回 false 并保持空列表', async () => {
    vi.spyOn(API, 'getVersions').mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(ensureInstalledVersions()).resolves.toBe(false);
    expect(appState.installedVersions).toEqual([]);
  });
});

describe('matchInstalledVersion', () => {
  it('没有已安装版本时返回空串', () => {
    expect(matchInstalledVersion('1.20.1', 'fabric')).toBe('');
  });

  it('按加载器过滤后匹配游戏版本', () => {
    appState.installedVersions = versions;
    expect(matchInstalledVersion('1.20.1', 'forge')).toBe('1.20.1-forge-47.2.0');
    expect(matchInstalledVersion('1.20.1', 'fabric')).toBe('1.20.1-fabric-0.15.0');
  });

  it('quilt 使用 Fabric 实例', () => {
    appState.installedVersions = versions;
    expect(matchInstalledVersion('1.20.1', 'quilt')).toBe('1.20.1-fabric-0.15.0');
  });

  it('游戏版本未知时只按加载器匹配', () => {
    appState.installedVersions = versions;
    expect(matchInstalledVersion('', 'fabric')).toBe('1.20.1-fabric-0.15.0');
  });

  it('优先返回 id 以游戏版本开头的实例', () => {
    appState.installedVersions = [
      { id: 'custom-1.20.1', baseVersion: '1.20.1', isFabric: true },
      { id: '1.20.1-fabric-0.15.0', baseVersion: '1.20.1', isFabric: true },
    ];
    expect(matchInstalledVersion('1.20.1', 'fabric')).toBe('1.20.1-fabric-0.15.0');
  });

  it('加载器不匹配时返回空串', () => {
    appState.installedVersions = [versions[2]];
    expect(matchInstalledVersion('1.20.1', 'forge')).toBe('');
  });
});
