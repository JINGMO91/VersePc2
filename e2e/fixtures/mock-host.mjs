// e2e/fixtures/mock-host.mjs — 浏览器 E2E 的 Tauri 宿主模拟
// 在页面脚本执行前注入 window.__TAURI_INTERNALS__，按 api_proxy 路径返回固定数据，
// 避免测试依赖真实后端与网络。

export const DEFAULT_SETTINGS = {
  selectedVersion: '',
  javaPath: '',
  maxMemory: 4096,
  minMemory: 1024,
  theme: 'light',
  downloadSource: 'china-first',
  versionSource: 'auto',
  maxThreads: 64,
  enableChunkDownload: true,
  maxChunksPerFile: 64,
  speedLimit: 0,
  sslVerify: false,
  modSource: 'modrinth',
  filenameFormat: 'default',
  modStyle: 'title',
  ignoreQuilt: false,
  accentColor: '#1a1a1a',
  fullscreen: false,
  closeOnLaunch: false,
  autoUpdate: true,
  versionIsolation: true,
  targetDir: '',
};

export const DEFAULT_API_ROUTES = {
  '/api/settings': DEFAULT_SETTINGS,
  '/api/versions': { versions: [], installed: [] },
  '/api/accounts': { accounts: [], currentAccount: null },
  '/api/java/installed': { java: [], currentJavaPath: '', detecting: false },
  '/api/java/list': [],
  '/api/java/detect': { java: [] },
  '/api/game/status': { running: false, instances: [] },
  '/api/system/memory': { total: 8192, free: 4096 },
  '/api/mods': [],
  '/api/mods/search': { mods: [], total: 0, offset: 0 },
  '/api/favorites': { folders: [] },
  '/api/status': {},
  '/api/filesystem/quick-access': [],
  '/api/version/list-folders': { folders: [] },
  '/api/version/auto-detect-folders': { folders: [] },
};

export const DEFAULT_COMMANDS = {
  get_app_version: '1.7.2',
  window_is_maximized: false,
  window_is_fullscreen: false,
  window_is_minimized: false,
  store_get: null,
  store_set: true,
  store_delete: true,
  updater_get_pending_notice: null,
  get_default_mod_path: { success: true, path: '' },
  read_file_buffer: null,
};

/// 安装 mock 宿主；overrides 可覆盖或新增 api_proxy 路径与 invoke 命令
export async function installMockHost(page, overrides = {}) {
  const apiRoutes = { ...DEFAULT_API_ROUTES, ...(overrides.apiRoutes || {}) };
  const commands = { ...DEFAULT_COMMANDS, ...(overrides.commands || {}) };

  await page.addInitScript(
    ({ apiRoutes, commands }) => {
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args = {}) => {
          if (cmd === 'api_proxy') {
            const method = String(args.method || 'GET').toUpperCase();
            const key = `${method} ${args.path || ''}`;
            const route = apiRoutes[args.path] ?? apiRoutes[key];
            if (typeof route !== 'undefined') {
              if (route && typeof route === 'object' && 'status' in route && 'body' in route) {
                return route;
              }
              return { status: 200, body: route };
            }
            return { status: 200, body: {} };
          }
          if (Object.prototype.hasOwnProperty.call(commands, cmd)) {
            return commands[cmd];
          }
          return null;
        },
        listen: async () => () => {},
        transformCallback: (callback) => callback,
      };
    },
    { apiRoutes, commands },
  );
}

/// 通过导航按钮切换页面（隐藏的子菜单按钮同样可触发 click）
export async function clickPage(page, pageName) {
  await page.evaluate((name) => {
    const button =
      document.querySelector(`.nav-btn[data-page="${name}"]`) ||
      document.querySelector(`.nav-sub-btn[data-page="${name}"]`);
    if (button) button.click();
  }, pageName);
}

/// 当前处于 active 状态的页面 id
export async function activePageId(page) {
  return page.evaluate(() => {
    const active = document.querySelector('.page.active');
    return active ? active.id : '';
  });
}
