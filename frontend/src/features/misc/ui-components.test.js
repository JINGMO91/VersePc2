// @vitest-environment jsdom
// ui-components.test.js — 通用 UI 原语单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatNumber,
  escapeOnclick,
  getRememberedFolder,
  getVersionTypeLabel,
  saveRememberedFolder,
  showConfirmDialog,
  showToast,
} from './ui-components.js';

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('formatNumber', () => {
  it('按 K/M 缩写', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1500)).toBe('1.5K');
    expect(formatNumber(2_500_000)).toBe('2.5M');
  });
});

describe('escapeOnclick', () => {
  it('转义 HTML 特殊字符', () => {
    expect(escapeOnclick('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
  });

  it('转义 JavaScript 字符串引号与反斜杠', () => {
    expect(escapeOnclick("a'b")).toBe("a\\'b");
    expect(escapeOnclick('a\\b')).toBe('a\\\\b');
  });
});

describe('getVersionTypeLabel', () => {
  it('映射版本类型与未混淆标记', () => {
    expect(getVersionTypeLabel({ type: 'release' })).toBe('正式版');
    expect(getVersionTypeLabel({ type: 'snapshot' })).toBe('快照版');
    expect(getVersionTypeLabel({ type: 'unknown' })).toBe('unknown');
    expect(getVersionTypeLabel({ type: 'release', complianceLevel: 0 })).toBe('未混淆');
  });
});

describe('下载目录记忆', () => {
  it('保存后可按 key 读取', () => {
    saveRememberedFolder('mods', 'D:/mods');
    expect(getRememberedFolder('mods')).toBe('D:/mods');
    expect(getRememberedFolder('missing')).toBe('');
  });
});

describe('showToast', () => {
  it('写入容器并在超时后移除', () => {
    document.body.innerHTML = '<div id="toast-container"></div>';
    showToast('已保存', 'success');
    const container = document.getElementById('toast-container');
    expect(container.querySelectorAll('.toast.success').length).toBe(1);
    expect(container.textContent).toContain('已保存');
    vi.advanceTimersByTime(3500);
    expect(container.querySelectorAll('.toast').length).toBe(0);
  });

  it('容器不存在时静默返回', () => {
    expect(() => showToast('x')).not.toThrow();
  });
});

describe('showConfirmDialog', () => {
  it('确认返回 true，取消返回 false', async () => {
    const confirmed = showConfirmDialog('标题', '内容', '确定', '取消');
    document.querySelector('.confirm-ok').click();
    vi.advanceTimersByTime(200);
    await expect(confirmed).resolves.toBe(true);

    const cancelled = showConfirmDialog('标题', '内容');
    document.querySelector('.confirm-cancel').click();
    vi.advanceTimersByTime(200);
    await expect(cancelled).resolves.toBe(false);
  });
});
