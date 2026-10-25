// @vitest-environment jsdom
// mod-detail-versions.test.js — 版本标签、筛选、列表渲染与加载更多单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { formatNumberMock, loaderIconMock, getSelectValueMock, loadDepsMock } = vi.hoisted(() => ({
  formatNumberMock: vi.fn((n) => String(n)),
  loaderIconMock: vi.fn(() => '<i class="loader-icon"></i>'),
  getSelectValueMock: vi.fn(() => ''),
  loadDepsMock: vi.fn(),
}));

vi.mock('../misc/ui-components.js', () => ({ formatNumber: formatNumberMock }));
vi.mock('../misc/custom-select.js', () => ({ getCustomSelectValue: getSelectValueMock }));
vi.mock('./mod-install.js', () => ({ getLoaderFileIcon: loaderIconMock }));
vi.mock('./mod-detail-deps.js', () => ({ loadModDependencies: loadDepsMock }));
vi.mock('../../core/utils.js', () => ({
  escapeHtml: (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'),
  formatDate: (value) => '2024-01-02 03:04:' + value,
}));

let mod;
let S;
let modDetailState;
let appState;
let API;

function buildDom() {
  document.body.innerHTML = `
    <div id="md-version-tabs"></div>
    <div id="md-version-list"></div>
  `;
}

function resetState() {
  S._versionPreloadCache.clear();
  S._versionPreloadInFlight.clear();
  S.mdTabMode = 'major';
  S.MDV_INITIAL_RENDER = 30;
  modDetailState.allVersions = [];
  modDetailState.tab = '';
  modDetailState.loaderFilter = '';
  modDetailState.type = 'mod';
  modDetailState.seq = 0;
  modDetailState.renderedCount = 0;
  modDetailState.currentVersions = [];
  appState.modMultiSelectMode = false;
  appState.modSelectedIds = new Set();
  appState.currentModDetailId = 'p1';
  appState.currentModDetailSource = 'modrinth';
}

function version(overrides = {}) {
  return {
    id: 'v1',
    versionNumber: '1.0.0',
    gameVersions: ['1.20.1'],
    loaders: ['fabric'],
    releaseType: 'release',
    files: [{ id: 'f1', filename: 'a.jar', size: 2048, releaseType: 'release', datePublished: '2024-01-02T00:00:00Z' }],
    ...overrides,
  };
}

beforeAll(async () => {
  vi.resetModules();
  ({ S } = await import('./mod-detail-state.js'));
  ({ modDetailState } = await import('./detail-state.js'));
  ({ appState } = await import('../../core/app-state.js'));
  ({ API } = await import('../../core/api.js'));
  mod = await import('./mod-detail-versions.js');
});

beforeEach(() => {
  buildDom();
  resetState();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  formatNumberMock.mockClear();
  loaderIconMock.mockClear();
  getSelectValueMock.mockReset();
  getSelectValueMock.mockReturnValue('');
  loadDepsMock.mockClear();
  vi.spyOn(API, 'getModVersions').mockResolvedValue({ versions: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('preloadModVersions', () => {
  it('后台加载并写入缓存', async () => {
    API.getModVersions.mockResolvedValue({ versions: [version()] });

    mod.preloadModVersions('p1', 'curseforge');
    await Promise.resolve();
    await Promise.resolve();

    expect(API.getModVersions).toHaveBeenCalledWith('p1', 'curseforge');
    expect(S._versionPreloadCache.get('p1')).toEqual({ versions: [version()] });
    expect(S._versionPreloadInFlight.has('p1')).toBe(false);
  });

  it('默认来源为 modrinth', async () => {
    mod.preloadModVersions('p1');
    await Promise.resolve();

    expect(API.getModVersions).toHaveBeenCalledWith('p1', 'modrinth');
  });

  it('已有缓存或进行中时不重复请求', async () => {
    S._versionPreloadCache.set('cached', {});
    mod.preloadModVersions('cached');

    S._versionPreloadInFlight.add('inflight');
    mod.preloadModVersions('inflight');
    await Promise.resolve();

    expect(API.getModVersions).not.toHaveBeenCalled();
  });

  it('请求失败时清理进行中标记', async () => {
    API.getModVersions.mockRejectedValue(new Error('offline'));

    mod.preloadModVersions('p1');
    await Promise.resolve();
    await Promise.resolve();

    expect(S._versionPreloadInFlight.has('p1')).toBe(false);
    expect(S._versionPreloadCache.has('p1')).toBe(false);
  });
});

describe('_renderVersionTabs', () => {
  it('渲染全部按钮与带计数的分组按钮', () => {
    mod._renderVersionTabs('exact', new Map([['1.20.1', 2], ['1.21', 1]]), ['1.21', '1.20.1']);

    const tabs = document.querySelectorAll('.md-vtab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0].textContent).toBe('全部');
    expect(tabs[0].classList.contains('active')).toBe(true);
    expect(tabs[1].textContent).toBe('1.21 (1)');
    expect(tabs[1].getAttribute('data-group')).toBe('exact');
  });

  it('容器缺失时安全返回', () => {
    document.getElementById('md-version-tabs').remove();

    expect(() => mod._renderVersionTabs('major', new Map(), [])).not.toThrow();
  });
});

describe('renderMdVersionTabs', () => {
  it('序号不一致时放弃渲染', () => {
    modDetailState.seq = 2;
    modDetailState.allVersions = [version()];

    mod.renderMdVersionTabs(1);

    expect(document.getElementById('md-version-tabs').innerHTML).toBe('');
  });

  it('按精确游戏版本生成标签并渲染列表', () => {
    modDetailState.allVersions = [
      version({ id: 'v1', gameVersions: ['1.20.1', '1.21'] }),
      version({ id: 'v2', gameVersions: ['1.20.1'] }),
    ];

    mod.renderMdVersionTabs();

    const tabs = [...document.querySelectorAll('.md-vtab')];
    expect(tabs).toHaveLength(3);
    expect(tabs[1].textContent).toBe('1.21');
    expect(tabs[2].textContent).toBe('1.20.1');
    expect(S.mdTabMode).toBe('exact');
    expect(modDetailState.tab).toBe('');
    expect(document.getElementById('md-version-list').querySelectorAll('.mdv-group')).toHaveLength(2);
  });

  it('精确标签超过上限时聚合为主版本', () => {
    modDetailState.allVersions = Array.from({ length: 12 }, (_, i) => version({
      id: 'v' + i,
      gameVersions: ['1.20.' + (i + 1)],
    }));

    mod.renderMdVersionTabs();

    const tabs = [...document.querySelectorAll('.md-vtab')];
    expect(tabs).toHaveLength(2);
    expect(tabs[1].textContent).toBe('1.20');
    expect(tabs[1].getAttribute('data-group')).toBe('major');
    expect(S.mdTabMode).toBe('major');
  });

  it('忽略快照与无游戏版本的数据', () => {
    modDetailState.allVersions = [
      version({ id: 'a', gameVersions: ['1.20.1-w1', 'snapshot'] }),
      version({ id: 'b', gameVersions: [] }),
      version({ id: 'c', gameVersions: undefined }),
    ];

    mod.renderMdVersionTabs();

    expect(document.querySelectorAll('.md-vtab')).toHaveLength(1);
    expect(document.querySelectorAll('.mdv-group')).toHaveLength(3);
  });

  it('标签容器缺失时仍更新模式与列表', () => {
    document.getElementById('md-version-tabs').remove();
    modDetailState.allVersions = [version()];

    mod.renderMdVersionTabs();

    expect(S.mdTabMode).toBe('exact');
    expect(document.getElementById('md-version-list').querySelectorAll('.mdv-group')).toHaveLength(1);
  });
});

describe('loadMdVersions', () => {
  it('加载版本并刷新依赖与标签', async () => {
    API.getModVersions.mockResolvedValue({ versions: [version()] });

    await mod.loadMdVersions('p1', 'modrinth');

    expect(modDetailState.allVersions).toEqual([version()]);
    expect(loadDepsMock).toHaveBeenCalled();
    expect(document.querySelectorAll('.md-vtab').length).toBeGreaterThan(0);
  });

  it('非数组版本归一为空数组', async () => {
    API.getModVersions.mockResolvedValue({ versions: 'bad' });

    await mod.loadMdVersions('p1', 'modrinth');

    expect(modDetailState.allVersions).toEqual([]);
  });

  it('序号变化后丢弃结果', async () => {
    modDetailState.seq = 5;
    API.getModVersions.mockResolvedValue({ versions: [version()] });

    await mod.loadMdVersions('p1', 'modrinth', 4);

    expect(modDetailState.allVersions).toEqual([]);
  });

  it('请求失败展示错误', async () => {
    API.getModVersions.mockRejectedValue(new Error('down'));

    await mod.loadMdVersions('p1', 'modrinth');

    expect(document.getElementById('md-version-list').textContent).toBe('加载版本列表失败');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('switchMdVersionTab', () => {
  beforeEach(() => {
    modDetailState.allVersions = [
      version({ id: 'v1', versionNumber: '2.0.0', gameVersions: ['1.20.1'], loaders: ['Fabric'] }),
      version({ id: 'v2', versionNumber: '1.0.0', gameVersions: ['1.21'], loaders: ['Forge'] }),
    ];
    document.getElementById('md-version-tabs').innerHTML = `
      <button class="md-vtab active" data-ver=""></button>
      <button class="md-vtab" data-ver="1.20.1"></button>
    `;
  });

  it('切换标签并激活对应按钮', () => {
    mod.switchMdVersionTab('1.20.1', 'exact');

    const tabs = [...document.querySelectorAll('.md-vtab')];
    expect(modDetailState.tab).toBe('1.20.1');
    expect(tabs[0].classList.contains('active')).toBe(false);
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(document.querySelectorAll('.mdv-group')).toHaveLength(1);
  });

  it('空标签展示全部版本', () => {
    mod.switchMdVersionTab('', 'exact');

    expect(document.querySelectorAll('.mdv-group')).toHaveLength(2);
  });

  it('按主版本筛选', () => {
    mod.switchMdVersionTab('1.20', 'major');

    expect(document.querySelectorAll('.mdv-group')).toHaveLength(1);
    expect(document.getElementById('md-version-list').textContent).toContain('2.0.0');
  });

  it('_filtered 使用列表页筛选条件', () => {
    getSelectValueMock.mockImplementation((id) => (id === 'mod-filter-version' ? '1.21' : 'forge'));

    mod.switchMdVersionTab('_filtered', 'major');

    expect(document.querySelectorAll('.mdv-group')).toHaveLength(1);
    expect(document.getElementById('md-version-list').textContent).toContain('1.0.0');
  });

  it('_filtered 无筛选条件时展示全部', () => {
    mod.switchMdVersionTab('_filtered', 'major');

    expect(document.querySelectorAll('.mdv-group')).toHaveLength(2);
  });

  it('未传模式时回落到当前标签模式', () => {
    S.mdTabMode = 'exact';

    mod.switchMdVersionTab('1.20.1');

    expect(document.querySelectorAll('.mdv-group')).toHaveLength(1);
  });
});

describe('_buildVersionItemHtml', () => {
  it('基础字段、加载器徽章与大小', () => {
    const html = mod._buildVersionItemHtml(version({
      versionNumber: 'v3.1.0',
      loaders: ['fabric', 'forge', 'neoforge', 'quilt', 'other'],
    }), 0);

    expect(html).toContain('v3.1.0');
    expect(html).toContain('1.20.1');
    expect(html).toContain('loader-badge');
    expect(html).toContain('#dbb07c');
    expect(html).toContain('#4a6b8a');
    expect(html).toContain('#f47733');
    expect(html).toContain('#9b59b6');
    expect(html).toContain('2 KB');
    expect(html).toContain('mdv-header-btn');
    expect(html).toContain('installModFile');
  });

  it('缺少版本号时截取 id', () => {
    const html = mod._buildVersionItemHtml(version({ id: '1234567890abcdef', versionNumber: '', versionName: '' }), 1);

    expect(html).toContain('1234567890ab');
    expect(html).toContain('mdvg-1');
  });

  it('测试版显示徽章', () => {
    const html = mod._buildVersionItemHtml(version({ releaseType: 'beta' }), 0);

    expect(html).toContain('测试版');
  });

  it('整合包使用下载按钮', () => {
    modDetailState.type = 'modpack';

    const html = mod._buildVersionItemHtml(version(), 0);

    expect(html).toContain('installModpackVersion');
    expect(html).toContain('下载');
  });

  it('其他资源使用快速安装', () => {
    modDetailState.type = 'shader';

    const html = mod._buildVersionItemHtml(version(), 0);

    expect(html).toContain('quickInstallResourceVersion');
    expect(html).toContain('shader');
  });

  it('多选模式根据已选状态展示添加按钮', () => {
    appState.modMultiSelectMode = true;
    appState.modSelectedIds.add('p1');

    const html = mod._buildVersionItemHtml(version(), 0);

    expect(html).toContain('已添加');
    expect(html).toContain('btn-secondary');
    expect(html).toContain('addModFromDetail');
  });

  it('多选模式未选时使用主按钮', () => {
    appState.modMultiSelectMode = true;

    const html = mod._buildVersionItemHtml(version(), 0);

    expect(html).toContain('添加');
    expect(html).toContain('btn-primary');
  });

  it('单文件无大小时不显示大小文案', () => {
    const html = mod._buildVersionItemHtml(version({ files: [] }), 0);

    expect(html).toContain('single-file');
    expect(html).not.toContain('KB');
  });

  it('多文件展开文件行与操作', () => {
    const html = mod._buildVersionItemHtml(version({
      files: [
        { id: 'f1', filename: 'a.jar', size: 2048, releaseType: 'release', datePublished: '2024-01-02T00:00:00Z' },
        { id: 'f2', name: 'b.jar', size: 3072, releaseType: 'beta' },
      ],
    }), 2);

    expect(html).toContain('mdv-files');
    expect(html).toContain('2 个文件');
    expect(html).toContain('a.jar');
    expect(html).toContain('b.jar');
    expect(html).toContain('2024-01-02');
    expect(html).toContain('稳定');
    expect(html).toContain('测试版');
    expect(html).toContain('loader-icon');
    expect(html).toContain('installModFileRow');
    expect(html).toContain('toggleMdvGroup');
  });

  it('多文件多选模式使用添加动作', () => {
    appState.modMultiSelectMode = true;
    appState.modSelectedIds.add('p1');

    const html = mod._buildVersionItemHtml(version({
      files: [{ id: 'f1', filename: 'a.jar' }, { id: 'f2', filename: 'b.jar' }],
    }), 0);

    expect(html).toContain('addModFromDetail');
    expect(html).toContain('已添加');
  });

  it('多文件整合包与其他资源行动作不同', () => {
    modDetailState.type = 'modpack';
    let html = mod._buildVersionItemHtml(version({
      files: [{ id: 'f1', filename: 'a.jar' }, { id: 'f2', filename: 'b.jar' }],
    }), 0);
    expect(html).toContain('installModpackVersionRow');

    modDetailState.type = 'shader';
    html = mod._buildVersionItemHtml(version({
      files: [{ id: 'f1', filename: 'a.jar' }, { id: 'f2', filename: 'b.jar' }],
    }), 0);
    expect(html).toContain('installResourceVersionRow');
  });
});

describe('renderMdVersionList', () => {
  it('容器缺失时安全返回', () => {
    document.getElementById('md-version-list').remove();

    expect(() => mod.renderMdVersionList([version()])).not.toThrow();
  });

  it('空列表展示无匹配版本', () => {
    mod.renderMdVersionList([]);

    expect(document.getElementById('md-version-list').textContent).toBe('无匹配版本');
  });

  it('加载器筛选后无结果时提示', () => {
    modDetailState.loaderFilter = 'forge';

    mod.renderMdVersionList([version({ loaders: ['fabric'] })]);

    expect(document.getElementById('md-version-list').textContent).toBe('该加载器下无匹配版本');
  });

  it('按加载器过滤并排序', () => {
    modDetailState.loaderFilter = 'fabric';

    mod.renderMdVersionList([
      version({ id: 'old', versionNumber: '1.0.0', loaders: ['fabric'] }),
      version({ id: 'new', versionNumber: '2.0.0', loaders: ['Fabric'] }),
      version({ id: 'forge', versionNumber: '3.0.0', loaders: ['forge'] }),
    ]);

    const groups = document.querySelectorAll('.mdv-group');
    expect(groups).toHaveLength(2);
    expect(modDetailState.currentVersions[0].id).toBe('new');
    expect(modDetailState.renderedCount).toBe(2);
  });

  it('超过初始渲染数量时追加加载更多', () => {
    const versions = Array.from({ length: 35 }, (_, i) => version({ id: 'v' + i, versionNumber: '1.' + i }));
    S.MDV_INITIAL_RENDER = 10;

    mod.renderMdVersionList(versions);

    expect(document.querySelectorAll('.mdv-group')).toHaveLength(10);
    expect(document.getElementById('mdv-load-more').textContent).toContain('加载更多 (25 个版本)');
    expect(modDetailState.renderedCount).toBe(10);
  });
});

describe('renderMdVersionListMore', () => {
  it('追加下一批并保留剩余按钮', () => {
    const versions = Array.from({ length: 25 }, (_, i) => version({ id: 'v' + i, versionNumber: '1.' + i }));
    S.MDV_INITIAL_RENDER = 10;
    mod.renderMdVersionList(versions);

    mod.renderMdVersionListMore();

    expect(modDetailState.renderedCount).toBe(20);
    expect(document.querySelectorAll('.mdv-group')).toHaveLength(20);
    expect(document.getElementById('mdv-load-more').textContent).toContain('加载更多 (5 个版本)');
  });

  it('最后一批后移除加载更多按钮', () => {
    const versions = Array.from({ length: 15 }, (_, i) => version({ id: 'v' + i, versionNumber: '1.' + i }));
    S.MDV_INITIAL_RENDER = 10;
    mod.renderMdVersionList(versions);

    mod.renderMdVersionListMore();

    expect(modDetailState.renderedCount).toBe(15);
    expect(document.querySelectorAll('.mdv-group')).toHaveLength(15);
    expect(document.getElementById('mdv-load-more')).toBeNull();
  });
});
