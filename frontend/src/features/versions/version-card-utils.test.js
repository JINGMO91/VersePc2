// @vitest-environment jsdom
// features/versions/version-card-utils.test.js — 版本卡片样式开关单元测试
import { afterEach, describe, expect, it } from 'vitest';
import { getVersionCardStyle } from './version-card-utils.js';

afterEach(() => {
  localStorage.clear();
});

describe('getVersionCardStyle', () => {
  it('未设置时默认使用卡片样式', () => {
    expect(getVersionCardStyle()).toBe(true);
  });

  it('显式设置为 list 时使用旧列表样式', () => {
    localStorage.setItem('versepc_version_card_style', 'list');
    expect(getVersionCardStyle()).toBe(false);
  });

  it('其他值都视为卡片样式', () => {
    localStorage.setItem('versepc_version_card_style', 'card');
    expect(getVersionCardStyle()).toBe(true);
    localStorage.setItem('versepc_version_card_style', 'something-else');
    expect(getVersionCardStyle()).toBe(true);
  });
});
