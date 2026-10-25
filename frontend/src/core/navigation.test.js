// navigation.test.js — 导航中立入口单元测试
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  navigateToPage,
  openVersionDetail,
  setNavigationHandler,
  setVersionDetailHandler,
} from './navigation.js';

afterEach(() => {
  setNavigationHandler(null);
  setVersionDetailHandler(null);
  vi.restoreAllMocks();
});

describe('页面导航', () => {
  it('未注册实现时警告并返回 undefined', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(navigateToPage('home')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[navigation] 导航实现尚未注册:', 'home');
  });

  it('注册后透传页面名与返回值', () => {
    const handler = vi.fn((page) => `opened:${page}`);
    setNavigationHandler(handler);
    expect(navigateToPage('settings')).toBe('opened:settings');
    expect(handler).toHaveBeenCalledWith('settings');
  });

  it('传入非函数会清空处理器', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setNavigationHandler(() => {});
    setNavigationHandler('not-a-function');
    navigateToPage('home');
    expect(warn).toHaveBeenCalled();
  });
});

describe('版本详情', () => {
  it('未注册实现时警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(openVersionDetail('1.20.1')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[navigation] 版本详情实现尚未注册:', '1.20.1');
  });

  it('注册后透传全部参数', () => {
    const handler = vi.fn(() => 'ok');
    setVersionDetailHandler(handler);
    expect(openVersionDetail('1.20.1', 'http://x', 'release')).toBe('ok');
    expect(handler).toHaveBeenCalledWith('1.20.1', 'http://x', 'release');
  });

  it('传入非函数会清空版本详情处理器', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setVersionDetailHandler(() => {});
    setVersionDetailHandler(null);
    openVersionDetail('1.20.1');
    expect(warn).toHaveBeenCalled();
  });
});
