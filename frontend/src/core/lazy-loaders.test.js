// lazy-loaders.test.js — 懒加载中转单元测试
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerLazyLoader, requestLazyLoad } from './lazy-loaders.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lazy-loaders', () => {
  it('未注册时警告并返回 undefined', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(requestLazyLoad('missing')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[lazy-loaders] 加载器尚未注册:', 'missing');
  });

  it('注册后执行并返回加载结果', () => {
    registerLazyLoader('demo', () => 'loaded');
    expect(requestLazyLoad('demo')).toBe('loaded');
  });

  it('透传调用参数', () => {
    const loader = vi.fn((a, b) => `${a}:${b}`);
    registerLazyLoader('with-args', loader);
    expect(requestLazyLoad('with-args', 'id', 'source')).toBe('id:source');
    expect(loader).toHaveBeenCalledWith('id', 'source');
  });

  it('重复注册后者覆盖前者；非函数注册被忽略', () => {
    registerLazyLoader('demo', () => 'first');
    registerLazyLoader('demo', () => 'second');
    expect(requestLazyLoad('demo')).toBe('second');
    registerLazyLoader('demo', 'not-a-function');
    expect(requestLazyLoad('demo')).toBe('second');
  });
});
