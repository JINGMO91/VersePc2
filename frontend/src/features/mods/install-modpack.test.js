// @vitest-environment jsdom
// install-modpack.test.js — 整合包命名、下载与安装进度单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiCalls, installTauriMock, mockApiRoute, mockCommand } from '../../test-utils/tauri-mock.js';

let mod;
let dlManager;
let appState;
let modDetailState;
const listeners = {};

function buildDom() {
  document.body.innerHTML = `
    <div id="toast-container"></div>
    <div id="download-queue-list"></div>
    <div id="dl-fab"><span id="dl-fab-badge"></span></div>
    <div class="card" id="mdvg-0"></div>
  `;
}

function findTask(idPrefix) {
  return [...dlManager.tasks.values()].find((t) => t.id.startsWith(idPrefix));
}

beforeAll(async () => {
  installTauriMock();
  vi.resetModules();
  dlManager = (await import('../versions/custom-download.js')).dlManager;
  appState = (await import('../../core/app-state.js')).appState;
  modDetailState = (await import('./detail-state.js')).modDetailState;
  mod = await import('./install-modpack.js');
});

beforeEach(() => {
  installTauriMock({
    commands: {
      select_folder: () => ({ cancelled: false, path: 'D:/modpacks' }),
      get_default_mod_path: () => null,
    },
  });
  window.__TAURI_INTERNALS__.listen = async (name, cb) => {
    listeners[name] = cb;
    return () => {};
  };
  buildDom();
  dlManager.tasks.clear();
  dlManager.order = [];
  appState.modDownloadPollTimers.forEach((t) => clearTimeout(t));
  appState.modDownloadPollTimers = [];
  appState.currentModDetailId = 'proj-1';
  appState.currentModDetailSource = 'modrinth';
  modDetailState.data = { id: 'proj-1', title: 'Awesome Pack', icon: 'https://icon/p.png' };
  mockApiRoute('/api/check-version-name', { available: true });
  mockApiRoute('/api/versions', { versions: [], installed: [] });
  mockApiRoute('/api/resources/download', { success: true, fileName: 'pack.mrpack', sessionId: 'sess-1' });
  mockApiRoute('/api/mods/download-status', { status: 'completed', progress: 100 });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  appState.modDownloadPollTimers.forEach((t) => clearTimeout(t));
  appState.modDownloadPollTimers = [];
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('getDownloadStageText / getLoaderFileIcon', () => {
  it('按状态与阶段返回可读文案', () => {
    expect(mod.getDownloadStageText(null)).toBe('准备中...');
    expect(mod.getDownloadStageText({ status: 'completed' })).toBe('安装完成');
    expect(mod.getDownloadStageText({ status: 'failed', message: '失败原因' })).toBe('失败原因');
    expect(mod.getDownloadStageText({ status: 'cancelled' })).toBe('已取消');
    expect(mod.getDownloadStageText({ message: '自定义消息' })).toBe('自定义消息');
    expect(mod.getDownloadStageText({ phase: 'download' })).toBe('下载整合包文件...');
    expect(mod.getDownloadStageText({ phase: 'loader-install' })).toBe('正在安装模组加载器...');
    expect(mod.getDownloadStageText({ phase: 'download-mods' })).toBe('下载整合包模组...');
    expect(mod.getDownloadStageText({ phase: 'verify' })).toBe('正在验证整合包完整性...');
    expect(mod.getDownloadStageText({ phase: 'importing' })).toBe('正在安装整合包...');
    expect(mod.getDownloadStageText({ phase: 'unknown' })).toBe('处理中...');
  });

  it('按文件名选择加载器图标', () => {
    expect(mod.getLoaderFileIcon('fabric-api.jar')).toContain('Fabric.png');
    expect(mod.getLoaderFileIcon('neoFORGE.jar')).toContain('NeoForge.png');
    expect(mod.getLoaderFileIcon('forge-core.jar')).toContain('Anvil.png');
    expect(mod.getLoaderFileIcon('optifine.jar')).toContain('OptiFabric.png');
    expect(mod.getLoaderFileIcon('random.jar')).toContain('Grass.png');
  });
});

describe('toggleMdvGroup', () => {
  it('切换分组展开状态', () => {
    const group = document.getElementById('mdvg-0');
    mod.toggleMdvGroup(0);
    expect(group.classList.contains('expanded')).toBe(true);
    mod.toggleMdvGroup(0);
    expect(group.classList.contains('expanded')).toBe(false);
  });
});

describe('showModpackNameModal', () => {
  it('使用详情标题作为默认名称', () => {
    mod.showModpackNameModal('Awesome Pack', 'proj-1', 'v1');
    expect(document.getElementById('mpnm-input').value).toBe('Awesome Pack');
  });

  it('取消与关闭按钮移除弹窗', () => {
    mod.showModpackNameModal('Pack', 'proj-1', 'v1');
    document.getElementById('mpnm-cancel').click();
    expect(document.querySelector('.modal-overlay')).toBeNull();

    mod.showModpackNameModal('Pack', 'proj-1', 'v1');
    document.getElementById('mpnm-close').click();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('空名称时禁用确认', async () => {
    mod.showModpackNameModal('Pack', 'proj-1', 'v1');
    const input = document.getElementById('mpnm-input');
    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      expect(document.getElementById('mpnm-confirm').disabled).toBe(true);
    });
  });

  it('名称不可用时展示警告', async () => {
    mockApiRoute('/api/check-version-name', { available: false, reason: '已存在' });
    mod.showModpackNameModal('Pack', 'proj-1', 'v1');
    const input = document.getElementById('mpnm-input');
    input.value = 'dup';
    input.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      expect(document.getElementById('mpnm-warn').textContent).toContain('已存在');
      expect(document.getElementById('mpnm-confirm').disabled).toBe(true);
    });
  });

  it('名称检查异常时允许继续', async () => {
    mockApiRoute('/api/check-version-name', { status: 500, body: {} });
    mod.showModpackNameModal('Pack', 'proj-1', 'v1');
    await vi.waitFor(() => {
      expect(document.getElementById('mpnm-confirm').disabled).toBe(false);
    });
  });

  it('确认后下载整合包并创建安装任务', async () => {
    mod.showModpackNameModal('Pack', 'proj-1', 'v1');
    await vi.waitFor(() => {
      expect(document.getElementById('mpnm-confirm').disabled).toBe(false);
    });
    document.getElementById('mpnm-confirm').click();

    await vi.waitFor(() => {
      const call = getApiCalls().find((c) => c.path === '/api/resources/download');
      expect(call).toBeTruthy();
      expect(call.args.body).toMatchObject({
        versionId: 'v1',
        projectId: 'proj-1',
        projectType: 'modpack',
        customName: 'Pack',
        source: 'modrinth',
      });
    });
    await vi.waitFor(() => {
      expect(findTask('modpack-sess-1')).toBeTruthy();
    });
  });
});

describe('installModpackVersion / quickInstallModpack', () => {
  it('使用详情标题作为默认名称并打开弹窗', async () => {
    await mod.installModpackVersion('proj-1', 'v1');
    expect(document.getElementById('mpnm-input').value).toBe('Awesome Pack');
  });

  it('无详情数据时回退到项目 ID', async () => {
    modDetailState.data = null;
    await mod.quickInstallModpack('proj-9', 'v9');
    expect(document.getElementById('mpnm-input').value).toBe('proj-9');
  });

  it('installModpackVersionSafe 解码版本 ID', () => {
    const el = document.createElement('div');
    el.dataset.vid = btoa(encodeURIComponent('v-2'));
    mod.installModpackVersionSafe(el);
    expect(document.getElementById('mpnm-input').value).toBe('Awesome Pack');
  });

  it('installModpackVersionSafe 空元素安全返回', () => {
    expect(() => mod.installModpackVersionSafe(null)).not.toThrow();
  });
});

describe('_doInstallModpack', () => {
  it('下载失败时提示后端错误', async () => {
    mockApiRoute('/api/resources/download', { success: false, error: '镜像不可用' });
    await mod._doInstallModpack('proj-1', 'v1', 'Pack');
    expect(document.getElementById('toast-container').textContent).toContain('整合包安装失败: 镜像不可用');
  });

  it('请求异常时提示', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApiRoute('/api/resources/download', { status: 500, body: {} });
    await mod._doInstallModpack('proj-1', 'v1', 'Pack');
    expect(document.getElementById('toast-container').textContent).toContain('整合包安装失败');
  });
});

describe('showModpackInstallModal 轮询与事件', () => {
  it('轮询完成时提示并刷新版本列表', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/mods/download-status', { status: 'completed', progress: 100, phase: 'install' });

    mod.showModpackInstallModal('pack.mrpack', 'sess-1');
    expect(findTask('modpack-sess-1')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(400);

    expect(findTask('modpack-sess-1').status).toBe('completed');
    expect(document.getElementById('toast-container').textContent).toContain('整合包安装完成');
    expect(getApiCalls().some((c) => c.path === '/api/versions')).toBe(true);
  });

  it('导入阶段轮询不覆盖事件进度', async () => {
    vi.useFakeTimers();
    let count = 0;
    mockApiRoute('/api/mods/download-status', () => {
      count++;
      return count === 1
        ? { status: 'downloading', progress: 5, phase: 'importing' }
        : { status: 'completed' };
    });

    mod.showModpackInstallModal('pack.mrpack', 'sess-2');
    const cb = listeners['import-progress'];
    cb({
      payload: {
        message: '下载整合包模组',
        progress: 35,
        stage: 'download-mods',
        files: [{ filename: 'b.jar', size: 2048 }],
        currentFile: 'b.jar',
      },
    });

    await vi.waitFor(() => {
      const task = findTask('modpack-sess-2');
      expect(task.progress).toBe(35);
      expect(task.message).toBe('下载整合包模组');
      expect(task.files[0].name).toBe('b.jar');
      expect(task.files[0].size).toBe('2.0 KB');
      expect(task.stageHistory.some((s) => s.stage === 'download-mods')).toBe(true);
    });

    await vi.advanceTimersByTimeAsync(400);
    const task = findTask('modpack-sess-2');
    expect(task.progress).toBe(35);
    expect(task.message).toBe('下载整合包模组');

    await vi.advanceTimersByTimeAsync(600);
    expect(task.status).toBe('completed');
  });

  it('下载阶段使用轮询进度与文件列表', async () => {
    vi.useFakeTimers();
    let count = 0;
    mockApiRoute('/api/mods/download-status', () => {
      count++;
      return count === 1
        ? { status: 'downloading', progress: 40, phase: 'download-mods', files: [{ name: 'a.jar', size: 1024, status: 'downloading' }] }
        : { status: 'completed' };
    });

    mod.showModpackInstallModal('pack.mrpack', 'sess-3');
    await vi.advanceTimersByTimeAsync(400);

    const task = findTask('modpack-sess-3');
    expect(task.progress).toBe(40);
    expect(task.message).toBe('下载整合包模组...');
    expect(task.files[0].size).toBe('1.0 KB');
  });

  it('安装失败时提示并结束任务', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/mods/download-status', { status: 'failed', message: '解压失败' });

    mod.showModpackInstallModal('pack.mrpack', 'sess-4');
    await vi.advanceTimersByTimeAsync(400);

    expect(findTask('modpack-sess-4').status).toBe('failed');
    expect(document.getElementById('toast-container').textContent).toContain('安装失败: 解压失败');
  });

  it('取消时标记失败', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/mods/download-status', { status: 'cancelled', message: '用户取消' });

    mod.showModpackInstallModal('pack.mrpack', 'sess-5');
    await vi.advanceTimersByTimeAsync(400);

    expect(findTask('modpack-sess-5').status).toBe('failed');
    expect(findTask('modpack-sess-5').message).toBe('已取消');
  });

  it('会话连续未知后标记失效', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/mods/download-status', {});

    mod.showModpackInstallModal('pack.mrpack', 'sess-6');
    await vi.advanceTimersByTimeAsync(300 + 3000 + 100);

    expect(findTask('modpack-sess-6').status).toBe('failed');
    expect(findTask('modpack-sess-6').message).toBe('会话已失效');
  });

  it('后端返回阶段历史时同步到任务', async () => {
    vi.useFakeTimers();
    let count = 0;
    mockApiRoute('/api/mods/download-status', () => {
      count++;
      return count === 1
        ? { status: 'downloading', progress: 30, phase: 'overrides', stageHistory: [{ stage: 'overrides', progress: 30, message: '解压整合包配置...' }] }
        : { status: 'completed' };
    });

    mod.showModpackInstallModal('pack.mrpack', 'sess-7');
    await vi.advanceTimersByTimeAsync(400);

    expect(findTask('modpack-sess-7').stageHistory).toEqual([
      { stage: 'overrides', progress: 30, message: '解压整合包配置...' },
    ]);
  });
});

describe('quickInstallResourceVersion', () => {
  let bridge;
  let originalSelectSaveFolder;

  beforeAll(async () => {
    bridge = (await import('../../core/tauri-bridge.js')).bridge;
  });

  beforeEach(() => {
    originalSelectSaveFolder = bridge.selectSaveFolder;
  });

  afterEach(() => {
    bridge.selectSaveFolder = originalSelectSaveFolder;
  });

  it('浏览器回退路径取消选择且带错误时提示', async () => {
    bridge.selectSaveFolder = undefined;
    mockApiRoute('/api/mods/select-save-folder', { cancelled: true, error: '无权限' });
    await mod.quickInstallResourceVersion('p1', 'resourcepack', 'v1');
    expect(document.getElementById('toast-container').textContent).toContain('文件夹选择失败: 无权限');
  });

  it('取消选择文件夹时静默返回', async () => {
    mockCommand('select_folder', () => ({ cancelled: true }));
    await mod.quickInstallResourceVersion('p1', 'shader', 'v1');
    expect(getApiCalls().some((c) => c.path === '/api/resources/download')).toBe(false);
  });

  it('浏览器回退路径未选择路径时提示', async () => {
    bridge.selectSaveFolder = undefined;
    mockApiRoute('/api/mods/select-save-folder', { cancelled: false, path: '' });
    await mod.quickInstallResourceVersion('p1', 'datapack', 'v1');
    expect(document.getElementById('toast-container').textContent).toContain('未选择文件夹');
  });

  it('成功时下载并记录保存路径', async () => {
    mockCommand('select_folder', () => ({ cancelled: false, path: 'D:/resourcepacks' }));
    await mod.quickInstallResourceVersion('p1', 'resourcepack', 'v1');

    const call = getApiCalls().find((c) => c.path === '/api/resources/download');
    expect(call.args.body).toMatchObject({
      versionId: 'v1', projectId: 'p1', projectType: 'resourcepack', savePath: 'D:/resourcepacks',
    });
    expect(localStorage.getItem('lastResourceSavePath_resourcepack')).toBe('D:/resourcepacks');
    expect(document.getElementById('toast-container').textContent).toContain('正在安装材质包');
    await vi.waitFor(() => {
      expect(dlManager.tasks.has('mod-sess-1')).toBe(true);
    });
  });

  it('下载失败时提示后端错误', async () => {
    mockCommand('select_folder', () => ({ cancelled: false, path: 'D:/shaders' }));
    mockApiRoute('/api/resources/download', { success: false, error: '源不可用' });
    await mod.quickInstallResourceVersion('p1', 'shader', 'v1');
    expect(document.getElementById('toast-container').textContent).toContain('源不可用');
  });

  it('请求异常时提示安装失败', async () => {
    mockCommand('select_folder', () => ({ cancelled: false, path: 'D:/packs' }));
    mockApiRoute('/api/resources/download', { status: 500, body: {} });
    await mod.quickInstallResourceVersion('p1', 'resourcepack', 'v1');
    expect(document.getElementById('toast-container').textContent).toContain('安装失败');
  });
});
