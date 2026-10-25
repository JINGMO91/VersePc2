// @vitest-environment jsdom
// versions-list-render.test.js — 已安装版本列表渲染与卡片样式开关单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../../core/app-state.js';
import { versionsState as S } from './versions-state.js';
import { renderInstalledVersionsInto, toggleVersionCardStyle } from './versions-list.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  appState.installedVersions = [];
  appState.currentLaunchVersionId = '';
  // 空映射阻止卡片模式发起横幅网络请求
  S._versionBannerMap = {};
  S._versionBannerLoading = false;
});

afterEach(() => {
  localStorage.clear();
  appState.installedVersions = [];
  vi.restoreAllMocks();
});

describe('renderInstalledVersionsInto', () => {
  it('空列表显示空态提示', () => {
    const container = document.createElement('div');
    renderInstalledVersionsInto(container);
    expect(container.textContent).toContain('该文件夹下暂无版本');
  });

  it('列表模式渲染模组版、原版与错误版本', () => {
    localStorage.setItem('versepc_version_card_style', 'list');
    appState.installedVersions = [
      { id: '1.20.1', baseVersion: '1.20.1', releaseTime: '2023-06-12T00:00:00Z' },
      { id: '1.20.1-forge', baseVersion: '1.20.1', isForge: true, releaseTime: '2023-06-12T00:00:00Z' },
      { id: 'broken', error: true, errorReason: '缺少 JSON' },
    ];
    const container = document.createElement('div');
    renderInstalledVersionsInto(container);

    expect(container.textContent).toContain('1.20.1');
    expect(container.textContent).toContain('1.20.1-forge');
    expect(container.textContent).toContain('错误的版本');
    expect(container.textContent).toContain('缺少 JSON');
    expect(container.querySelectorAll('.version-item-clickable').length).toBe(2);
  });

  it('内置目录过滤掉外部版本', () => {
    localStorage.setItem('versepc_version_card_style', 'list');
    appState.installedVersions = [
      { id: '1.20.1', releaseTime: '' },
      { id: '1.21.1 [外部1]', isExternal: true, externalPath: 'D:/ext', releaseTime: '' },
    ];
    const container = document.createElement('div');
    renderInstalledVersionsInto(container);
    expect(container.textContent).toContain('1.20.1');
    expect(container.textContent).not.toContain('[外部1]');
  });
});

describe('toggleVersionCardStyle', () => {
  it('在卡片与列表之间切换并持久化', () => {
    localStorage.setItem('versepc_version_card_style', 'list');
    const container = document.createElement('div');
    container.id = 'installed-versions-list';
    document.body.innerHTML = '<div class="page active" id="page-installed-versions"></div>';
    document.body.appendChild(container);
    localStorage.setItem('versepc_version_card_style', 'card');

    toggleVersionCardStyle();
    expect(localStorage.getItem('versepc_version_card_style')).toBe('list');

    toggleVersionCardStyle();
    expect(localStorage.getItem('versepc_version_card_style')).toBe('card');
  });
});
