// utils.test.js — 通用格式化函数单元测试
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatBytes,
  formatDate,
  formatDuration,
  formatSize,
  formatSpeed,
} from './utils.js';

describe('escapeHtml', () => {
  it('转义 HTML 特殊字符', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;\'');
  });

  it('空值返回空字符串', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('formatSize / formatBytes / formatSpeed', () => {
  it('按 1024 进制格式化大小', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1048576)).toBe('1.0 MB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('格式化下载速度', () => {
    expect(formatSpeed(512)).toBe('512 B/s');
    expect(formatSpeed(2048)).toBe('2 KB/s');
    expect(formatSpeed(2097152)).toBe('2.0 MB/s');
  });
});

describe('formatDate / formatDuration', () => {
  it('日期格式为 yyyy/mm/dd hh:mm', () => {
    expect(formatDate('2026-10-24T08:05:00')).toMatch(/^2026\/10\/24 \d{2}:05$/);
  });

  it('时长按中文单位展示', () => {
    expect(formatDuration(30)).toBe('30秒');
    expect(formatDuration(90)).toBe('1分30秒');
    expect(formatDuration(3700)).toBe('1时1分');
  });
});
