// @vitest-environment jsdom
// home-stats.test.js — 首页统计刷新单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../../core/app-state.js';
import { updateHomeStats } from './home-stats.js';

beforeEach(() => {
  document.body.innerHTML = '';
  appState.installedVersions = [];
});

describe('updateHomeStats', () => {
  it('把已安装版本数写入统计节点', () => {
    document.body.innerHTML = '<span id="stat-installed"></span>';
    appState.installedVersions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    updateHomeStats();
    expect(document.getElementById('stat-installed').textContent).toBe('3');
  });

  it('节点不存在时静默返回', () => {
    expect(() => updateHomeStats()).not.toThrow();
  });
});
