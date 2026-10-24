// features/mods/mod-version-utils.test.js — 模组版本号归一与排序单元测试
import { describe, expect, it } from 'vitest';
import { _sortVersionsByNumber, _versionToExact, _versionToMajor } from './mod-version-utils.js';

describe('_versionToExact', () => {
  it('提取三段式版本号', () => {
    expect(_versionToExact('1.21.1')).toBe('1.21.1');
    expect(_versionToExact('1.21.1-forge-51.0.1')).toBe('1.21.1');
    expect(_versionToExact('1.20')).toBe('1.20');
  });

  it('快照版与空值', () => {
    expect(_versionToExact('24w14a')).toBe('快照版');
    expect(_versionToExact('snapshot-1.21')).toBe('快照版');
    expect(_versionToExact('')).toBeNull();
  });
});

describe('_versionToMajor', () => {
  it('1.14 以上归并到小版本', () => {
    expect(_versionToMajor('1.21.1')).toBe('1.21');
    expect(_versionToMajor('1.20')).toBe('1.20');
  });

  it('低版本与快照返回空或快照标记', () => {
    expect(_versionToMajor('1.12.2')).toBeNull();
    expect(_versionToMajor('24w14a')).toBe('快照版');
  });

  it('新版号直接取主次版本', () => {
    expect(_versionToMajor('26.3')).toBe('26.3');
  });
});

describe('_sortVersionsByNumber', () => {
  it('按版本号降序且不修改原数组', () => {
    const input = [
      { versionNumber: '1.20.1', datePublished: '2023-01-01' },
      { versionNumber: '1.21.1', datePublished: '2024-08-08' },
      { versionNumber: '1.21', datePublished: '2024-06-13' },
    ];
    const sorted = _sortVersionsByNumber(input).map((v) => v.versionNumber);
    expect(sorted).toEqual(['1.21.1', '1.21', '1.20.1']);
    expect(input[0].versionNumber).toBe('1.20.1');
  });

  it('同版本按发布日期降序', () => {
    const input = [
      { versionNumber: '1.0.0', datePublished: '2024-01-01' },
      { versionNumber: '1.0.0', datePublished: '2024-06-01' },
    ];
    expect(_sortVersionsByNumber(input)[0].datePublished).toBe('2024-06-01');
  });
});
