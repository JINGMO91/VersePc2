// @vitest-environment jsdom
// versions-state.test.js — 版本域共享状态契约单元测试
import { afterEach, describe, expect, it } from 'vitest';
import { S } from './vset-state.js';
import { getSelectedFolder, versionsState } from './versions-state.js';

afterEach(() => {
  localStorage.clear();
});

describe('getSelectedFolder', () => {
  it('默认使用内置目录', () => {
    expect(getSelectedFolder()).toBe('__internal');
  });

  it('读取 localStorage 中记录的外置目录', () => {
    localStorage.setItem('versepc_selected_folder', 'D:/MinecraftVersions');
    expect(getSelectedFolder()).toBe('D:/MinecraftVersions');
  });
});

describe('versionsState', () => {
  it('分页与 Fabric API 选择状态默认值', () => {
    expect(versionsState._selectedFolder).toBe('__internal');
    expect(versionsState._fabricApiVersionsCache).toEqual([]);
    expect(versionsState._fabricApiSelectedId).toBe('');
    expect(versionsState._fabricApiDetailText).toBe('不安装');
    expect(versionsState._versionsLoadTime).toBe(0);
  });

  it('页面动画选择器覆盖主要区块', () => {
    expect(versionsState._PCL_BLOCK_SELECTOR).toContain('.page-header');
    expect(versionsState._PCL_BLOCK_SELECTOR).toContain('.card');
  });
});

describe('vsetState', () => {
  it('AI 供应商配置包含请求格式与端点', () => {
    expect(S._AI_PROVIDERS.deepseek.apiFormat).toBe('openai');
    expect(S._AI_PROVIDERS.deepseek.endpoint).toContain('deepseek.com');
    expect(S._AI_PROVIDERS.anthropic.apiFormat).toBe('anthropic');
    expect(S._AI_PROVIDERS.custom).toBeNull();
  });

  it('修复与导出会话状态默认空闲', () => {
    expect(S.currentRepairSessionId).toBeNull();
    expect(S.repairPollTimer).toBeNull();
    expect(S._exportTreeLoaded).toBe(false);
    expect(S._checkingModUpdates).toBe(false);
  });
});
