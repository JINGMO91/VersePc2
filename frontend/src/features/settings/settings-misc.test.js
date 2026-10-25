// @vitest-environment jsdom
// settings-misc.test.js — 设置页杂项（内存、导入导出、截图、头像/背景）单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiCalls, getCommandCalls, installTauriMock, mockApiRoute, mockCommand } from '../../test-utils/tauri-mock.js';

let mod;
let bridge;

function buildDom() {
  document.body.innerHTML = `
    <div id="memory-usage-bar"></div>
    <div id="memory-usage-text"></div>
    <div id="memory-detail-text"></div>
    <button id="memory-optimize-btn"></button>
    <div id="toast-container"></div>
    <div id="screenshot-modal" style="display:none"><div id="screenshot-grid"></div></div>
    <div id="bg-image-preview" style="display:none"></div>
    <div id="bg-image-placeholder"></div>
    <div id="avatar-preview" style="display:none"></div>
    <div id="avatar-placeholder"></div>
    <div id="home-avatar"></div>
    <div id="launch-avatar"></div>
    <div id="bg-image-input"></div>
    <input id="avatar-input" type="file" />
    <input id="setting-java-path" />
    <input id="setting-data-dir" />
    <div id="updater-version-info"></div>
  `;
}

beforeAll(async () => {
  installTauriMock();
  document.body.innerHTML = '<div id="updater-version-info"></div>';
  vi.resetModules();
  bridge = (await import('../../core/tauri-bridge.js')).bridge;
  mod = await import('./settings-misc.js');
  await new Promise((resolve) => setTimeout(resolve, 10));
});

beforeEach(() => {
  installTauriMock();
  buildDom();
  mockApiRoute('/api/system/memory-info', { loadPercent: 50, used: 1024 * 1024 * 1024, total: 2 * 1024 * 1024 * 1024 });
  mockApiRoute('/api/memory-optimize', { success: true, freedMB: 128, afterMB: 512 });
  mockApiRoute('/api/create-shortcut', { success: true });
  mockApiRoute('/api/screenshots', { screenshots: [] });
  mockApiRoute('/api/save-background', { ok: true });
  mockApiRoute('/api/save-avatar', { ok: true });
  mockApiRoute('/api/clear-background', { ok: true });
  mockApiRoute('/api/clear-avatar', { ok: true });
  mockApiRoute('/api/settings/data-dir', { dataDir: 'E:/data' });
  mockApiRoute('/api/accounts', []);
  mockApiRoute('/api/settings', {});
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:mock') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('refreshMemoryInfo', () => {
  it('写入占用比例与详情', async () => {
    await mod.refreshMemoryInfo();
    expect(document.getElementById('memory-usage-bar').style.width).toBe('50%');
    expect(document.getElementById('memory-usage-text').textContent).toBe('50%');
    expect(document.getElementById('memory-detail-text').textContent).toBe('1.00 GB / 2.00 GB');
    expect(document.getElementById('memory-usage-bar').style.background).toBe('var(--accent)');
  });

  it('高占用进度条变红、中高变橙', async () => {
    mockApiRoute('/api/system/memory-info', { loadPercent: 90, used: 100, total: 200 });
    await mod.refreshMemoryInfo();
    expect(document.getElementById('memory-usage-bar').style.background).toBe('rgb(239, 68, 68)');

    mockApiRoute('/api/system/memory-info', { loadPercent: 75, used: 100, total: 200 });
    await mod.refreshMemoryInfo();
    expect(document.getElementById('memory-usage-bar').style.background).toBe('rgb(245, 158, 11)');
  });

  it('返回错误或接口异常时保持原状', async () => {
    mockApiRoute('/api/system/memory-info', { error: 'unsupported' });
    await expect(mod.refreshMemoryInfo()).resolves.toBeUndefined();
    expect(document.getElementById('memory-usage-text').textContent).toBe('');

    mockApiRoute('/api/system/memory-info', { status: 500, body: {} });
    await expect(mod.refreshMemoryInfo()).resolves.toBeUndefined();
  });
});

describe('doMemoryOptimize', () => {
  it('成功时提示释放量与可用内存', async () => {
    await mod.doMemoryOptimize();
    const text = document.getElementById('toast-container').textContent;
    expect(text).toContain('释放了 128 MB');
    expect(text).toContain('当前可用 512 MB');
    expect(document.getElementById('memory-optimize-btn').disabled).toBe(false);
    expect(document.getElementById('memory-optimize-btn').textContent).toBe('内存优化');
  });

  it('未释放内存时使用通用文案', async () => {
    mockApiRoute('/api/memory-optimize', { success: true, freedMB: 0, afterMB: 300 });
    await mod.doMemoryOptimize();
    expect(document.getElementById('toast-container').textContent).toContain('内存已优化');
  });

  it('优化返回失败时展示错误', async () => {
    mockApiRoute('/api/memory-optimize', { success: false, error: '权限不足' });
    await mod.doMemoryOptimize();
    expect(document.getElementById('toast-container').textContent).toContain('内存优化失败: 权限不足');
  });

  it('请求异常时提示并恢复按钮', async () => {
    mockApiRoute('/api/memory-optimize', { status: 500, body: {} });
    await mod.doMemoryOptimize();
    expect(document.getElementById('toast-container').textContent).toContain('内存优化失败');
    expect(document.getElementById('memory-optimize-btn').disabled).toBe(false);
  });

  it('并发调用时提示进行中', async () => {
    let resolveOptimize;
    mockApiRoute('/api/memory-optimize', () => new Promise((resolve) => { resolveOptimize = resolve; }));
    const first = mod.doMemoryOptimize();
    await vi.waitFor(() => expect(resolveOptimize).toBeTruthy());

    await mod.doMemoryOptimize();
    expect(document.getElementById('toast-container').textContent).toContain('内存优化正在进行中');

    resolveOptimize({ success: true, freedMB: 10, afterMB: 100 });
    await first;
  });
});

describe('exportSettings / importSettings', () => {
  it('导出三类设置并触发下载', async () => {
    mockCommand('store_get', ({ key }) => `raw-${key}`);

    await mod.exportSettings();

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(document.getElementById('toast-container').textContent).toContain('设置已导出');
  });

  it('导出异常时提示失败', async () => {
    mockCommand('store_get', () => { throw new Error('store down'); });
    await mod.exportSettings();
    expect(document.getElementById('toast-container').textContent).toContain('导出失败: store down');
  });

  it('导入有效设置文件写回三类配置', async () => {
    let createdInput = null;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () { createdInput = this; });
    mod.importSettings();
    const file = {
      text: async () => JSON.stringify({
        launch: JSON.stringify({ a: 1 }),
        personalize: JSON.stringify({ b: 2 }),
        other: JSON.stringify({ c: 3 }),
      }),
    };

    await createdInput.onchange({ target: { files: [file] } });

    const sets = getCommandCalls().filter((c) => c.cmd === 'store_set');
    expect(sets.map((c) => c.args.key)).toEqual([
      'versepc_launch_settings',
      'versepc_personalize_settings',
      'versepc_other_settings',
    ]);
    expect(document.getElementById('toast-container').textContent).toContain('设置已导入');
  });

  it('导入无效文件时提示失败', async () => {
    let createdInput = null;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () { createdInput = this; });
    mod.importSettings();
    const file = { text: async () => '{bad' };

    await createdInput.onchange({ target: { files: [file] } });

    expect(document.getElementById('toast-container').textContent).toContain('导入失败: 无效的设置文件');
  });

  it('未选择文件时直接返回', async () => {
    let createdInput = null;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () { createdInput = this; });
    mod.importSettings();
    await createdInput.onchange({ target: { files: [] } });
    expect(getCommandCalls().some((c) => c.cmd === 'store_set')).toBe(false);
  });
});

describe('createDesktopShortcut / openScreenshots', () => {
  it('创建快捷方式成功与失败', async () => {
    await mod.createDesktopShortcut();
    expect(document.getElementById('toast-container').textContent).toContain('桌面快捷方式已创建');

    mockApiRoute('/api/create-shortcut', { success: false });
    await mod.createDesktopShortcut();
    expect(document.getElementById('toast-container').textContent).toContain('创建失败');
  });

  it('创建快捷方式异常时提示', async () => {
    mockApiRoute('/api/create-shortcut', { status: 500, body: {} });
    await mod.createDesktopShortcut();
    expect(document.getElementById('toast-container').textContent).toContain('创建失败');
  });

  it('打开截图弹窗并渲染截图列表', async () => {
    mockApiRoute('/api/screenshots', { screenshots: [{ url: 'https://shot/1.png', name: 'shot1' }] });

    await mod.openScreenshots('1.20.1');

    expect(document.getElementById('screenshot-modal').style.display).toBe('flex');
    const grid = document.getElementById('screenshot-grid');
    expect(grid.querySelectorAll('img').length).toBe(1);
    expect(grid.textContent).toContain('shot1');
    expect(getApiCalls().find((c) => c.path === '/api/screenshots').args.params.versionId).toBe('1.20.1');
  });

  it('无截图时展示空态', async () => {
    await mod.openScreenshots('1.20.1');
    expect(document.getElementById('screenshot-grid').textContent).toContain('暂无截图');
  });

  it('截图接口失败时展示失败文案并可关闭弹窗', async () => {
    mockApiRoute('/api/screenshots', { status: 500, body: {} });
    await mod.openScreenshots('1.20.1');
    expect(document.getElementById('screenshot-grid').textContent).toContain('加载失败');

    mod.closeScreenshotModal();
    expect(document.getElementById('screenshot-modal').style.display).toBe('none');
  });
});

describe('图片上传与清除', () => {
  it('uploadImage 点击对应文件输入框', () => {
    const bg = document.getElementById('bg-image-input');
    const clickSpy = vi.spyOn(bg, 'click');
    mod.uploadImage('background');
    expect(clickSpy).toHaveBeenCalled();

    const avatar = document.getElementById('avatar-input');
    const avatarSpy = vi.spyOn(avatar, 'click');
    mod.uploadImage('avatar');
    expect(avatarSpy).toHaveBeenCalled();
  });

  it('背景图片上传成功后更新预览与全局背景', async () => {
    vi.stubGlobal('FileReader', class {
      readAsDataURL() {
        this.result = 'data:image/png;base64,AAA';
        this.onload({ target: { result: this.result } });
      }
    });

    mod.handleImageUpload({ files: [{ name: 'bg.png' }] }, 'background');
    await vi.waitFor(() => {
      expect(document.getElementById('bg-image-preview').style.display).toBe('block');
    });
    expect(document.getElementById('bg-image-placeholder').style.display).toBe('none');
    expect(document.body.style.getPropertyValue('--bg-image')).toContain('data:image/png');
    expect(document.getElementById('toast-container').textContent).toContain('背景图片已更新');
  });

  it('头像上传成功后同步主页与启动页头像', async () => {
    vi.stubGlobal('FileReader', class {
      readAsDataURL() {
        this.result = 'data:image/png;base64,BBB';
        this.onload({ target: { result: this.result } });
      }
    });

    mod.handleImageUpload({ files: [{ name: 'avatar.png' }] }, 'avatar');
    await vi.waitFor(() => {
      expect(document.getElementById('home-avatar').innerHTML).toContain('data:image/png');
    });
    expect(document.getElementById('launch-avatar').innerHTML).toContain('data:image/png');
    expect(document.getElementById('toast-container').textContent).toContain('头像已更新');
  });

  it('图片保存失败时提示', async () => {
    vi.stubGlobal('FileReader', class {
      readAsDataURL() {
        this.result = 'data:image/png;base64,CCC';
        this.onload({ target: { result: this.result } });
      }
    });
    mockApiRoute('/api/save-background', { status: 500, body: {} });

    mod.handleImageUpload({ files: [{ name: 'bg.png' }] }, 'background');
    await vi.waitFor(() => {
      expect(document.getElementById('toast-container').textContent).toContain('图片保存失败');
    });
  });

  it('未选择图片时不上传', () => {
    mod.handleImageUpload({ files: [] }, 'background');
    expect(getApiCalls().some((c) => c.path === '/api/save-background')).toBe(false);
  });

  it('清除背景图片恢复占位', async () => {
    document.getElementById('bg-image-preview').style.display = 'block';
    await mod.clearImage('background');
    await vi.waitFor(() => {
      expect(document.getElementById('bg-image-placeholder').style.display).toBe('flex');
    });
    expect(document.getElementById('bg-image-preview').style.display).toBe('none');
    expect(document.getElementById('toast-container').textContent).toContain('背景图片已清除');
  });

  it('清除图片失败时提示', async () => {
    mockApiRoute('/api/clear-background', { status: 500, body: {} });
    await mod.clearImage('background');
    await vi.waitFor(() => {
      expect(document.getElementById('toast-container').textContent).toContain('清除失败');
    });
  });

  it('恢复默认背景', async () => {
    await mod.useDefaultImage('background');
    await vi.waitFor(() => {
      expect(document.getElementById('toast-container').textContent).toContain('已恢复默认背景');
    });
    expect(document.body.style.getPropertyValue('--bg-image')).toBe('');
  });
});

describe('browseJavaPath', () => {
  it('选择文件后写入 Java 路径', async () => {
    mockCommand('dialog_open', () => ({ canceled: false, filePaths: ['C:/Java/bin/java.exe'] }));
    mod.browseJavaPath();
    await vi.waitFor(() => {
      expect(document.getElementById('setting-java-path').value).toBe('C:/Java/bin/java.exe');
    });
  });

  it('取消选择不修改路径', async () => {
    mockCommand('dialog_open', () => ({ canceled: true, filePaths: [] }));
    mod.browseJavaPath();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.getElementById('setting-java-path').value).toBe('');
  });

  it('无对话框能力时提示手动输入', () => {
    const original = bridge.showOpenDialog;
    bridge.showOpenDialog = undefined;
    try {
      mod.browseJavaPath();
      expect(document.getElementById('toast-container').textContent).toContain('请手动输入 Java 路径');
    } finally {
      bridge.showOpenDialog = original;
    }
  });
});

describe('checkForUpdates', () => {
  it('提示检查中并触发更新检查', () => {
    mod.checkForUpdates();
    expect(document.getElementById('toast-container').textContent).toContain('正在检查更新');
    return vi.waitFor(() => {
      expect(getCommandCalls().some((c) => c.cmd === 'updater_check_for_updates')).toBe(true);
    });
  });
});
