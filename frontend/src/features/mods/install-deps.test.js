// @vitest-environment jsdom
// install-deps.test.js — 前置依赖弹窗、版本选择与下载编排单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiCalls, installTauriMock, mockApiRoute } from '../../test-utils/tauri-mock.js';

let mod;
let dlManager;
let appState;
let modDetailState;
let mdState;
let installState;

const VERSIONS = [
  {
    versionId: 'v1',
    versionNumber: '1.0.0',
    gameVersions: ['1.20.1', '1.20.2', '1.20.3', '1.20.4'],
    loaders: ['Fabric', 'Forge'],
    datePublished: '2024-05-01T00:00:00Z',
    files: [{ filename: 'dep-1.0.0.jar', size: 2048, primary: true, url: 'https://example.com/dep.jar' }],
  },
  {
    versionId: 'v2',
    versionNumber: '0.9.0',
    gameVersions: ['1.20.1'],
    loaders: ['Fabric'],
    files: [],
  },
];

function dom() {
  document.body.innerHTML = '<div id="toast-container"></div><div id="download-queue-list"></div><div id="dl-fab"></div>';
}

function findTask(name) {
  return [...dlManager.tasks.values()].find((t) => t.name === name);
}

beforeAll(async () => {
  installTauriMock();
  vi.resetModules();
  installState = await import('./install-state.js');
  modDetailState = (await import('./detail-state.js')).modDetailState;
  mdState = (await import('./mod-detail-state.js')).S;
  dlManager = (await import('../versions/custom-download.js')).dlManager;
  appState = (await import('../../core/app-state.js')).appState;
  mod = await import('./install-deps.js');
});

beforeEach(() => {
  installTauriMock();
  dom();
  dlManager.tasks.clear();
  dlManager.order = [];
  dlManager._searchQuery = '';
  modDetailState.data = null;
  modDetailState.allVersions = [];
  mdState.mdDepsCache.clear();
  installState.S._mdSaveGame = '';
  installState.S._mdSaveLoader = '';
  appState.installedVersions = [];
  mockApiRoute('/api/mods/download-status', { status: 'completed', progress: 100 });
});

afterEach(() => {
  appState.modDownloadPollTimers.forEach((t) => clearTimeout(t));
  appState.modDownloadPollTimers = [];
  dlManager.tasks.clear();
  dlManager.order = [];
  document.body.innerHTML = '';
});

describe('showDependencyDialog', () => {
  const deps = [
    { projectId: 'p1', title: 'Fabric API', compatibleVersion: { versionNumber: '0.15.0' } },
    { projectId: 'p2', title: 'No Version', compatibleVersion: null },
  ];

  it('渲染依赖列表并区分可下载与缺失版本', () => {
    mod.showDependencyDialog('p1', 'modrinth', 'v1', 'f1', '/save', deps, '1.20.1', 'fabric');

    const modal = document.getElementById('mod-dependency-modal');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('检测到前置依赖');
    expect(modal.textContent).toContain('Fabric API');
    expect(modal.textContent).toContain('v0.15.0');
    expect(modal.textContent).toContain('未找到兼容版本');
    expect(document.getElementById('dep-download-btn').textContent).toContain('1 个前置');
    const buttons = modal.querySelectorAll('.dep-single-download-btn');
    expect(buttons.length).toBe(2);
    expect(buttons[1].getAttribute('style')).toContain('pointer-events:none');
  });

  it('取消按钮关闭弹窗', () => {
    mod.showDependencyDialog('p1', 'modrinth', 'v1', 'f1', '/save', deps, '1.20.1', 'fabric');
    document.getElementById('dep-cancel-btn').click();
    expect(document.getElementById('mod-dependency-modal')).toBeNull();
  });

  it('一键下载全部走下载编排', async () => {
    mockApiRoute('/api/mods/download-version', { success: true, fileName: 'dep.jar', sessionId: 's-main' });
    mod.showDependencyDialog('p1', 'modrinth', 'v1', 'f1', '/save', deps, '1.20.1', 'fabric');

    document.getElementById('dep-download-btn').click();

    await vi.waitFor(() => {
      const call = getApiCalls().find((c) => c.path === '/api/mods/download-version');
      expect(call).toBeTruthy();
      expect(call.args.body.versionId).toBe('v1');
      expect(call.args.body.fileId).toBe('f1');
      expect(call.args.body.includeDeps).toBe(false);
      expect(call.args.body.savePath).toBe('/save');
    });
  });

  it('单个依赖下载会打开版本选择弹窗', async () => {
    mockApiRoute('/api/mods/project-versions', { versions: VERSIONS });
    mod.showDependencyDialog('p1', 'modrinth', 'v1', 'f1', '/save', deps, '1.20.1', 'fabric');

    document.querySelector('.dep-single-download-btn').click();

    await vi.waitFor(() => {
      expect(document.getElementById('dep-ver-list').querySelectorAll('.ai-version-select-item').length).toBe(2);
    });
    expect(document.getElementById('mod-dependency-modal')).toBeNull();
  });
});

describe('loadDepVersions', () => {
  it('渲染版本元信息并在点击后下载所选版本', async () => {
    mockApiRoute('/api/mods/project-versions', { versions: VERSIONS });
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [] });
    mockApiRoute('/api/mods/download-version', { success: true, fileName: 'dep.jar', sessionId: 's-main' });

    mod.showDepVersionSelectModal('p1', 'modrinth', '1.20.1', 'fabric', '/save');

    await vi.waitFor(() => {
      expect(document.getElementById('dep-ver-count').textContent).toBe('2 个版本');
    });
    const items = document.querySelectorAll('.ai-version-select-item');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('.ai-version-select-loader.fabric')).toBeTruthy();
    expect(items[0].querySelector('.ai-version-select-loader.forge')).toBeTruthy();
    expect(items[0].textContent).toContain('1.20.1, 1.20.2, 1.20.3...');
    expect(items[0].textContent).toContain('2.0 KB');
    expect(items[0].dataset.downloadUrl).toBe('https://example.com/dep.jar');

    items[0].click();

    await vi.waitFor(() => {
      expect(findTask('前置模组')?.status).toBe('completed');
    });
    const call = getApiCalls().find((c) => c.path === '/api/mods/download-version');
    expect(call.args.body.versionId).toBe('v1');
    expect(call.args.body.includeDeps).toBe(false);
    expect(document.getElementById('dep-version-select-modal')).toBeNull();
  });

  it('无兼容版本时给出提示', async () => {
    mockApiRoute('/api/mods/project-versions', { versions: [] });
    mod.showDepVersionSelectModal('p1', 'modrinth', '1.20.1', 'fabric', '/save');

    await vi.waitFor(() => {
      expect(document.getElementById('dep-ver-list').textContent).toContain('未找到兼容的版本');
    });
    expect(document.getElementById('dep-ver-count').textContent).toBe('0 个版本');
  });

  it('接口失败时显示错误信息', async () => {
    mockApiRoute('/api/mods/project-versions', { status: 500, body: { error: 'network down' } });
    mod.showDepVersionSelectModal('p1', 'modrinth', '1.20.1', 'fabric', '/save');

    await vi.waitFor(() => {
      expect(document.getElementById('dep-ver-list').textContent).toContain('加载失败: network down');
    });
  });
});

describe('downloadDepWithNestedDeps', () => {
  const nested = {
    dependencies: [
      { projectId: 'np1', title: 'Nested Dep', depth: 1, compatibleVersion: { versionId: 'v2', versionNumber: '2.0.0' } },
    ],
  };

  it('取消嵌套依赖确认后任务标记失败且不下载', async () => {
    mockApiRoute('/api/mods/get-dependencies-recursive', nested);
    mockApiRoute('/api/mods/download-version', { success: true, fileName: 'dep.jar', sessionId: 's-main' });

    mod.downloadDepWithNestedDeps('p1', 'modrinth', 'v1', '/save', '1.20.1', 'fabric');

    await vi.waitFor(() => {
      expect(document.querySelector('button[id$="-cancel"]')).toBeTruthy();
    });
    document.querySelector('button[id$="-cancel"]').click();

    await vi.waitFor(() => {
      expect(findTask('前置模组')?.status).toBe('failed');
    });
    expect(findTask('前置模组').message).toBe('用户取消');
    expect(getApiCalls().some((c) => c.path === '/api/mods/download-version')).toBe(false);
  });

  it('确认后先下载主模组再下载嵌套依赖', async () => {
    mockApiRoute('/api/mods/get-dependencies-recursive', nested);
    mockApiRoute('/api/mods/download-version', { success: true, fileName: 'dep.jar', sessionId: 's-main' });

    mod.downloadDepWithNestedDeps('p1', 'modrinth', 'v1', '/save', '1.20.1', 'fabric');

    await vi.waitFor(() => {
      expect(document.querySelector('button[id$="-confirm"]')).toBeTruthy();
    });
    document.querySelector('button[id$="-confirm"]').click();

    await vi.waitFor(() => {
      const ids = getApiCalls()
        .filter((c) => c.path === '/api/mods/download-version')
        .map((c) => c.args.body.versionId);
      expect(ids).toEqual(['v1', 'v2']);
    });
    await vi.waitFor(() => {
      expect(findTask('前置模组')?.status).toBe('completed');
    });
    expect(document.getElementById('toast-container').textContent).toContain('前置模组下载完成: 1 个依赖');
  });

  it('主模组下载失败时任务标记失败', async () => {
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [] });
    mockApiRoute('/api/mods/download-version', { success: false, error: '磁盘已满' });

    await mod.downloadDepWithNestedDeps('p1', 'modrinth', 'v1', '/save', '1.20.1', 'fabric');

    expect(findTask('前置模组').status).toBe('failed');
    expect(findTask('前置模组').message).toBe('磁盘已满');
  });
});

describe('proceedModInstall', () => {
  it('下载成功后展示下载任务', async () => {
    mockApiRoute('/api/mods/download-version', { success: true, fileName: 'mod.jar', sessionId: 's1' });

    await mod.proceedModInstall('p1', 'modrinth', 'v1', 'f1', '/save', false, [], '1.20.1', 'fabric');

    expect(findTask('准备下载...')).toBeUndefined();
    expect(dlManager.tasks.has('mod-s1')).toBe(true);
    const call = getApiCalls().find((c) => c.path === '/api/mods/download-version');
    expect(call.args.body.projectId).toBe('p1');
  });

  it('下载失败时提示错误并标记任务失败', async () => {
    mockApiRoute('/api/mods/download-version', { success: false, error: '下载源不可用' });

    await mod.proceedModInstall('p1', 'modrinth', 'v1', 'f1', '/save', false, [], '1.20.1', 'fabric');

    expect(findTask('准备下载...').status).toBe('failed');
    expect(document.getElementById('toast-container').textContent).toContain('下载源不可用');
  });
});

describe('maybeShowPostInstallDeps', () => {
  function requiredDep() {
    return {
      dependencies: [
        { projectId: 'r1', title: 'Required Dep', compatibleVersion: { versionId: 'rv1', fileName: 'req.jar' } },
      ],
    };
  }

  it('列出必选前置并支持一键下载', async () => {
    mockApiRoute('/api/mods/get-dependencies-recursive', requiredDep());
    mockApiRoute('/api/mods/installed', []);
    mockApiRoute('/api/mods/download-version', { success: true, fileName: 'req.jar', sessionId: 's-req' });

    await mod.maybeShowPostInstallDeps('p1', 'modrinth', 'v1', '/save', '1.20.1', 'fabric', '');

    await vi.waitFor(() => {
      expect(document.getElementById('pi-dep-list')?.textContent).toContain('Required Dep');
    });
    expect(document.getElementById('pi-dep-list').textContent).toContain('必选');
    const downloadBtn = document.getElementById('pi-download');
    expect(downloadBtn.disabled).toBe(false);
    expect(downloadBtn.textContent).toBe('一键下载（1）');

    downloadBtn.click();

    await vi.waitFor(() => {
      const call = getApiCalls().find((c) => c.path === '/api/mods/download-version');
      expect(call).toBeTruthy();
      expect(call.args.body.versionId).toBe('rv1');
      expect(call.args.body.savePath).toBe('/save');
    });
    await vi.waitFor(() => {
      expect(document.getElementById('toast-container').textContent).toContain('已提交 1 个前置下载');
    });
    expect(document.getElementById('post-install-deps-modal')).toBeNull();
  });

  it('已安装的前置会被过滤掉', async () => {
    mockApiRoute('/api/mods/get-dependencies-recursive', requiredDep());
    mockApiRoute('/api/mods/installed', [{ id: 'r1', fileName: 'req.jar' }]);
    mockApiRoute('/api/mods', [{ id: 'r1', fileName: 'req.jar' }]);

    await mod.maybeShowPostInstallDeps('p1', 'modrinth', 'v1', '/save', '1.20.1', 'fabric', '');

    await vi.waitFor(() => {
      expect(document.getElementById('pi-loading').textContent).toContain('未检测到需要下载的前置');
    });
    expect(document.getElementById('pi-skip').textContent).toBe('知道了');
  });

  it('无可下载依赖时提示未检测到前置', async () => {
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [] });
    mockApiRoute('/api/mods/installed', []);

    await mod.maybeShowPostInstallDeps('p1', 'modrinth', 'v1', '/save', '1.20.1', 'fabric', '');

    await vi.waitFor(() => {
      expect(document.getElementById('pi-loading').textContent).toContain('未检测到需要下载的前置');
    });
  });

  it('可选前置支持勾选并随选中项下载', async () => {
    modDetailState.allVersions = [
      { id: 'v1', dependencies: [{ projectId: 'o1', dependencyType: 'optional' }] },
    ];
    mockApiRoute('/api/mods/get-dependencies-recursive', ({ body }) => (
      body.versionId === 'ov' ? { dependencies: [] } : { dependencies: [] }
    ));
    mockApiRoute('/api/mods/installed', []);
    mockApiRoute('/api/mods/resolve-deps-versions', {
      o1: { hasCompatibleVersion: true, versionId: 'ov', versionNumber: '3.0.0', fileName: 'opt.jar', title: 'Opt Dep' },
    });
    mockApiRoute('/api/mods/download-version', { success: true, fileName: 'opt.jar', sessionId: 's-opt' });

    await mod.maybeShowPostInstallDeps('p1', 'modrinth', 'v1', '/save', '1.20.1', 'fabric', '');

    await vi.waitFor(() => {
      expect(document.querySelector('.pi-optional')).toBeTruthy();
    });
    const checkbox = document.querySelector('.pi-optional');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const downloadBtn = document.getElementById('pi-download');
    expect(downloadBtn.textContent).toBe('一键下载（1）');
    downloadBtn.click();

    await vi.waitFor(() => {
      const call = getApiCalls().find((c) => c.path === '/api/mods/download-version');
      expect(call).toBeTruthy();
      expect(call.args.body.versionId).toBe('ov');
    });
    await vi.waitFor(() => {
      expect(document.getElementById('toast-container').textContent).toContain('已提交 1 个前置下载');
    });
  });
});
