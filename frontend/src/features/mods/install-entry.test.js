// @vitest-environment jsdom
// install-entry.test.js — 模组详情页安装入口的选择、复制与保存路径确认
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCommandCalls, installTauriMock, mockCommand } from '../../test-utils/tauri-mock.js';

let entry;
let appState;
let modDetailState;
let installState;

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function toastTexts() {
  return [...document.querySelectorAll('#toast-container .toast')].map((el) => el.textContent);
}

function lastCommand(cmd) {
  return [...getCommandCalls()].reverse().find((call) => call.cmd === cmd);
}

beforeAll(async () => {
  installTauriMock();
  vi.resetModules();
  appState = (await import('../../core/app-state.js')).appState;
  modDetailState = (await import('./detail-state.js')).modDetailState;
  installState = (await import('./install-state.js')).S;
  entry = await import('./install-entry.js');
});

beforeEach(() => {
  installTauriMock();
  document.body.innerHTML = [
    '<div id="toast-container"></div>',
    '<div id="mod-browse-list"></div>',
    '<div id="md-version-list"></div>',
  ].join('');
  modDetailState.data = null;
  modDetailState.allVersions = [];
  appState.modSelectedIds.clear();
  appState.modSelectedVersions.clear();
  appState.currentModDetailId = '';
  appState.currentModDetailSource = '';
  installState._mdSaveGame = '';
  installState._mdSaveLoader = '';
});

describe('openModSourceUrl', () => {
  it('CurseForge 来源打开对应工程页', () => {
    modDetailState.data = { title: '示例模组' };
    appState.currentModDetailSource = 'curseforge';
    appState.currentModDetailId = '238222';
    entry.openModSourceUrl();
    expect(lastCommand('open_external').args.url).toBe(
      'https://www.curseforge.com/minecraft-mc-mods/238222',
    );
  });

  it('Modrinth 来源打开对应工程页', () => {
    modDetailState.data = { title: '示例模组' };
    appState.currentModDetailSource = 'modrinth';
    appState.currentModDetailId = 'jei';
    entry.openModSourceUrl();
    expect(lastCommand('open_external').args.url).toBe('https://modrinth.com/mod/jei');
  });

  it('未打开详情时不发起跳转', () => {
    entry.openModSourceUrl();
    expect(lastCommand('open_external')).toBeUndefined();
  });
});

describe('copyModName', () => {
  it('复制当前模组名称并提示', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    modDetailState.data = { title: '机械动力' };
    entry.copyModName();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith('机械动力');
    expect(toastTexts()).toContain('已复制名称');
  });

  it('未打开详情时不复制', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    entry.copyModName();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('addModFromDetail', () => {
  beforeEach(() => {
    modDetailState.allVersions = [
      { id: 'v1', gameVersions: ['1.20.1'], loaders: ['Fabric'] },
      { id: 'v2', gameVersions: ['1.19.2'], loaders: ['Forge'] },
    ];
  });

  it('首次添加时记录目标版本与加载器', () => {
    entry.addModFromDetail('proj', 'modrinth', b64('v1'), b64('file-1'));
    expect(appState.modSelectedIds.has('proj')).toBe(true);
    expect(appState.modSelectedVersions.get('proj')).toEqual({
      versionId: 'v1',
      fileId: 'file-1',
      source: 'modrinth',
      gameVersion: '1.20.1',
      loader: 'fabric',
    });
    expect(toastTexts()).toContain('已添加到下载列表');
  });

  it('重复选择同一文件时从选择中移除', () => {
    entry.addModFromDetail('proj', 'modrinth', b64('v1'), b64('file-1'));
    entry.addModFromDetail('proj', 'modrinth', b64('v1'), b64('file-1'));
    expect(appState.modSelectedIds.has('proj')).toBe(false);
    expect(appState.modSelectedVersions.has('proj')).toBe(false);
    expect(toastTexts()).toContain('已从选择中移除');
  });

  it('选择同工程另一版本时覆盖已选记录', () => {
    entry.addModFromDetail('proj', 'modrinth', b64('v1'), b64('file-1'));
    entry.addModFromDetail('proj', 'modrinth', b64('v2'), b64('file-2'));
    expect(appState.modSelectedVersions.get('proj')).toMatchObject({
      versionId: 'v2',
      fileId: 'file-2',
      gameVersion: '1.19.2',
      loader: 'forge',
    });
    expect(toastTexts()).toContain('已更新选择的版本');
  });

  it('版本列表中的按钮同步为已添加状态', () => {
    document.getElementById('md-version-list').innerHTML = `
      <div class="mdv-file-item" data-vid="${b64('v1')}">
        <button class="mdv-install-btn btn-primary">添加</button>
      </div>
      <button class="mdv-header-btn mdv-install-btn btn-primary" data-vid="${b64('v1')}">添加</button>`;
    entry.addModFromDetail('proj', 'modrinth', b64('v1'), b64('file-1'));
    const itemBtn = document.querySelector('.mdv-file-item .mdv-install-btn');
    const headerBtn = document.querySelector('.mdv-header-btn');
    expect(itemBtn.textContent).toBe('已添加');
    expect(itemBtn.classList.contains('btn-secondary')).toBe(true);
    expect(headerBtn.textContent).toBe('已添加');
    expect(headerBtn.classList.contains('btn-secondary')).toBe(true);
  });
});

describe('保存路径确认', () => {
  beforeEach(() => {
    mockCommand('get_default_mod_save_folder', {
      success: true,
      path: 'D:/mods',
      selectedCompatible: true,
    });
  });

  it('quickInstallCurrentMod 在用户取消文件夹选择时提示', async () => {
    mockCommand('select_folder', { cancelled: true });
    modDetailState.data = { id: 'proj', selectedVersionId: 'v1' };
    entry.quickInstallCurrentMod();
    await vi.waitFor(() => expect(toastTexts()).toContain('已取消选择'));
    expect(toastTexts()).toContain('请选择保存文件夹...');
  });

  it('installModFileSafe 从按钮数据解析版本后进入确认流程', async () => {
    mockCommand('select_folder', { cancelled: true });
    const btn = document.createElement('button');
    btn.dataset.vid = b64('v1');
    btn.dataset.fid = b64('file-1');
    entry.installModFileSafe(btn);
    await vi.waitFor(() => expect(toastTexts()).toContain('已取消选择'));
  });

  it('未打开详情时 quickInstallCurrentMod 不触发确认', () => {
    entry.quickInstallCurrentMod();
    expect(toastTexts()).toHaveLength(0);
    expect(lastCommand('select_folder')).toBeUndefined();
  });
});
