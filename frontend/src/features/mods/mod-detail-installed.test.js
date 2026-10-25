// @vitest-environment jsdom
// mod-detail-installed.test.js — 详情页已安装版本信息解析单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../core/api.js';
import { appState } from '../../core/app-state.js';
import { getInstalledVersionInfo } from './mod-detail-installed.js';

beforeEach(() => {
  appState.installedVersions = [];
  vi.restoreAllMocks();
  vi.spyOn(API, 'getVersions').mockResolvedValue({ versions: [], installed: [] });
});

afterEach(() => {
  appState.installedVersions = [];
  vi.restoreAllMocks();
});

describe('getInstalledVersionInfo', () => {
  it('未选择版本时返回空信息', async () => {
    vi.spyOn(API, 'getSettings').mockResolvedValue({});
    await expect(getInstalledVersionInfo()).resolves.toEqual({
      gameVersion: '',
      loaderType: '',
      versionId: '',
    });
  });

  it('从实例信息读取基础版本与加载器', async () => {
    appState.installedVersions = [
      { id: '1.20.1-fabric', baseVersion: '1.20.1', isFabric: true },
    ];
    vi.spyOn(API, 'getSettings').mockResolvedValue({ selectedVersion: '1.20.1-fabric' });
    await expect(getInstalledVersionInfo()).resolves.toEqual({
      gameVersion: '1.20.1',
      loaderType: 'fabric',
      versionId: '1.20.1-fabric',
    });
  });

  it('没有 baseVersion 时回退到 inheritsFrom', async () => {
    appState.installedVersions = [{ id: 'custom', inheritsFrom: '1.21.1', isForge: true }];
    vi.spyOn(API, 'getSettings').mockResolvedValue({ selectedVersion: 'custom' });
    await expect(getInstalledVersionInfo()).resolves.toEqual({
      gameVersion: '1.21.1',
      loaderType: 'forge',
      versionId: 'custom',
    });
  });

  it('找不到实例时从版本号前缀推断游戏版本', async () => {
    vi.spyOn(API, 'getSettings').mockResolvedValue({ selectedVersion: '1.20.4-custom' });
    await expect(getInstalledVersionInfo()).resolves.toEqual({
      gameVersion: '1.20.4',
      loaderType: '',
      versionId: '1.20.4-custom',
    });
  });

  it('设置读取失败时返回空信息', async () => {
    vi.spyOn(API, 'getSettings').mockRejectedValue(new Error('offline'));
    await expect(getInstalledVersionInfo()).resolves.toEqual({
      gameVersion: '',
      loaderType: '',
      versionId: '',
    });
  });
});
