// @vitest-environment jsdom
// features/mods/chinese-names.test.js — 中文名与中文搜索词转换单元测试
import { describe, expect, it } from 'vitest';
import {
  formatModNameWithChinese,
  getModChineseName,
  isChineseQuery,
  translateChineseSearch,
} from './chinese-names.js';

describe('getModChineseName', () => {
  it('精确命中本地字典', () => {
    expect(getModChineseName('sodium', 'Sodium')).toBe('钠·渲染优化');
    expect(getModChineseName('forge', 'Forge')).toBe('Forge');
  });

  it('大小写与下划线归一后仍可命中', () => {
    expect(getModChineseName('SODIUM', '')).toBe('钠·渲染优化');
  });

  it('未知模组返回空字符串', () => {
    expect(getModChineseName('zzzz-not-a-mod', 'Unknown Mod')).toBe('');
    expect(getModChineseName('', '')).toBe('');
  });
});

describe('formatModNameWithChinese', () => {
  it('命中中文名时拼接括号', () => {
    expect(formatModNameWithChinese('sodium', 'Sodium')).toBe('Sodium（钠·渲染优化）');
  });

  it('未命中时原样返回英文名', () => {
    expect(formatModNameWithChinese('zzzz-not-a-mod', 'Unknown Mod')).toBe('Unknown Mod');
  });
});

describe('translateChineseSearch / isChineseQuery', () => {
  it('中文关键词转换为英文关键词列表', () => {
    expect(translateChineseSearch('优化', 'mod')).toContain('sodium');
    expect(translateChineseSearch('优化', 'mod')).toContain('ferritecore');
  });

  it('空查询返回空字符串', () => {
    expect(translateChineseSearch('', 'mod')).toBe('');
    expect(translateChineseSearch('   ', 'mod')).toBe('');
  });

  it('识别中文查询', () => {
    expect(isChineseQuery('优化')).toBe(true);
    expect(isChineseQuery('Sodium')).toBe(false);
    expect(isChineseQuery('')).toBe(false);
  });
});
