// @vitest-environment jsdom
// favorites-data.test.js — 收藏夹数据加载、分组渲染与子页面列表单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { formatNumberMock, formatNameMock } = vi.hoisted(() => ({
  formatNumberMock: vi.fn((value) => String(value)),
  formatNameMock: vi.fn((slug, title) => title || slug),
}));

vi.mock('../misc/ui-components.js', () => ({ formatNumber: formatNumberMock }));
vi.mock('./chinese-names.js', () => ({ formatModNameWithChinese: formatNameMock }));

let mod;
let appState;
let favSubState;
let API;

function buildDom() {
  document.body.innerHTML = `
    <select id="fav-folder-select"></select>
    <select id="fav-sub-folder-select"></select>
    <div id="fav-content"></div>
    <div id="fav-empty"></div>
    <div id="mod-browse-section"></div>
    <div id="mod-fav-section"></div>
    <div id="fav-sub-list"></div>
    <div id="fav-sub-empty"></div>
    <button id="fav-search-btn"></button>
    <input id="fav-search-input">
  `;
}

function resetState() {
  appState._favorites = [];
  appState._currentFavId = '';
  appState._favSearchQuery = '';
  appState._favSelectedItems = new Set();
  appState._favMultiSelectMode = false;
  favSubState.currentFavId = null;
  favSubState.multiSelect = false;
  favSubState.selected.clear();
  favSubState.searchQuery = '';
  formatNumberMock.mockClear();
  formatNameMock.mockClear();
}

function project(overrides = {}) {
  return {
    id: 'p1',
    title: 'Project',
    description: 'Desc',
    icon: 'https://mod.mcimirror.top/icon.png',
    downloads: 1234,
    author: 'Author',
    categories: ['a', 'b'],
    projectType: 'mod',
    ...overrides,
  };
}

beforeAll(async () => {
  vi.resetModules();
  ({ appState } = await import('../../core/app-state.js'));
  ({ favSubState } = await import('./favorites-state.js'));
  ({ API } = await import('../../core/api.js'));
  mod = await import('./favorites-data.js');
});

beforeEach(() => {
  buildDom();
  resetState();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(API, 'getFavorites').mockResolvedValue([]);
  vi.spyOn(API, 'getModDetail').mockImplementation(async (id) => project({ id, title: 'Project ' + id }));
});

afterEach(() => {
  favSubState.selected = new Set();
  appState._favSelectedItems = new Set();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('loadFavoritesData', () => {
  it('加载收藏夹并默认选中第一个', async () => {
    API.getFavorites.mockResolvedValue([
      { id: 'f1', name: '默认', favs: ['a'] },
      { id: 'f2', name: '生存', favs: [] },
    ]);

    await mod.loadFavoritesData();

    expect(appState._favorites).toHaveLength(2);
    expect(appState._currentFavId).toBe('f1');
    expect(document.getElementById('fav-folder-select').innerHTML).toContain('默认 (1)');
    expect(document.getElementById('fav-folder-select').innerHTML).toContain('value="f1" selected');
  });

  it('已有选中项时保持不变', async () => {
    appState._currentFavId = 'f2';
    API.getFavorites.mockResolvedValue([
      { id: 'f1', name: '默认', favs: [] },
      { id: 'f2', name: '生存', favs: [] },
    ]);

    await mod.loadFavoritesData();

    expect(appState._currentFavId).toBe('f2');
  });

  it('空收藏夹不设置选中项', async () => {
    API.getFavorites.mockResolvedValue([]);

    await mod.loadFavoritesData();

    expect(appState._currentFavId).toBe('');
    expect(document.getElementById('fav-folder-select').innerHTML).toBe('');
  });

  it('加载失败时回退默认收藏夹', async () => {
    API.getFavorites.mockRejectedValue(new Error('offline'));

    await mod.loadFavoritesData();

    expect(appState._favorites).toEqual([{ name: '默认', id: 'default', favs: [], notes: {} }]);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('renderFavFolderSelect', () => {
  it('渲染主页与子页面下拉并标记当前项', () => {
    appState._favorites = [
      { id: 'f1', name: '<默认>', favs: ['a', 'b'] },
      { id: 'f2', name: '生存', favs: [] },
    ];
    appState._currentFavId = 'f2';
    favSubState.currentFavId = 'f1';

    mod.renderFavFolderSelect();

    const main = document.getElementById('fav-folder-select').innerHTML;
    expect(main).toContain('&lt;默认&gt; (2)');
    expect(main).toContain('value="f2" selected');
    const sub = document.getElementById('fav-sub-folder-select').innerHTML;
    expect(sub).toContain('value="f1" selected');
    expect(sub).toContain('生存 (0)');
  });

  it('下拉缺失时安全返回', () => {
    document.getElementById('fav-folder-select').remove();
    document.getElementById('fav-sub-folder-select').remove();

    expect(() => mod.renderFavFolderSelect()).not.toThrow();
  });

  it('切换下拉会清空选择并重新渲染', async () => {
    appState._favorites = [
      { id: 'f1', name: 'A', favs: ['1'], notes: {} },
      { id: 'f2', name: 'B', favs: [], notes: {} },
    ];
    appState._currentFavId = 'f1';
    appState._favSelectedItems.add('x');
    appState._favMultiSelectMode = true;
    mod.renderFavFolderSelect();
    const sel = document.getElementById('fav-folder-select');
    API.getModDetail.mockResolvedValue(project({ id: '1' }));

    sel.value = 'f2';
    sel.onchange();

    expect(appState._currentFavId).toBe('f2');
    expect(appState._favSelectedItems.size).toBe(0);
    expect(appState._favMultiSelectMode).toBe(false);
    expect(document.getElementById('fav-content').style.display).toBe('none');
  });
});

describe('fetchFavProjects', () => {
  it('按 10 个一批请求并保持顺序', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => 'id' + i);

    const result = await mod.fetchFavProjects(ids);

    expect(API.getModDetail).toHaveBeenCalledTimes(12);
    expect(result.map((p) => p.id)).toEqual(ids);
  });

  it('Modrinth 失败时回退 CurseForge', async () => {
    API.getModDetail.mockImplementation(async (id, source) => {
      if (source === 'curseforge') return project({ id, title: 'CF' });
      throw new Error('no');
    });

    const result = await mod.fetchFavProjects(['a']);

    expect(result[0].source).toBe('curseforge');
    expect(result[0].title).toBe('CF');
  });

  it('两个来源都失败时返回占位项目', async () => {
    API.getModDetail.mockRejectedValue(new Error('down'));

    const result = await mod.fetchFavProjects(['x']);

    expect(result[0]).toEqual({ id: 'x', title: 'x', description: '加载失败', source: 'modrinth', projectType: 'mod' });
  });
});

describe('renderFavPage', () => {
  it('容器缺失时直接返回', async () => {
    document.getElementById('fav-content').remove();

    await expect(mod.renderFavPage()).resolves.toBeUndefined();
    expect(API.getModDetail).not.toHaveBeenCalled();
  });

  it('没有选中收藏夹时展示空状态', async () => {
    appState._currentFavId = 'missing';

    await mod.renderFavPage();

    expect(document.getElementById('fav-content').style.display).toBe('none');
    expect(document.getElementById('fav-empty').style.display).toBe('block');
  });

  it('收藏夹为空时展示空状态', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: [] }];
    appState._currentFavId = 'f1';

    await mod.renderFavPage();

    expect(document.getElementById('fav-empty').style.display).toBe('block');
  });

  it('按类型分组渲染项目、备注与图标', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1', '2'], notes: { 2: '重点' } }];
    appState._currentFavId = 'f1';
    API.getModDetail.mockImplementation(async (id) => {
      if (id === '1') return project({ id: '1', title: 'Mod One', projectType: 'mod' });
      return project({ id: '2', title: 'Pack Two', projectType: 'modpack', icon: '' });
    });

    await mod.renderFavPage();

    const content = document.getElementById('fav-content');
    expect(content.textContent).toContain('Mod (1)');
    expect(content.textContent).toContain('整合包 (1)');
    expect(content.textContent).toContain('Mod One');
    expect(content.textContent).toContain('Pack Two');
    expect(content.textContent).toContain('重点');
    expect(content.querySelector('.fav-item-icon').getAttribute('src')).toBe('https://cdn.modrinth.com/icon.png');
    expect(content.querySelectorAll('.fav-item-icon-placeholder').length).toBeGreaterThanOrEqual(1);
  });

  it('多选模式渲染复选框', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1'] }];
    appState._currentFavId = 'f1';
    appState._favMultiSelectMode = true;
    appState._favSelectedItems.add('1');

    await mod.renderFavPage();

    const checkbox = document.querySelector('.fav-item-checkbox');
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(true);
    expect(checkbox.getAttribute('data-action')).toBe('toggleFavItemSelect');
  });

  it('搜索只保留标题或描述匹配项', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1', '2'] }];
    appState._currentFavId = 'f1';
    appState._favSearchQuery = 'hello';
    API.getModDetail.mockImplementation(async (id) => (
      id === '1'
        ? project({ id: '1', title: 'Hello World' })
        : project({ id: '2', title: 'Other', description: 'hello desc' })
    ));

    await mod.renderFavPage();

    expect(document.getElementById('fav-content').textContent).toContain('Hello World');
    expect(document.getElementById('fav-content').textContent).toContain('Other');
  });

  it('搜索无匹配时展示提示', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1'] }];
    appState._currentFavId = 'f1';
    appState._favSearchQuery = 'zzz';

    await mod.renderFavPage();

    expect(document.getElementById('fav-content').textContent).toContain('没有找到匹配的收藏');
  });

  it('未知类型使用原始类型名', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1'] }];
    appState._currentFavId = 'f1';
    API.getModDetail.mockResolvedValue(project({ id: '1', projectType: 'world' }));

    await mod.renderFavPage();

    expect(document.getElementById('fav-content').textContent).toContain('world (1)');
  });

  it('渲染过程中异常展示错误文案', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1'] }];
    appState._currentFavId = 'f1';
    appState._favSelectedItems = { has: () => { throw new Error('render boom'); } };

    await mod.renderFavPage();

    expect(document.getElementById('fav-content').textContent).toContain('加载失败: render boom');
  });
});

describe('子页面进入与退出', () => {
  it('进入子页面隐藏浏览区并渲染列表', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1'] }];
    appState._currentFavId = 'f1';

    mod.enterFavSubPage();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('mod-browse-section').style.display).toBe('none');
    expect(document.getElementById('mod-fav-section').style.display).toBe('block');
    expect(favSubState.currentFavId).toBe('f1');
    expect(document.getElementById('fav-sub-folder-select').innerHTML).toContain('A (1)');
    expect(API.getModDetail).toHaveBeenCalled();
  });

  it('区域缺失时安全返回', () => {
    document.getElementById('mod-browse-section').remove();

    expect(() => mod.enterFavSubPage()).not.toThrow();
    expect(() => mod.exitFavSubPage()).not.toThrow();
  });

  it('退出子页面恢复浏览区并重置状态', () => {
    document.getElementById('mod-fav-section').style.display = 'block';
    document.getElementById('mod-browse-section').style.display = 'none';
    favSubState.multiSelect = true;
    favSubState.selected.add('x');
    favSubState.searchQuery = 'q';

    mod.exitFavSubPage();

    expect(document.getElementById('mod-fav-section').style.display).toBe('none');
    expect(document.getElementById('mod-browse-section').style.display).toBe('block');
    expect(favSubState.multiSelect).toBe(false);
    expect(favSubState.selected.size).toBe(0);
    expect(favSubState.searchQuery).toBe('');
  });
});

describe('子页面选择与搜索', () => {
  it('填充子页面下拉并标记当前项', () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1'] }, { id: 'f2', name: 'B', favs: null }];
    favSubState.currentFavId = 'f2';

    mod.populateFavSubFolderSelect();

    const html = document.getElementById('fav-sub-folder-select').innerHTML;
    expect(html).toContain('value="f2" selected');
    expect(html).toContain('B (0)');
  });

  it('下拉缺失时安全返回', () => {
    document.getElementById('fav-sub-folder-select').remove();

    expect(() => mod.populateFavSubFolderSelect()).not.toThrow();
  });

  it('切换收藏夹清空选中并重新渲染', async () => {
    appState._favorites = [{ id: 'f2', name: 'B', favs: [] }];
    favSubState.selected.add('x');

    mod.onFavSubFolderChange('f2');
    await Promise.resolve();

    expect(favSubState.currentFavId).toBe('f2');
    expect(appState._currentFavId).toBe('f2');
    expect(favSubState.selected.size).toBe(0);
    expect(document.getElementById('fav-sub-empty').style.display).toBe('block');
  });

  it('renderFavSubFolderSelect 委托填充', () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: [] }];
    favSubState.currentFavId = 'f1';

    mod.renderFavSubFolderSelect();

    expect(document.getElementById('fav-sub-folder-select').innerHTML).toContain('A (0)');
  });

  it('搜索词更新并渲染', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1'] }];
    favSubState.currentFavId = 'f1';

    mod.onFavSubSearch('hello');
    await Promise.resolve();
    await Promise.resolve();

    expect(favSubState.searchQuery).toBe('hello');
    expect(API.getModDetail).toHaveBeenCalled();
  });
});

describe('renderFavSubList', () => {
  beforeEach(() => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1', '2'] }];
    favSubState.currentFavId = 'f1';
  });

  it('容器缺失时直接返回', async () => {
    document.getElementById('fav-sub-list').remove();

    await expect(mod.renderFavSubList()).resolves.toBeUndefined();
  });

  it('收藏夹为空展示空状态', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: [] }];

    await mod.renderFavSubList();

    expect(document.getElementById('fav-sub-list').style.display).toBe('none');
    expect(document.getElementById('fav-sub-empty').style.display).toBe('block');
  });

  it('渲染可点击列表与元信息', async () => {
    API.getModDetail.mockImplementation(async (id) => project({
      id,
      slug: 'slug-' + id,
      title: 'Title ' + id,
      downloads: 42,
      author: 'A',
      categories: ['c1', 'c2', 'c3', 'c4'],
    }));

    await mod.renderFavSubList();

    const list = document.getElementById('fav-sub-list');
    expect(list.style.display).toBe('');
    expect(document.getElementById('fav-sub-empty').style.display).toBe('none');
    expect(list.querySelectorAll('.mod-item')).toHaveLength(2);
    expect(list.textContent).toContain('Title 1');
    expect(list.textContent).toContain('42');
    expect(list.textContent).toContain('c1, c2, c3');
    expect(list.textContent).not.toContain('c4');
    expect(list.querySelector('.fav-heart-btn').getAttribute('data-project-id')).toBe('1');
    expect(formatNameMock).toHaveBeenCalledWith('slug-1', 'Title 1');
  });

  it('多选模式渲染勾选状态', async () => {
    favSubState.multiSelect = true;
    favSubState.selected.add('1');

    await mod.renderFavSubList();

    const boxes = document.querySelectorAll('.mod-checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].classList.contains('checked')).toBe(true);
    expect(boxes[1].classList.contains('checked')).toBe(false);
  });

  it('搜索过滤与无匹配提示', async () => {
    favSubState.searchQuery = 'zzz';

    await mod.renderFavSubList();

    expect(document.getElementById('fav-sub-list').textContent).toContain('没有找到匹配的收藏');
  });

  it('图标为空时使用兜底 URL 与转义标题', async () => {
    API.getModDetail.mockImplementation(async (id) => project({ id, title: '<x>', icon: '' }));

    await mod.renderFavSubList();

    const img = document.querySelector('#fav-sub-list .mod-icon img');
    expect(img.getAttribute('src')).toBe('');
    expect(document.getElementById('fav-sub-list').textContent).toContain('<x>');
  });

  it('抛错时展示错误文案', async () => {
    favSubState.selected = { has: () => { throw new Error('list boom'); } };
    favSubState.multiSelect = true;

    await mod.renderFavSubList();

    expect(document.getElementById('fav-sub-list').textContent).toContain('加载失败: list boom');
  });
});

describe('setupFavSearchListeners', () => {
  it('点击按钮按输入框搜索', async () => {
    appState._favorites = [{ id: 'f1', name: 'A', favs: ['1'] }];
    appState._currentFavId = 'f1';
    mod.setupFavSearchListeners();
    document.getElementById('fav-search-input').value = 'hello';

    document.getElementById('fav-search-btn').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(appState._favSearchQuery).toBe('hello');
    expect(API.getModDetail).toHaveBeenCalled();
  });

  it('回车触发搜索，输入法组合时不触发', async () => {
    mod.setupFavSearchListeners();
    const input = document.getElementById('fav-search-input');
    input.value = 'abc';

    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', isComposing: true }));
    expect(appState._favSearchQuery).toBe('');

    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
    await Promise.resolve();
    expect(appState._favSearchQuery).toBe('abc');
  });

  it('非回车键不触发', () => {
    mod.setupFavSearchListeners();

    document.getElementById('fav-search-input').dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));

    expect(appState._favSearchQuery).toBe('');
  });

  it('重复绑定不会叠加监听', () => {
    mod.setupFavSearchListeners();
    mod.setupFavSearchListeners();
    const input = document.getElementById('fav-search-input');
    input.value = 'x';

    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
    expect(appState._favSearchQuery).toBe('x');
  });
});
