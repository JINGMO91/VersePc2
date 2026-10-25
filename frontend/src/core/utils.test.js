// @vitest-environment jsdom
// utils.test.js — 通用格式化函数单元测试
import { describe, expect, it } from 'vitest';
import {
  _lazyLoadCSS,
  _lazyLoadScript,
  decodeFileBuffer,
  escapeHtml,
  formatBytes,
  formatDate,
  formatDuration,
  formatSize,
  formatSpeed,
  normalizeIconUrl,
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

describe('边界值', () => {
  it('空值与非法输入回退', () => {
    expect(formatDate('')).toBe('');
    expect(formatSize(-1)).toBe('0 B');
    expect(formatBytes(0)).toBe('');
    expect(formatSpeed(0)).toBe('0 B/s');
  });

  it('秒数向上取整后再分档', () => {
    expect(formatDuration(59.2)).toBe('1分0秒');
    expect(formatDuration(3600)).toBe('1时0分');
  });

  it('图片镜像地址回退到官方 CDN', () => {
    expect(normalizeIconUrl('https://mod.mcimirror.top/x.png')).toBe('https://cdn.modrinth.com/x.png');
    expect(normalizeIconUrl('')).toBe('');
    expect(normalizeIconUrl(null)).toBe(null);
  });
});

describe('decodeFileBuffer', () => {
  it('兼容 Base64、数组与 Uint8Array', () => {
    expect([...decodeFileBuffer('AQID')]).toEqual([1, 2, 3]);
    expect([...decodeFileBuffer([4, 5])]).toEqual([4, 5]);
    const bytes = new Uint8Array([6, 7]);
    expect(decodeFileBuffer(bytes)).toBe(bytes);
  });

  it('非法 Base64 返回空数组', () => {
    expect(decodeFileBuffer('%%%').length).toBe(0);
    expect(decodeFileBuffer('').length).toBe(0);
    expect(decodeFileBuffer(null).length).toBe(0);
  });
});

describe('懒加载资源', () => {
  it('CSS 只插入一次', () => {
    _lazyLoadCSS('/x.css');
    _lazyLoadCSS('/x.css');
    expect(document.querySelectorAll('link[href="/x.css"]').length).toBe(1);
  });

  it('已存在的脚本直接完成，不重复插入', async () => {
    const script = document.createElement('script');
    script.src = '/exists.js';
    document.head.appendChild(script);
    await expect(_lazyLoadScript('/exists.js')).resolves.toBeUndefined();
    expect(document.querySelectorAll('script[src="/exists.js"]').length).toBe(1);
  });

  it('脚本加载失败时 reject', async () => {
    const promise = _lazyLoadScript('/broken.js');
    const script = document.querySelector('script[src="/broken.js"]');
    script.dispatchEvent(new Event('error'));
    await expect(promise).rejects.toThrow('Failed to load: /broken.js');
  });
});
