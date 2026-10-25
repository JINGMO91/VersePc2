// domain-state.test.js — 动态岛、私服与初始化状态默认值单元测试
import { describe, expect, it } from 'vitest';
import { S as dynamicIslandState } from './dynamic-island-state.js';
import { S as initSetupState } from '../launch/init-setup-state.js';
import { S as privateServerState } from './private-server-state.js';

describe('dynamic-island-state', () => {
  it('默认收起、空闲且没有任务', () => {
    expect(dynamicIslandState._expanded).toBe(false);
    expect(dynamicIslandState._visible).toBe(false);
    expect(dynamicIslandState._state).toBe('idle');
    expect(dynamicIslandState._tasks).toEqual({});
    expect(dynamicIslandState._dialogHistory).toEqual([]);
  });
});

describe('private-server-state', () => {
  it('列表与分页默认值', () => {
    expect(privateServerState.privateServerList).toEqual([]);
    expect(privateServerState.psActiveCategory).toBe('all');
    expect(privateServerState.psCurrentPage).toBe(1);
    expect(privateServerState.PS_PAGE_SIZE).toBe(10);
    expect(privateServerState.lobbyHasMore).toBe(false);
  });

  it('分类表包含全部、在线、离线与整合包', () => {
    expect(privateServerState.PS_CATEGORIES.map((item) => item.id)).toEqual([
      'all',
      'online',
      'offline',
      'modpack',
    ]);
  });
});

describe('init-setup-state', () => {
  it('初始化计时默认为空', () => {
    expect(initSetupState.initSubTiming).toBeNull();
  });
});
