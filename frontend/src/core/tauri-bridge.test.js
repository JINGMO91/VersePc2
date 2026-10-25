// @vitest-environment jsdom
// tauri-bridge.test.js — Tauri 桥接层与 IPC 面单元测试
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getApiCalls,
  getCommandCalls,
  installTauriMock,
  mockCommand,
  resetTauriMock,
} from '../test-utils/tauri-mock.js';

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

async function loadBridge(options = {}) {
  installTauriMock(options);
  vi.resetModules();
  const { bridge } = await import('./tauri-bridge.js');
  // 用对象包一层，避免 await 把带 Proxy 的 bridge 当作 thenable 解析
  return { bridge };
}

function captureEvents() {
  const listeners = new Map();
  window.__TAURI_INTERNALS__.listen = async (name, callback) => {
    listeners.set(name, callback);
    return () => listeners.delete(name);
  };
  return listeners;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('apiProxy', () => {
  it('把 api_proxy 结果转换为 ok/status/json 结构并记录调用', async () => {
    const { bridge } = await loadBridge({
      apiRoutes: { '/api/settings': { selectedVersion: '1.20.1' } },
    });

    const result = await bridge.apiProxy('GET', '/api/settings', { a: 1 }, null);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({ selectedVersion: '1.20.1' });

    expect(getApiCalls()).toHaveLength(1);
    expect(getApiCalls()[0]).toMatchObject({ method: 'GET', path: '/api/settings' });
  });

  it('4xx 结果 ok 为 false', async () => {
    const { bridge } = await loadBridge({
      apiRoutes: { '/api/missing': { status: 404, body: { error: 'not found' } } },
    });
    const result = await bridge.apiProxy('GET', '/api/missing');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});

describe('存储与命令封装', () => {
  it('store.get/set/delete 透传到对应命令', async () => {
    const { bridge } = await loadBridge({
      commands: {
        store_get: ({ key }) => ({ key, value: 'stored' }),
        store_set: () => true,
        store_delete: () => true,
      },
    });

    await expect(bridge.store.get('k')).resolves.toEqual({ key: 'k', value: 'stored' });
    await bridge.store.set('k', 'v');
    await bridge.store.delete('k');

    const commands = getCommandCalls().map((call) => call.cmd);
    expect(commands).toEqual(['store_get', 'store_set', 'store_delete']);
  });
});

describe('对话框返回值归一化', () => {
  it('selectFile 兼容 { cancelled:false, path } 格式', async () => {
    const { bridge } = await loadBridge({
      commands: { select_file: () => ({ cancelled: false, path: 'C:/a.zip' }) },
    });
    await expect(bridge.selectFile({ title: '选择' })).resolves.toEqual({
      canceled: false,
      cancelled: false,
      filePaths: ['C:/a.zip'],
      path: 'C:/a.zip',
    });
  });

  it('selectFile 取消时返回空文件列表', async () => {
    const { bridge } = await loadBridge({ commands: { select_file: () => ({ cancelled: true }) } });
    const result = await bridge.selectFile();
    expect(result.canceled).toBe(true);
    expect(result.filePaths).toEqual([]);
  });

  it('selectSaveFolder 取消与成功两种结果', async () => {
    const { bridge } = await loadBridge({
      commands: { select_folder: () => ({ cancelled: true }) },
    });
    await expect(bridge.selectSaveFolder('D:/')).resolves.toEqual({
      cancelled: true,
      path: null,
      error: null,
    });
  });
});

describe('系统能力', () => {
  it('getDefaultModPath 只返回成功路径', async () => {
    const { bridge } = await loadBridge({
      commands: { get_default_mod_path: ({ versionId }) => ({ success: true, path: `/mods/${versionId}` }) },
    });
    await expect(bridge.getDefaultModPath('1.20.1')).resolves.toBe('/mods/1.20.1');
  });

  it('未知桥接口返回空函数并警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bridge } = await loadBridge();
    await expect(bridge.notImplemented()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('thenable 安全', () => {
  it('bridge 不会被当作 thenable 而挂起', async () => {
    const { bridge } = await loadBridge();
    await expect(Promise.resolve(bridge)).resolves.toBe(bridge);
  });
});

describe('非 Tauri 环境', () => {
  it('没有宿主时 bridge 为空对象', async () => {
    delete window.__TAURI_INTERNALS__;
    delete window.__TAURI__;
    vi.resetModules();
    const { bridge } = await import('./tauri-bridge.js');
    expect(bridge).toEqual({});
  });
});

describe('窗口控制', () => {
  it('所有窗口动作映射到对应命令', async () => {
    const { bridge } = await loadBridge();

    bridge.minimize();
    bridge.maximize();
    bridge.close();
    bridge.restore();
    bridge.windowMinimize();
    bridge.windowRestore();
    bridge.quitApp();
    bridge.setWindowMode(true);
    bridge.setWindowMode(false);
    bridge.showWindowEarly();
    await bridge.isMaximized();
    await bridge.isFullscreen();
    await bridge.isMinimized();
    await flush();

    const commands = getCommandCalls().map((call) => call.cmd);
    expect(commands).toEqual(expect.arrayContaining([
      'window_minimize',
      'window_maximize',
      'window_close',
      'window_restore',
      'window_is_maximized',
      'window_is_fullscreen',
      'window_is_minimized',
      'window_show',
    ]));
  });
});

describe('对话框与系统能力', () => {
  it('showOpenDialog 透传选项', async () => {
    const { bridge } = await loadBridge({
      commands: { dialog_open: ({ options }) => ({ canceled: false, filePaths: [options.defaultPath] }) },
    });

    await expect(bridge.showOpenDialog({ defaultPath: 'D:/x' })).resolves.toEqual({
      canceled: false,
      filePaths: ['D:/x'],
    });
  });

  it('selectSaveFolder 成功返回路径', async () => {
    const { bridge } = await loadBridge({
      commands: { select_folder: () => ({ cancelled: false, path: 'D:/saves' }) },
    });

    await expect(bridge.selectSaveFolder('D:/')).resolves.toEqual({
      cancelled: false,
      path: 'D:/saves',
      error: null,
    });
  });

  it('内存优化走 api_proxy 并返回响应体', async () => {
    const { bridge } = await loadBridge({
      apiRoutes: { '/api/memory-optimize': { freed: 128 } },
    });

    await expect(bridge.memoryOptimize()).resolves.toEqual({ freed: 128 });
  });

  it('openExternal 与文件读取透传参数', async () => {
    const { bridge } = await loadBridge({
      commands: {
        open_external: ({ url }) => ({ opened: url }),
        read_file_buffer: ({ path }) => ({ path, bytes: 3 }),
      },
    });

    await expect(bridge.openExternal('https://example.com')).resolves.toEqual({ opened: 'https://example.com' });
    await expect(bridge.readFileBuffer('D:/a.txt')).resolves.toEqual({ path: 'D:/a.txt', bytes: 3 });
  });

  it('模组默认保存目录成功、失败与异常', async () => {
    const { bridge } = await loadBridge();

    mockCommand('get_default_mod_save_folder', () => ({ success: true, path: 'D:/mods' }));
    await expect(bridge.getDefaultModSaveFolder('1.20.1', 'fabric')).resolves.toEqual({
      success: true,
      path: 'D:/mods',
    });

    mockCommand('get_default_mod_save_folder', () => ({ success: false }));
    await expect(bridge.getDefaultModSaveFolder('', '')).resolves.toBeNull();

    mockCommand('get_default_mod_save_folder', () => { throw new Error('no'); });
    await expect(bridge.getDefaultModSaveFolder()).resolves.toBeNull();
  });

  it('拖拽文件路径与极光视频回退', async () => {
    const { bridge } = await loadBridge();

    expect(bridge.getDroppedFilePath({ path: 'D:/a.jar', name: 'a.jar' })).toBe('D:/a.jar');
    expect(bridge.getDroppedFilePath({ name: 'b.jar' })).toBe('b.jar');
    expect(bridge.getDroppedFilePath(null)).toBe('');
    await expect(bridge.getAuroraVideoPath()).resolves.toBe('');
  });

  it('平台键与布尔标记一致', async () => {
    const { bridge } = await loadBridge();

    expect(['windows', 'macos', 'linux', 'ios', 'android', 'unknown']).toContain(bridge.platform);
    expect(bridge.isWindows).toBe(bridge.platform === 'windows');
    expect(bridge.isMac).toBe(bridge.platform === 'macos');
    expect(bridge.isLinux).toBe(bridge.platform === 'linux');
  });
});

describe('事件订阅', () => {
  it('关闭动画事件透传 payload 并可重复订阅', async () => {
    const { bridge } = await loadBridge();
    const listeners = captureEvents();
    const first = vi.fn();
    const second = vi.fn();

    bridge.onRequestCloseAnimate(first);
    await flush();
    listeners.get('request-close-animate')({ payload: { reason: 'quit' } });
    expect(first).toHaveBeenCalledWith({ reason: 'quit' });

    bridge.onRequestCloseAnimate(second);
    await flush();
    listeners.get('request-close-animate')({ payload: 'bye' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('bye');
  });

  it('导入进度与窗口状态监听可取消', async () => {
    const { bridge } = await loadBridge();
    const listeners = captureEvents();
    const progress = vi.fn();

    const unsubscribe = bridge.onImportProgress(progress);
    await flush();
    listeners.get('import:progress')({ payload: { percent: 50 } });
    expect(progress).toHaveBeenCalledWith({ percent: 50 });

    unsubscribe();
    expect(listeners.has('import:progress')).toBe(false);

    const remove = bridge.onWindowStateChanged(() => {});
    expect(typeof remove).toBe('function');
    remove();
    expect(() => bridge.onWindowModeChanged(() => {})()).not.toThrow();
  });

  it('事件回调异常被捕获且不中断监听', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { bridge } = await loadBridge();
    const listeners = captureEvents();

    bridge.onImportProgress(() => { throw new Error('bad'); });
    await flush();

    expect(() => listeners.get('import:progress')({ payload: {} })).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('更新器', () => {
  it('常规命令透传', async () => {
    const { bridge } = await loadBridge({
      commands: {
        get_app_version: () => '0.5.0',
        updater_check_for_updates: () => ({ status: 'available' }),
        updater_download_update: () => ({ success: true }),
        updater_install_update: () => ({ success: true }),
        updater_skip_version: () => ({ skipped: true }),
        updater_open_release_page: () => ({ opened: true }),
        updater_get_pending_notice: () => ({ version: '0.5.0' }),
      },
    });

    await expect(bridge.updater.getVersion()).resolves.toBe('0.5.0');
    await expect(bridge.updater.checkForUpdates()).resolves.toEqual({ status: 'available' });
    await expect(bridge.updater.downloadUpdate()).resolves.toEqual({ success: true });
    await expect(bridge.updater.installUpdate()).resolves.toEqual({ success: true });
    await expect(bridge.updater.skipVersion('0.4.0')).resolves.toEqual({ skipped: true });
    await expect(bridge.updater.openReleasePage()).resolves.toEqual({ opened: true });
    await expect(bridge.updater.getPendingNotice()).resolves.toEqual({ version: '0.5.0' });
  });

  it('命令异常时使用降级结果并告警', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bridge } = await loadBridge();
    mockCommand('get_app_version', () => { throw new Error('no'); });
    mockCommand('updater_check_for_updates', () => { throw new Error('down'); });
    mockCommand('updater_download_update', () => { throw new Error('down'); });
    mockCommand('updater_install_update', () => { throw new Error('down'); });
    mockCommand('updater_skip_version', () => { throw new Error('down'); });
    mockCommand('updater_open_release_page', () => { throw new Error('down'); });
    mockCommand('updater_get_pending_notice', () => { throw new Error('down'); });

    await expect(bridge.updater.getVersion()).resolves.toBe('0.1.0');
    await expect(bridge.updater.checkForUpdates()).resolves.toMatchObject({ status: 'not-available' });
    await expect(bridge.updater.downloadUpdate()).resolves.toMatchObject({ success: false });
    await expect(bridge.updater.installUpdate()).resolves.toMatchObject({ success: false });
    await expect(bridge.updater.skipVersion('x')).resolves.toEqual({});
    await expect(bridge.updater.openReleasePage()).resolves.toBeUndefined();
    await expect(bridge.updater.getPendingNotice()).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('状态事件只转发带 channel 的载荷', async () => {
    const { bridge } = await loadBridge();
    const listeners = captureEvents();
    const callback = vi.fn();
    bridge.updater.onStatusChanged(callback);
    await flush();

    const emit = listeners.get('updater:status');
    emit({ payload: { channel: 'download', data: { percent: 30 } } });
    emit({ payload: { data: {} } });
    emit({ payload: null });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ channel: 'download', data: { percent: 30 } });
    expect(() => bridge.updater.removeStatusListener()).not.toThrow();
  });
});

describe('场景渲染器与 AI / TTS', () => {
  it('场景渲染器命令成功与降级', async () => {
    const { bridge } = await loadBridge({
      commands: {
        scene_renderer_installed: () => ({ ok: true, installed: true }),
        scene_renderer_download: () => ({ ok: true }),
      },
    });

    await expect(bridge.sceneRenderer.installed()).resolves.toEqual({ ok: true, installed: true });
    await expect(bridge.sceneRenderer.download()).resolves.toEqual({ ok: true });

    mockCommand('scene_renderer_installed', () => { throw new Error('no'); });
    mockCommand('scene_renderer_download', () => { throw new Error('no'); });
    await expect(bridge.sceneRenderer.installed()).resolves.toEqual({ ok: false, installed: false });
    await expect(bridge.sceneRenderer.download()).resolves.toMatchObject({ ok: false });
  });

  it('场景渲染器进度事件透传', async () => {
    const { bridge } = await loadBridge();
    const listeners = captureEvents();
    const progress = vi.fn();
    bridge.sceneRenderer.onProgress(progress);
    await flush();

    listeners.get('scene-renderer:progress')({ payload: { stage: 'download', percent: 10 } });
    expect(progress).toHaveBeenCalledWith({ stage: 'download', percent: 10 });
  });

  it('TTS 合成成功、空结果与异常', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bridge } = await loadBridge({
      commands: { tts_speak: () => new Uint8Array([1, 2]) },
    });
    await expect(bridge.tts.speak('你好')).resolves.toEqual({ ok: true, data: new Uint8Array([1, 2]) });

    mockCommand('tts_speak', () => new Uint8Array([]));
    await expect(bridge.tts.speak('你好')).resolves.toEqual({ ok: false, error: '合成结果为空' });

    mockCommand('tts_speak', () => { throw new Error('offline'); });
    await expect(bridge.tts.speak('你好')).resolves.toMatchObject({ ok: false });
  });

  it('AI 对话透传配置并处理空响应与异常', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bridge } = await loadBridge({
      commands: { ai_chat: ({ config }) => ({ ok: true, config }) },
    });
    await expect(bridge.ai.chat({ model: 'm1' })).resolves.toEqual({ ok: true, config: { model: 'm1' } });

    mockCommand('ai_chat', () => null);
    await expect(bridge.ai.chat()).resolves.toEqual({ ok: false, error: 'AI 请求无响应' });

    mockCommand('ai_chat', () => { throw new Error('boom'); });
    await expect(bridge.ai.chat()).resolves.toMatchObject({ ok: false });
  });
});

describe('私人服务器与本地开服', () => {
  it('私人服务器命令参数映射', async () => {
    const { bridge } = await loadBridge();
    bridge.privateServer.list();
    bridge.privateServer.save([{ id: 1 }]);
    bridge.privateServer.add({ id: 2 });
    bridge.privateServer.update({ id: 2 });
    bridge.privateServer.delete(2);
    bridge.privateServer.check('mc.example.com');
    bridge.privateServer.copyAddress('mc.example.com');
    bridge.privateServer.getIcon('cwd');
    await flush();

    expect(getCommandCalls().map((call) => call.cmd)).toEqual([
      'private_server_list',
      'private_server_save',
      'private_server_add',
      'private_server_update',
      'private_server_delete',
      'private_server_check',
      'private_server_copy_address',
      'private_server_icon',
    ]);
  });

  it('本地开服命令参数映射', async () => {
    const { bridge } = await loadBridge();
    bridge.serverHost.list();
    bridge.serverHost.create({ versionId: '1.20.1', name: '服', port: 25565, maxMem: 4096, onlineMode: true, syncMods: false });
    bridge.serverHost.start({ id: 's1' });
    bridge.serverHost.stop({ id: 's1' });
    bridge.serverHost.command({ id: 's1', command: 'say hi' });
    bridge.serverHost.status({ id: 's1' });
    bridge.serverHost.status();
    bridge.serverHost.delete({ id: 's1' });
    bridge.serverHost.openDir({ id: 's1' });
    bridge.serverHost.resolveVersion({ versionId: '1.20.1' });
    bridge.serverHost.detectLoader({ versionId: '1.20.1' });
    bridge.serverHost.syncMods({ id: 's1', clientVersionId: '1.20.1' });
    bridge.serverHost.syncMods({ id: 's1', versionId: '1.21' });
    await flush();

    const calls = getCommandCalls();
    const create = calls.find((call) => call.cmd === 'server_host_create');
    expect(create.args.options).toEqual({ maxMem: 4096, onlineMode: true, syncMods: false });
    expect(calls.filter((call) => call.cmd === 'server_host_status').map((call) => call.args.serverId)).toEqual(['s1', null]);
    expect(calls.find((call) => call.cmd === 'server_host_open_dir').args.serverId).toBe('s1');
    expect(calls.filter((call) => call.cmd === 'server_host_sync_mods').map((call) => call.args.clientVersionId)).toEqual(['1.20.1', '1.21']);
  });

  it('开服日志与状态事件透传', async () => {
    const { bridge } = await loadBridge();
    const listeners = captureEvents();
    const log = vi.fn();
    const status = vi.fn();
    bridge.serverHost.onLog(log);
    bridge.serverHost.onStatus(status);
    await flush();

    listeners.get('server-host:log')({ payload: 'line' });
    listeners.get('server-host:status')({ payload: { running: true } });

    expect(log).toHaveBeenCalledWith('line');
    expect(status).toHaveBeenCalledWith({ running: true });
  });
});

describe('红石与 EnderLink 桥接', () => {
  it('红石命令透传', async () => {
    const { bridge } = await loadBridge();
    bridge.redstoneOnline.getServers();
    bridge.redstoneOnline.scanPort();
    bridge.redstoneOnline.start({ a: 1 });
    bridge.redstoneOnline.stop();
    bridge.redstoneOnline.getStatus();
    await flush();

    expect(getCommandCalls().map((call) => call.cmd)).toEqual([
      'redstone_servers',
      'redstone_scan_port',
      'redstone_start',
      'redstone_stop',
      'redstone_status',
    ]);
  });

  it('红石事件按载荷类型转换并可统一移除', async () => {
    const { bridge } = await loadBridge();
    const listeners = captureEvents();
    const log = vi.fn();
    const disconnected = vi.fn();
    const reconnecting = vi.fn();
    const reconnected = vi.fn();

    bridge.redstoneOnline.onLog(log);
    bridge.redstoneOnline.onDisconnected(disconnected);
    bridge.redstoneOnline.onReconnecting(reconnecting);
    bridge.redstoneOnline.onReconnected(reconnected);
    await flush();

    listeners.get('redstone:log')({ payload: 'raw-line' });
    listeners.get('redstone:log')({ payload: { message: 'obj-line' } });
    listeners.get('redstone:disconnected')({ payload: {} });
    listeners.get('redstone:reconnecting')({ payload: { attempt: 2 } });
    listeners.get('redstone:reconnected')({ payload: null });

    expect(log).toHaveBeenNthCalledWith(1, 'raw-line');
    expect(log).toHaveBeenNthCalledWith(2, 'obj-line');
    expect(disconnected).toHaveBeenCalledWith(undefined);
    expect(reconnecting).toHaveBeenCalledWith({ attempt: 2 });
    expect(reconnected).toHaveBeenCalledWith({});

    expect(() => bridge.redstoneOnline.removeListeners()).not.toThrow();
  });

  it('EnderLink 命令与事件透传', async () => {
    const { bridge } = await loadBridge();
    const listeners = captureEvents();
    const log = vi.fn();
    const disconnected = vi.fn();

    bridge.enderlinkOnline.getRooms();
    bridge.enderlinkOnline.getNodes();
    bridge.enderlinkOnline.download();
    bridge.enderlinkOnline.start({ localPort: 25565 });
    bridge.enderlinkOnline.stop();
    bridge.enderlinkOnline.getStatus();
    bridge.enderlinkOnline.onLog(log);
    bridge.enderlinkOnline.onDisconnected(disconnected);
    await flush();

    expect(getCommandCalls().map((call) => call.cmd)).toEqual([
      'enderlink_rooms',
      'enderlink_nodes',
      'enderlink_download',
      'enderlink_start',
      'enderlink_stop',
      'enderlink_status',
    ]);

    listeners.get('enderlink:log')({ payload: { message: 'hello', ts: 1 } });
    listeners.get('enderlink:disconnected')({ payload: {} });
    expect(log).toHaveBeenCalledWith({ message: 'hello', ts: 1 });
    expect(disconnected).toHaveBeenCalledWith(undefined);

    expect(() => bridge.redstoneOnline.removeListeners()).not.toThrow();
  });
});

describe('剪贴板', () => {
  it('优先调用 Web Clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { bridge } = await loadBridge();

    await bridge.clipboard.writeText('hello');

    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('剪贴板不可用时安全降级', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const { bridge } = await loadBridge();

    await expect(bridge.clipboard.writeText('hello')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
