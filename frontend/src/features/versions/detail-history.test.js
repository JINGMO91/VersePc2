// @vitest-environment jsdom
// detail-history.test.js — 详情页返回栈单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../../core/app-state.js';
import { registerLazyLoader } from '../../core/lazy-loaders.js';
import { setNavigationHandler } from '../../core/navigation.js';
import { modDetailState } from '../mods/detail-state.js';
import { goBackFromDetail, pushModDetailHistory } from './versions-detail-history.js';

const modOpen = vi.fn();
const resourceOpen = vi.fn();
const navigate = vi.fn();

beforeEach(() => {
  appState.modDetailHistory = [];
  appState.previousPage = null;
  appState.currentModDetailId = null;
  appState.currentModDetailSource = 'modrinth';
  appState._isRestoringModDetail = false;
  modDetailState.type = 'mod';
  registerLazyLoader('mod:open-detail', modOpen);
  registerLazyLoader('resource:open-detail', resourceOpen);
  setNavigationHandler(navigate);
  document.body.innerHTML = '';
  modOpen.mockClear();
  resourceOpen.mockClear();
  navigate.mockClear();
});

afterEach(() => {
  setNavigationHandler(null);
});

describe('goBackFromDetail', () => {
  it('有历史时弹出并打开上一个模组详情', () => {
    appState.modDetailHistory = [{ id: 'prev-mod', source: 'modrinth', type: 'mod' }];
    goBackFromDetail();
    expect(modOpen).toHaveBeenCalledWith('prev-mod', 'modrinth');
    expect(appState.modDetailHistory).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('资源类历史走资源详情加载器', () => {
    appState.modDetailHistory = [{ id: 'shader-1', source: 'curseforge', type: 'shader' }];
    goBackFromDetail();
    expect(resourceOpen).toHaveBeenCalledWith('shader-1', 'shader', 'curseforge');
  });

  it('没有历史时回到来源页', () => {
    appState.previousPage = 'mods';
    goBackFromDetail();
    expect(navigate).toHaveBeenCalledWith('mods');
  });
});

describe('pushModDetailHistory', () => {
  it('只在模组详情页时记录，并避免重复', () => {
    document.body.innerHTML = '<div class="page active" id="page-mod-detail"></div>';
    appState.currentModDetailId = 'sodium';
    appState.currentModDetailSource = 'modrinth';

    pushModDetailHistory();
    pushModDetailHistory();

    expect(appState.modDetailHistory).toEqual([
      { id: 'sodium', source: 'modrinth', type: 'mod' },
    ]);
  });

  it('恢复历史期间不记录', () => {
    document.body.innerHTML = '<div class="page active" id="page-mod-detail"></div>';
    appState.currentModDetailId = 'sodium';
    appState._isRestoringModDetail = true;
    pushModDetailHistory();
    expect(appState.modDetailHistory).toEqual([]);
  });

  it('不在模组详情页时不记录', () => {
    document.body.innerHTML = '<div class="page active" id="page-mods"></div>';
    appState.currentModDetailId = 'sodium';
    pushModDetailHistory();
    expect(appState.modDetailHistory).toEqual([]);
  });
});
