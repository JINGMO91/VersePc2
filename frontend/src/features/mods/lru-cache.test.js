// lru-cache.test.js — 详情页 LRU 缓存单元测试
import { describe, expect, it } from 'vitest';
import { LRUCache } from './mod-detail-state.js';

describe('LRUCache', () => {
  it('写入与读取，容量满时淘汰最旧项', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('读取会刷新最近使用顺序', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('覆盖已有键不会额外占用容量', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('a', 2);
    cache.set('b', 3);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(2);
  });

  it('delete 与 clear 生效', () => {
    const cache = new LRUCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('b')).toBeUndefined();
  });
});
