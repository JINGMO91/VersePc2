// @vitest-environment jsdom
// mod-detail-deps.test.js — 模组前置依赖解析、渲染与一键下载单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiCalls, installTauriMock, mockApiRoute, mockCommand } from '../../test-utils/tauri-mock.js';

let mod;
let S;
let appState;
let modDetailState;

function buildDom() {
  document.body.innerHTML = `
    <div id="md-deps-section" style="display:none">
      <span id="md-deps-count"></span>
      <span id="md-deps-arrow"></span>
      <div id="md-deps-list"></div>
      <button id="md-deps-download-all-btn"></button>
    </div>
    <div id="toast-container"></div>
  `;
}

const DEP_VERSIONS = [
  { id: 'v-root', gameVersions: ['1.20.1'], loaders: ['fabric'], selectedVersionId: 'v-root', dependencies: [
    { projectId: 'fabric-api', dependencyType: 'required' },
    { projectId: 'cloth-config', dependencyType: 'optional' },
    { projectId: 'fabric-api', dependencyType: 'optional' },
    { dependencyType: 'required' },
  ] },
  { id: 'v-old', gameVersions: ['1.19.4'], loaders: ['forge'], dependencies: [{ projectId: 'old-dep', dependencyType: 'required' }] },
];

const RESOLVE_VERSIONS = {
  'fabric-api': { hasCompatibleVersion: true, versionId: 'fv', versionNumber: '0.92.0', fileName: 'fabric-api-0.92.0.jar', loaders: ['fabric'] },
  'cloth-config': { hasCompatibleVersion: false },
};

const RESOLVE_BASIC = {
  'fabric-api': { id: 'fabric-api', title: 'Fabric API', slug: 'fabric-api', icon: 'https://icon/f.png', description: 'API' },
  'cloth-config': { id: 'cloth-config', title: 'Cloth Config', slug: 'cloth-config', icon: '', description: 'Config' },
};

function makeInstalled(extra = []) {
  return [{ id: 'a1', fileName: 'fabric-api-0.92.0.jar' }, ...extra];
}

beforeAll(async () => {
  installTauriMock();
  vi.resetModules();
  S = (await import('./mod-detail-state.js')).S;
  appState = (await import('../../core/app-state.js')).appState;
  modDetailState = (await import('./detail-state.js')).modDetailState;
  mod = await import('./mod-detail-deps.js');
});

beforeEach(() => {
  installTauriMock({
    commands: {
      'mods_get_installed_version_info': () => null,
      select_folder: () => ({ cancelled: false, path: 'D:/mods' }),
      get_default_mod_path: () => null,
    },
  });
  buildDom();
  S.mdDepsCache.clear();
  modDetailState.data = null;
  modDetailState.deps = [];
  modDetailState.depsResolved = {};
  modDetailState.depsVersionInfo = {};
  modDetailState.allVersions = DEP_VERSIONS;
  appState.currentModDetailId = 'root-mod';
  appState.currentModDetailSource = 'modrinth';
  appState.installedVersions = [{ id: 'fabric-1.20.1', isFabric: true, baseVersion: '1.20.1' }];

  mockApiRoute('/api/settings', { selectedVersion: 'fabric-1.20.1' });
  mockApiRoute('/api/mods/resolve-deps-versions', RESOLVE_VERSIONS);
  mockApiRoute('/api/mods/resolve-deps', RESOLVE_BASIC);
  mockApiRoute('/api/mods/installed', makeInstalled());
  mockApiRoute('/api/mods', makeInstalled());
  mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [] });
  mockApiRoute('/api/mods/download-version', { success: true, fileName: 'dep.jar', sessionId: 's-dep' });
  mockApiRoute('/api/mods/download-status', { status: 'completed', progress: 100 });
});

afterEach(() => {
  appState.modDownloadPollTimers.forEach((t) => clearTimeout(t));
  appState.modDownloadPollTimers = [];
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('cleanupMdDepsCache', () => {
  it('清理过期项并按上限裁剪', () => {
    const now = Date.now();
    S.mdDepsCache.set('expired', { time: now - S.MD_DEPS_CACHE_TTL - 1 });
    S.mdDepsCache.set('fresh', { time: now });
    mod.cleanupMdDepsCache();
    expect(S.mdDepsCache.has('expired')).toBe(false);
    expect(S.mdDepsCache.has('fresh')).toBe(true);

    S.MD_DEPS_CACHE_MAX = 2;
    for (let i = 0; i < 5; i++) S.mdDepsCache.set('k' + i, { time: now + i });
    mod.cleanupMdDepsCache();
    expect(S.mdDepsCache.size).toBe(2);
    expect(S.mdDepsCache.has('k4')).toBe(true);
    expect(S.mdDepsCache.has('k3')).toBe(true);
    S.MD_DEPS_CACHE_MAX = 50;
  });

  it('空缓存安全返回', () => {
    expect(() => mod.cleanupMdDepsCache()).not.toThrow();
  });
});

describe('toggleMdDepsSection', () => {
  it('切换展开态并旋转箭头', () => {
    const list = document.getElementById('md-deps-list');
    mod.toggleMdDepsSection();
    expect(list.classList.contains('expanded')).toBe(true);
    expect(document.getElementById('md-deps-arrow').style.transform).toBe('rotate(180deg)');
    mod.toggleMdDepsSection();
    expect(list.classList.contains('expanded')).toBe(false);
    expect(document.getElementById('md-deps-arrow').style.transform).toBe('');
  });

  it('列表缺失时安全返回', () => {
    document.getElementById('md-deps-list').remove();
    expect(() => mod.toggleMdDepsSection()).not.toThrow();
  });
});

describe('loadModDependencies', () => {
  it('依赖容器缺失时直接返回', async () => {
    document.getElementById('md-deps-section').remove();
    await mod.loadModDependencies();
    expect(getApiCalls().length).toBe(0);
  });

  it('仅汇总当前筛选目标版本的依赖并合并重复项', async () => {
    await mod.loadModDependencies();

    const section = document.getElementById('md-deps-section');
    expect(section.style.display).toBe('block');
    expect(modDetailState.deps.length).toBe(2);
    expect(modDetailState.deps.map((d) => d.projectId)).toEqual(['fabric-api', 'cloth-config']);
    expect(modDetailState.deps[0].dependencyType).toBe('required');

    const call = getApiCalls().find((c) => c.path === '/api/mods/resolve-deps-versions');
    expect(call.args.body).toMatchObject({ ids: ['cloth-config', 'fabric-api'], gameVersion: '1.20.1', loader: 'fabric' });
    expect(document.getElementById('md-deps-count').textContent).toContain('1 必选');
    expect(document.getElementById('md-deps-count').textContent).toContain('1 个有对应版本');
    expect(document.getElementById('md-deps-count').textContent).toContain('1 个未有对应版本');
    const list = document.getElementById('md-deps-list');
    expect(list.querySelectorAll('.md-dep-item').length).toBe(2);
    expect(list.textContent).toContain('✓ 已安装');
    expect(list.textContent).toContain('未有对应版本');
  });

  it('没有版本筛选时走基础依赖解析', async () => {
    appState.installedVersions = [];
    mockApiRoute('/api/settings', { selectedVersion: '' });

    await mod.loadModDependencies();

    expect(getApiCalls().some((c) => c.path === '/api/mods/resolve-deps')).toBe(true);
    expect(getApiCalls().some((c) => c.path === '/api/mods/resolve-deps-versions')).toBe(false);
    expect(document.getElementById('md-deps-count').textContent).toBe('(2 必选, 1 可选)');
    const list = document.getElementById('md-deps-list');
    expect(list.textContent).toContain('请先选择版本');
    expect(list.textContent).toContain('Fabric API');
  });

  it('基础解析失败项会二次补全', async () => {
    appState.installedVersions = [];
    mockApiRoute('/api/settings', { selectedVersion: '' });
    mockApiRoute('/api/mods/resolve-deps', {});
    mockApiRoute('/api/mods/resolve-deps-versions', {});
    mockApiRoute('/api/mods/resolve-deps', {});

    await mod.loadModDependencies();

    expect(getApiCalls().some((c) => c.path === '/api/mods/resolve-deps')).toBe(true);
    expect(document.getElementById('md-deps-list').textContent).toContain('fabric-api');
  });

  it('命中缓存时不再请求解析接口', async () => {
    const key = ['cloth-config', 'fabric-api'].join(',') + '|1.20.1|fabric';
    S.mdDepsCache.set(key, {
      resolved: RESOLVE_BASIC,
      versionInfo: RESOLVE_VERSIONS,
      installedMods: [],
      time: Date.now(),
    });

    await mod.loadModDependencies();

    expect(getApiCalls().some((c) => c.path === '/api/mods/resolve-deps-versions')).toBe(false);
    expect(document.getElementById('md-deps-list').textContent).toContain('可安装');
  });

  it('无依赖时隐藏区块', async () => {
    modDetailState.allVersions = [{ id: 'v1', gameVersions: ['1.20.1'], loaders: ['fabric'], dependencies: [] }];
    await mod.loadModDependencies();
    expect(document.getElementById('md-deps-section').style.display).toBe('none');
    expect(modDetailState.deps).toEqual([]);
  });

  it('解析接口失败时回退到项目 ID 列表', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockApiRoute('/api/mods/resolve-deps-versions', { status: 500, body: { error: 'x' } });

    await mod.loadModDependencies();

    const list = document.getElementById('md-deps-list');
    expect(list.textContent).toContain('fabric-api');
    expect(list.textContent).toContain('cloth-config');
    expect(list.textContent).toContain('必选');
  });
});

describe('renderDepsList', () => {
  function render(deps, resolved, versionInfo, hasFilter, installed) {
    const list = document.getElementById('md-deps-list');
    mod.renderDepsList(deps, resolved, versionInfo, hasFilter, '1.20.1', 'fabric', installed, list, null, []);
    return list;
  }

  it('按已安装、可安装与无对应版本渲染状态', () => {
    const list = render(
      [
        { projectId: 'fabric-api', dependencyType: 'required' },
        { projectId: 'cloth-config', dependencyType: 'optional' },
        { projectId: 'old-dep', dependencyType: 'incompatible' },
      ],
      RESOLVE_BASIC,
      { ...RESOLVE_VERSIONS, 'old-dep': { hasCompatibleVersion: false } },
      true,
      [{ id: 'fabric-api' }],
    );

    expect(list.textContent).toContain('✓ 已安装');
    expect(list.textContent).toContain('未有对应版本');
    expect(list.textContent).toContain('冲突');
    expect(list.textContent).toContain('1.20.1 / fabric 无对应版本');
  });

  it('通过文件名或 slug 判定已安装', () => {
    const list = render(
      [{ projectId: 'some-project', dependencyType: 'required' }],
      { 'some-project': { title: 'Some', slug: 'some-slug', icon: '', description: '' } },
      { 'some-project': { hasCompatibleVersion: true, versionNumber: '1.0', fileName: 'some-project-1.0.jar' } },
      true,
      [{ id: 'other', fileName: 'some-project-1.0.jar' }],
    );
    expect(list.textContent).toContain('✓ 已安装');
  });

  it('渲染可选依赖徽章与版本加载器标签', () => {
    const list = render(
      [{ projectId: 'fabric-api', dependencyType: 'optional' }],
      RESOLVE_BASIC,
      { 'fabric-api': { hasCompatibleVersion: true, versionNumber: '0.92.0', loaders: ['fabric', 'quilt'] } },
      true,
      [],
    );
    expect(list.querySelector('.md-dep-badge').textContent).toBe('可选');
    expect(list.textContent).toContain('0.92.0');
    expect(list.textContent).toContain('fabric');
    expect(list.textContent).toContain('quilt');
  });

  it('没有筛选时提示先选择版本', () => {
    const list = render(
      [{ projectId: 'fabric-api', dependencyType: 'required' }],
      RESOLVE_BASIC,
      {},
      false,
      [],
    );
    expect(list.textContent).toContain('请先选择版本');
  });
});

describe('downloadAllDeps', () => {
  const dep = (overrides = {}) => ({
    projectId: 'dep-1',
    title: 'Dep One',
    compatibleVersion: { versionId: 'dv1', fileName: 'dep-1.0.jar', versionNumber: '1.0' },
    ...overrides,
  });

  it('未打开模组详情时直接返回', async () => {
    modDetailState.data = null;
    await mod.downloadAllDeps();
    expect(getApiCalls().length).toBe(0);
  });

  it('找不到可用根版本时提示选择版本', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth' };
    modDetailState.allVersions = [];
    mockApiRoute('/api/settings', { selectedVersion: '' });
    appState.installedVersions = [];

    await mod.downloadAllDeps();

    expect(document.getElementById('toast-container').textContent).toContain('请先选择一个版本');
  });

  it('没有前置依赖时提示', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth', selectedVersionId: 'v-root' };
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [] });

    await mod.downloadAllDeps();

    expect(document.getElementById('toast-container').textContent).toContain('该模组没有前置依赖');
  });

  it('存在无法解析前置时给出数量提示', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth', selectedVersionId: 'v-root' };
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [], unresolved: [{ projectId: 'x', title: 'X' }] });

    await mod.downloadAllDeps();

    expect(document.getElementById('toast-container').textContent).toContain('有 1 个前置无法解析');
  });

  it('依赖无兼容版本时提示且不下载', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth', selectedVersionId: 'v-root' };
    mockApiRoute('/api/mods/get-dependencies-recursive', {
      dependencies: [dep({ compatibleVersion: null })],
    });

    await mod.downloadAllDeps();

    const text = document.getElementById('toast-container').textContent;
    expect(text).toContain('无兼容版本');
    expect(text).toContain('没有可下载的前置');
    expect(getApiCalls().some((c) => c.path === '/api/mods/download-version')).toBe(false);
  });

  it('所有前置已安装时提示', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth', selectedVersionId: 'v-root' };
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [dep()] });
    mockApiRoute('/api/mods/installed', [{ id: 'dep-1' }]);

    await mod.downloadAllDeps();

    expect(document.getElementById('toast-container').textContent).toContain('所有前置依赖均已安装');
  });

  it('取消保存目录时不下载', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth', selectedVersionId: 'v-root' };
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [dep()] });
    mockApiRoute('/api/mods/installed', []);
    mockCommand('select_folder', () => ({ cancelled: true }));

    await mod.downloadAllDeps();

    expect(document.getElementById('toast-container').textContent).toContain('已取消');
    expect(getApiCalls().some((c) => c.path === '/api/mods/download-version')).toBe(false);
    expect(document.getElementById('md-deps-download-all-btn').disabled).toBe(false);
  });

  it('提交下载成功后提示总数并清理依赖缓存', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth', selectedVersionId: 'v-root' };
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [dep(), dep({ projectId: 'dep-2', title: 'Dep Two' })] });
    mockApiRoute('/api/mods/installed', []);
    S.mdDepsCache.set('k', { time: Date.now() });

    await mod.downloadAllDeps();

    const calls = getApiCalls().filter((c) => c.path === '/api/mods/download-version');
    expect(calls.map((c) => c.args.body.versionId)).toEqual(['dv1', 'dv1']);
    expect(calls[0].args.body.savePath).toBe('D:/mods');
    expect(S.mdDepsCache.size).toBe(0);
    expect(document.getElementById('toast-container').textContent).toContain('已提交 2 个前置依赖下载');
  });

  it('部分依赖下载失败时汇总提示', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth', selectedVersionId: 'v-root' };
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [dep(), dep({ projectId: 'dep-2', title: 'Dep Two' })] });
    mockApiRoute('/api/mods/installed', []);
    let n = 0;
    mockApiRoute('/api/mods/download-version', () => {
      n++;
      return n === 1 ? { success: true, fileName: 'a.jar', sessionId: 's-a' } : { success: false, error: '源失效' };
    });

    await mod.downloadAllDeps();

    const text = document.getElementById('toast-container').textContent;
    expect(text).toContain('Dep Two: 源失效');
    expect(text).toContain('已提交 1/2 个前置下载，1 个失败');
  });

  it('解析接口异常时提示失败并恢复按钮', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth', selectedVersionId: 'v-root' };
    mockApiRoute('/api/mods/get-dependencies-recursive', { status: 500, body: { error: 'server' } });

    await mod.downloadAllDeps();

    expect(document.getElementById('toast-container').textContent).toContain('检测前置依赖失败');
    const btn = document.getElementById('md-deps-download-all-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.innerHTML).toContain('一键下载');
  });

  it('未选中版本时按筛选与加载器自动选择根版本', async () => {
    modDetailState.data = { id: 'm1', source: 'modrinth' };
    mockApiRoute('/api/mods/get-dependencies-recursive', { dependencies: [] });

    await mod.downloadAllDeps();

    const call = getApiCalls().find((c) => c.path === '/api/mods/get-dependencies-recursive');
    expect(call.args.body.versionId).toBe('v-root');
    expect(call.args.body.gameVersion).toBe('1.20.1');
    expect(call.args.body.loader).toBe('fabric');
  });
});
