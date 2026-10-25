// @vitest-environment jsdom
// core/api.test.js — 错误映射、请求封装与 API 路径判定单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API,
  ERROR_MESSAGES,
  ErrorHandler,
  _isApiPath,
  apiDelete,
  apiGet,
  apiPost,
  fetchWithTimeout,
  getUserFriendlyMessage,
  setApiNotifier,
} from './api.js';

beforeEach(() => {
  setApiNotifier(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchResponse(status, body) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  };
}

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

describe('fetchWithTimeout', () => {
  it('成功时返回响应', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(200, { ok: true }));
    const response = await fetchWithTimeout('/api/test', {}, 50);
    expect(response.status).toBe(200);
  });

  it('中止请求映射为超时错误', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abort);
    await expect(fetchWithTimeout('/api/test', {}, 50)).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR',
    });
  });

  it('网络异常映射为网络错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(fetchWithTimeout('/api/test', {}, 50)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});

describe('apiGet', () => {
  it('成功时返回 JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(200, { value: 1 }));
    await expect(apiGet('/api/test', { a: 'b' })).resolves.toEqual({ value: 1 });
  });

  it('服务端错误映射为 500 文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(500, { error: 'boom' }));
    await expect(apiGet('/api/test')).rejects.toMatchObject({ code: 'SERVER_ERROR_500' });
  });

  it('404 映射为资源不存在', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(404, {}));
    await expect(apiGet('/api/test')).rejects.toMatchObject({ code: 'CLIENT_ERROR_404' });
  });

  it('网络失败抛出可读错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const error = await apiGet('/api/test').catch((e) => e);
    expect(getUserFriendlyMessage(error)).toBe(ERROR_MESSAGES.NETWORK_ERROR);
  });

  it('查询参数按 URLSearchParams 编码', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(200, {}));
    await apiGet('/api/test', { q: 'a b', page: 2 });
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/test?q=a+b&page=2');
  });
});

describe('apiPost', () => {
  it('服务端错误返回 500 错误码', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(500, {}));
    await expect(apiPost('/api/settings', {})).rejects.toMatchObject({
      code: 'SERVER_ERROR_500',
    });
  });

  it('发送 JSON 请求体并返回结果', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(200, { saved: true }));
    await expect(apiPost('/api/settings', { a: 1 })).resolves.toEqual({ saved: true });
    const [, options] = fetchSpy.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.body).toBe('{"a":1}');
  });

  it('客户端错误使用响应体文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(409, { error: '冲突' }));
    await expect(apiPost('/api/settings', {})).rejects.toMatchObject({ code: 'CLIENT_ERROR_409', message: '冲突' });
  });
});

describe('apiDelete', () => {
  it('发送 DELETE 并返回 JSON', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(200, { removed: true }));
    await expect(apiDelete('/api/favorites/delete', { id: '1' })).resolves.toEqual({ removed: true });
    const [, options] = fetchSpy.mock.calls[0];
    expect(options.method).toBe('DELETE');
    expect(options.body).toBe('{"id":"1"}');
  });

  it('服务端错误映射状态码', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(500, { error: 'boom' }));
    await expect(apiDelete('/api/favorites/delete', {})).rejects.toMatchObject({
      code: 'SERVER_ERROR_500',
      message: 'boom',
    });
  });

  it('错误响应体不可解析时回落 HTTP 状态文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => { throw new Error('invalid json'); },
    });
    await expect(apiDelete('/api/favorites/delete', {})).rejects.toMatchObject({
      code: 'SERVER_ERROR_503',
      message: 'HTTP 503',
    });
  });
});

describe('API 方法表', () => {
  it('所有接口方法都能按各自协议派发请求', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(200, {}));
    vi.spyOn(window, 'open').mockImplementation(() => {});

    const names = [];
    for (const [name, fn] of Object.entries(API)) {
      if (typeof fn !== 'function') continue;
      await Promise.resolve(fn()).then(() => names.push(name), () => names.push(name));
    }

    expect(names).toContain('getSettings');
    expect(names).toContain('easytierHost');
    expect(names).toContain('exportCrashLog');
    expect(names.length).toBeGreaterThan(90);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('加载器版本查询覆盖各分支', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(200, { versions: ['v1'] }));

    await expect(API.getModLoaderVersions('1.20.1', 'forge')).resolves.toEqual(['v1']);
    await expect(API.getModLoaderVersions('1.20.1', 'neoforge')).resolves.toEqual(['v1']);
    await expect(API.getModLoaderVersions('1.20.1', 'fabric')).resolves.toEqual(['v1']);
    await expect(API.getModLoaderVersions('1.20.1', 'optifine')).resolves.toEqual(['v1']);
    await expect(API.getModLoaderVersions('1.20.1', 'unknown')).resolves.toEqual([]);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('加载器版本接口返回数组时直接使用', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(200, ['1.0', '2.0']));

    await expect(API.getFabricVersions('1.20.1')).resolves.toEqual(['1.0', '2.0']);
    await expect(API.getForgeVersions('1.20.1')).resolves.toEqual(['1.0', '2.0']);
    await expect(API.getOptiFineVersions('1.20.1')).resolves.toEqual(['1.0', '2.0']);
    await expect(API.getFabricApiVersions('1.20.1')).resolves.toEqual(['1.0', '2.0']);
  });

  it('加载器版本查询异常时返回空数组或抛出网络错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    await expect(API.getModLoaderVersions('1.20.1', 'forge')).resolves.toEqual([]);
    await expect(API.getFabricVersions('1.20.1')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(API.getForgeVersions('1.20.1')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(API.getOptiFineVersions('1.20.1')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('导出崩溃日志在非 Tauri 环境打开浏览器窗口', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});

    API.exportCrashLog('1.20.1');

    expect(openSpy).toHaveBeenCalledWith('/api/game/log/export?versionId=1.20.1', '_blank');
  });
});

describe('ErrorHandler', () => {
  it('401 提示登录过期', async () => {
    const notifier = vi.fn();
    setApiNotifier(notifier);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(401, {}));
    const error = await apiGet('/api/private').catch((e) => e);
    ErrorHandler.handle(error, { action: 'test' });
    expect(notifier).toHaveBeenCalledWith('登录已过期，请重新登录', 'error');
  });

  it('网络错误使用 warning 级别', async () => {
    const notifier = vi.fn();
    setApiNotifier(notifier);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const error = await apiGet('/api/test').catch((e) => e);
    ErrorHandler.handle(error);
    expect(notifier).toHaveBeenCalledWith(ERROR_MESSAGES.NETWORK_ERROR, 'warning');
  });

  it('服务端错误使用 error 级别并展示映射文案', async () => {
    const notifier = vi.fn();
    setApiNotifier(notifier);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(500, {}));
    const error = await apiGet('/api/test').catch((e) => e);
    ErrorHandler.handle(error);
    expect(notifier).toHaveBeenCalledWith(ERROR_MESSAGES.SERVER_ERROR_500, 'error');
  });
});
