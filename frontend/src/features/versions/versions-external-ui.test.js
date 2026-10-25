// @vitest-environment jsdom
// versions-external-ui.test.js — 外部版本目录选择器单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../../core/app-state.js';
import { installTauriMock, resetTauriMock } from '../../test-utils/tauri-mock.js';

let external;
let versionsState;

async function loadExternal(routes = {}) {
  installTauriMock({
    apiRoutes: {
      '/api/version/list-folders': {
        folders: [
          { name: '外部目录', path: 'D:/ext', versionCount: 2 },
          { name: '另一个目录', path: 'E:/ext' },
        ],
      },
      '/api/versions': { versions: [], installed: [] },
      ...routes,
    },
  });
  vi.resetModules();
  ({ versionsState } = await import('./versions-state.js'));
  return import('./versions-external.js');
}

beforeEach(() => {
  document.body.innerHTML = '<select id="folder-selector"></select><div id="installed-versions-list"></div>';
  localStorage.clear();
  appState.installedVersions = [];
});

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('populateFolderSelector', () => {
  it('填充内置与外部目录选项', async () => {
    external = await loadExternal();
    await external.populateFolderSelector();
    const select = document.getElementById('folder-selector');
    expect(select.options.length).toBe(3);
    expect(select.options[0].value).toBe('__internal');
    expect(select.textContent).toContain('外部目录 (2)');
    expect(select.textContent).toContain('另一个目录');
  });

  it('读取已保存的选择', async () => {
    localStorage.setItem('versepc_selected_folder', 'D:/ext');
    external = await loadExternal();
    await external.populateFolderSelector();
    expect(document.getElementById('folder-selector').value).toBe('D:/ext');
  });

  it('没有选择器时静默返回', async () => {
    document.body.innerHTML = '';
    external = await loadExternal();
    await expect(external.populateFolderSelector()).resolves.toBeUndefined();
  });
});

describe('onFolderSelectorChange', () => {
  it('切换目录后持久化并重新渲染列表', async () => {
    external = await loadExternal();
    const select = document.getElementById('folder-selector');
    select.innerHTML = '<option value="D:/ext">外部</option>';
    select.value = 'D:/ext';

    external.onFolderSelectorChange();

    expect(versionsState._selectedFolder).toBe('D:/ext');
    expect(localStorage.getItem('versepc_selected_folder')).toBe('D:/ext');
    expect(document.getElementById('installed-versions-list').textContent).toContain('该文件夹下暂无版本');
  });
});
