// @vitest-environment jsdom
// vset-open.test.js — 版本设置页签切换单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../../core/app-state.js';
import { S } from './vset-state.js';
import { switchVSetTab } from './vset-open.js';

function mountVset() {
  document.body.innerHTML = `
    <button class="vset-nav-item" data-tab="settings"></button>
    <button class="vset-nav-item" data-tab="modmgr"></button>
    <div class="vset-panel active" id="vset-panel-settings"></div>
    <div class="vset-panel" id="vset-panel-modmgr">
      <div class="modmgr-header-row"></div>
      <div class="modmgr-actions"></div>
      <div id="modmgr-mod-list"></div>
    </div>
  `;
}

beforeEach(() => {
  mountVset();
  appState.currentSettingsVersionId = '1.20.1';
  S._modMgrSettingsLoaded = true;
});

describe('switchVSetTab', () => {
  it('切换页签与面板 active 状态', () => {
    switchVSetTab('settings');
    expect(document.querySelector('.vset-nav-item[data-tab="settings"]').classList.contains('active')).toBe(true);
    expect(document.getElementById('vset-panel-settings').classList.contains('active')).toBe(true);
    expect(document.getElementById('vset-panel-modmgr').classList.contains('active')).toBe(false);
  });

  it('原版版本在模组页显示不支持提示', () => {
    appState.installedVersions = [{ id: '1.20.1' }];
    switchVSetTab('modmgr');
    expect(document.getElementById('modmgr-mod-list').textContent).toContain('原版不支持安装模组');
    expect(document.querySelector('.modmgr-header-row').style.display).toBe('none');
    expect(document.querySelector('.modmgr-actions').style.display).toBe('none');
  });

  it('模组版本恢复模组管理控件', () => {
    appState.installedVersions = [{ id: '1.20.1', isFabric: true }];
    switchVSetTab('modmgr');
    expect(document.querySelector('.modmgr-header-row').style.display).toBe('');
    expect(document.querySelector('.modmgr-actions').style.display).toBe('');
  });

  it('面板不存在时静默返回', () => {
    expect(() => switchVSetTab('missing')).not.toThrow();
  });
});
