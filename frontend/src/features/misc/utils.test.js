// @vitest-environment jsdom
// features/misc/utils.test.js — DOM 缓存与防抖节流单元测试
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllManagedIntervals,
  clearDOMCache,
  clearManagedInterval,
  debounce,
  getDOMElement,
  setManagedInterval,
  throttle,
} from './utils.js';

afterEach(() => {
  vi.useRealTimers();
  clearAllManagedIntervals();
  document.body.innerHTML = '';
});

describe('getDOMElement', () => {
  it('同一元素重复查询命中缓存', () => {
    const el = document.createElement('div');
    el.id = 'cache-target';
    document.body.appendChild(el);
    clearDOMCache();
    expect(getDOMElement('cache-target')).toBe(el);
    expect(getDOMElement('cache-target')).toBe(el);
  });

  it('元素移出文档后缓存失效并返回 null', () => {
    const el = document.createElement('div');
    el.id = 'cache-gone';
    document.body.appendChild(el);
    clearDOMCache();
    getDOMElement('cache-gone');
    el.remove();
    expect(getDOMElement('cache-gone')).toBeNull();
  });
});

describe('debounce / throttle', () => {
  it('debounce 只在等待期结束后执行最后一次调用', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced(1);
    debounced(2);
    debounced(3);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('throttle 在时间窗口内只执行一次', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('a');
    throttled('b');
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    throttled('c');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('c');
  });
});

describe('managed intervals', () => {
  it('按 key 覆盖并支持单独/全部清理', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    setManagedInterval(fn, 1000, 'k');
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);

    clearManagedInterval('k');
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);

    setManagedInterval(fn, 1000, 'a');
    setManagedInterval(fn, 1000, 'b');
    clearAllManagedIntervals();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
