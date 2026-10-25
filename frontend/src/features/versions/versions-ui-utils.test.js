// @vitest-environment jsdom
// versions-ui-utils.test.js — 版本域展示辅助函数单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { versionsState } from './versions-state.js';
import { setSelectedFolder } from './versions-external.js';
import { getStageText } from './versions-install.js';
import { getVersionBannerUrl } from './versions-list.js';
import { _getTranslateAIConfig } from './vset-translate.js';

beforeEach(() => {
  localStorage.clear();
  versionsState._versionBannerMap = null;
});

afterEach(() => {
  versionsState._versionBannerMap = null;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('getStageText', () => {
  it('已知安装阶段返回中文文案', () => {
    expect(getStageText('version_json')).toBe('下载版本信息...');
    expect(getStageText('libraries')).toBe('下载依赖库...');
    expect(getStageText('fabric-api')).toBe('下载 Fabric API...');
    expect(getStageText('completed')).toBe('安装完成');
  });

  it('未知阶段回退原值或空串', () => {
    expect(getStageText('custom')).toBe('custom');
    expect(getStageText('')).toBe('');
  });
});

describe('getVersionBannerUrl', () => {
  it('没有横幅映射时返回空串', () => {
    expect(getVersionBannerUrl('1.20.1')).toBe('');
  });

  it('有映射时返回对应地址', () => {
    versionsState._versionBannerMap = { '1.20.1': 'https://x/banner.png' };
    expect(getVersionBannerUrl('1.20.1')).toBe('https://x/banner.png');
    expect(getVersionBannerUrl('1.21')).toBe('');
  });
});

describe('setSelectedFolder', () => {
  it('写入共享状态与本地存储', () => {
    setSelectedFolder('D:/versions');
    expect(versionsState._selectedFolder).toBe('D:/versions');
    expect(localStorage.getItem('versepc_selected_folder')).toBe('D:/versions');
  });
});

describe('_getTranslateAIConfig', () => {
  it('读取合法配置，非法 JSON 回退空对象', () => {
    localStorage.setItem('v-island-ai-config', JSON.stringify({ provider: 'deepseek' }));
    expect(_getTranslateAIConfig()).toEqual({ provider: 'deepseek' });

    localStorage.setItem('v-island-ai-config', '{bad');
    expect(_getTranslateAIConfig()).toEqual({});
  });
});
