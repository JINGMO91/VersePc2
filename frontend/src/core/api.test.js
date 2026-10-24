// @vitest-environment jsdom
// core/api.test.js — 错误映射与 API 路径判定单元测试
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES, _isApiPath, getUserFriendlyMessage } from './api.js';

describe('getUserFriendlyMessage', () => {
  it('非 API 错误回落到未知错误文案', () => {
    expect(getUserFriendlyMessage(new Error('boom'))).toBe(ERROR_MESSAGES.UNKNOWN_ERROR);
    expect(getUserFriendlyMessage(null)).toBe(ERROR_MESSAGES.UNKNOWN_ERROR);
  });

  it('错误码映射表包含网络与客户端常见状态', () => {
    expect(ERROR_MESSAGES.NETWORK_ERROR).toBeTruthy();
    expect(ERROR_MESSAGES.TIMEOUT_ERROR).toBeTruthy();
    expect(ERROR_MESSAGES.CLIENT_ERROR_401).toBeTruthy();
    expect(ERROR_MESSAGES.SERVER_ERROR_500).toBeTruthy();
  });
});

describe('_isApiPath', () => {
  it('只识别 /api/ 前缀', () => {
    expect(_isApiPath('/api/mods/search')).toBe(true);
    expect(_isApiPath('/api/')).toBe(true);
    expect(_isApiPath('/api')).toBe(false);
    expect(_isApiPath('/static/app.js')).toBe(false);
    expect(_isApiPath('')).toBe(false);
  });
});
