// @vitest-environment jsdom
// dom-utils.test.js — DOM 缓存、防抖、节流与定时器管理单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheCommonElements,
  clearAllManagedIntervals,
  clearDOMCache,
  clearManagedInterval,
  debounce,
  getDOMElement,
  managedTimers,
  refreshElementCache,
  setManagedInterval,
  throttle,
} from './utils.js';

beforeEach(() => {
  vi.useFakeTimers();
  clearDOMCache();
  clearAllManagedIntervals();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  clearAllManagedIntervals();
});

describe('getDOMElement', () => {
  it('命中后复用缓存，节点移除后重新查询', () => {
    const el = document.createElement('div');
    el.id = 'cached-node';
    document.body.appendChild(el);

    expect(getDOMElement('cached-node')).toBe(el);
    expect(getDOMElement('cached-node')).toBe(el);

    el.remove();
    expect(getDOMElement('cached-node')).toBeNull();
  });

  it('cacheCommonElements 只缓存存在的节点', () => {
    const el = document.createElement('div');
    el.id = 'mod-list';
    document.body.appendChild(el);
    cacheCommonElements();
    expect(getDOMElement('mod-list')).toBe(el);
  });

  it('refreshElementCache 在节点移除后清理缓存', () => {
    const el = document.createElement('div');
    el.id = 'mod-list';
    document.body.appendChild(el);
    cacheCommonElements();
    el.remove();
    refreshElementCache('mod-list');
    expect(getDOMElement('mod-list')).toBeNull();
  });
});

describe('debounce / throttle', () => {
  it('防抖只在最后一次调用后执行', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced(1);
    debounced(2);
    debounced(3);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('节流在窗口期内只执行一次', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('a');
    throttled('b');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
    vi.advanceTimersByTime(100);
    throttled('c');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('受管定时器', () => {
  it('同 key 覆盖旧定时器，clear 后不再触发', () => {
    const fn = vi.fn();
    setManagedInterval(fn, 50, 'poll');
    setManagedInterval(fn, 50, 'poll');
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(managedTimers.intervals.size).toBe(1);

    clearManagedInterval('poll');
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clearAllManagedIntervals 清空全部', () => {
    setManagedInterval(() => {}, 50, 'a');
    setManagedInterval(() => {}, 50, 'b');
    clearAllManagedIntervals();
    expect(managedTimers.intervals.size).toBe(0);
  });
});
