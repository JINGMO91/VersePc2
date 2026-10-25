// test-utils/tauri-mock.js — 测试用 Tauri 宿主模拟
// 统一安装 window.__TAURI_INTERNALS__，按 api_proxy 路径或命令名返回固定响应，
// 并记录调用参数，供测试断言。仅在测试文件中引用，不进入生产构建。
import { vi } from 'vitest';

const apiCalls = [];
const commandCalls = [];
let apiRoutes = {};
let commandHandlers = {};

function normalizeApiResult(result) {
  if (result && typeof result === 'object' && 'status' in result && 'body' in result) {
    return result;
  }
  return { status: 200, body: result === undefined ? {} : result };
}

/// 重置全部 mock 状态与调用记录
export function resetTauriMock() {
  apiCalls.length = 0;
  commandCalls.length = 0;
  apiRoutes = {};
  commandHandlers = {};
}

/// 为 api_proxy 注册路由：key 支持路径或 "GET /api/xxx"
export function mockApiRoute(key, result) {
  apiRoutes[key] = result;
}

/// 为普通 invoke 命令注册处理函数或固定返回值
export function mockCommand(command, handler) {
  commandHandlers[command] = handler;
}

/// 安装模拟宿主；返回调用记录，便于断言
export function installTauriMock(options = {}) {
  resetTauriMock();

  apiRoutes = {
    '/api/settings': {},
    '/api/versions': { versions: [], installed: [] },
    '/api/accounts': { accounts: [], currentAccount: null },
    ...(options.apiRoutes || {}),
  };
  commandHandlers = options.commands || {};

  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => {
      commandCalls.push({ cmd, args });

      if (cmd === 'api_proxy') {
        const method = String(args.method || 'GET').toUpperCase();
        const path = args.path || '';
        const key = `${method} ${path}`;
        apiCalls.push({ method, path, args });

        const route = apiRoutes[path] ?? apiRoutes[key];
        if (typeof route === 'function') return normalizeApiResult(await route(args));
        if (route !== undefined) return normalizeApiResult(route);
        return normalizeApiResult({});
      }

      const handler = commandHandlers[cmd];
      if (typeof handler === 'function') return handler(args);
      if (handler !== undefined) return handler;
      return null;
    },
    listen: async () => () => {},
    transformCallback: (callback) => callback,
  };

  return { apiCalls, commandCalls };
}

/// 动态加载模块前先安装 mock；会重置模块缓存，确保模块读到新的 window 状态
export async function withTauriMock(loader, options = {}) {
  installTauriMock(options);
  vi.resetModules();
  return loader();
}

/// 读取 api_proxy 调用记录
export function getApiCalls() {
  return apiCalls;
}

/// 读取普通 invoke 调用记录
export function getCommandCalls() {
  return commandCalls;
}
