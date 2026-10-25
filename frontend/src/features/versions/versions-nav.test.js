// @vitest-environment jsdom
// versions-nav.test.js — 页面切换、过渡动画与版本详情入口单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiCalls, installTauriMock, mockApiRoute } from '../../test-utils/tauri-mock.js';

let mod;
let S;
let appState;

function buildDom() {
  document.body.innerHTML = `
    <nav>
      <button class="nav-btn" data-page="home"></button>
      <button class="nav-btn" data-page="mods"></button>
      <button class="nav-btn" data-page="versions"></button>
      <div class="nav-submenu-group">
        <button class="nav-submenu-toggle"></button>
        <button class="nav-sub-btn" data-page="modpacks"></button>
      </div>
    </nav>
    <div class="content-area">
      <div id="page-home" class="page active"><div class="card">home</div></div>
      <div id="page-mods" class="page"><div class="card">mods</div></div>
      <div id="page-versions" class="page"><div class="card">versions</div></div>
      <div id="page-version-detail" class="page"></div>
      <div id="page-modpacks" class="page"></div>
      <div id="page-plugins" class="page"></div>
      <div id="page-installed-versions" class="page"><div id="installed-versions-list"></div></div>
    </div>
    <div id="verdetail-icon"></div>
    <div id="verdetail-name"></div>
    <div id="verdetail-meta"></div>
    <div id="loader-version-section"></div>
    <div id="loader-version-list"></div>
    <div class="loader-card" data-loader=""></div>
    <div class="loader-card" data-loader="fabric"></div>
    <div id="fabric-api-section-detail"></div>
    <div id="fabric-api-picker-detail"></div>
  `;
}

beforeAll(async () => {
  installTauriMock();
  vi.resetModules();
  S = (await import('./versions-state.js')).versionsState;
  appState = (await import('../../core/app-state.js')).appState;
  mod = await import('./versions-nav.js');
});

beforeEach(() => {
  installTauriMock();
  buildDom();
  S._pageTransitionLock = false;
  S._pendingPageTransition = null;
  S.currentVersionDetail = null;
  appState.previousPage = '';
  appState.installedVersions = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  S._pageTransitionLock = false;
  S._pendingPageTransition = null;
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('_collectPclBlocks / runPageEnterAnim', () => {
  it('收集可见区块并跳过隐藏与卡片内嵌卡片', () => {
    const page = document.createElement('div');
    page.innerHTML = `
      <div class="card" id="a"></div>
      <div class="card" id="b" style="display:none"></div>
      <div class="card" id="outer"><div class="card" id="inner"></div></div>
    `;

    const blocks = mod._collectPclBlocks(page);

    expect(blocks.map((el) => el.id)).toEqual(['a', 'outer']);
  });

  it('无匹配区块时回退到直接子元素', () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 10 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 10 });
    try {
      const page = document.createElement('div');
      page.innerHTML = '<div id="wrap"><div id="child-a"></div><div id="child-b" style="display:none"></div></div>';

      const blocks = mod._collectPclBlocks(page);

      expect(blocks.map((el) => el.id)).toEqual(['child-a']);
    } finally {
      delete HTMLElement.prototype.offsetWidth;
      delete HTMLElement.prototype.offsetHeight;
    }
  });

  it('进入动画为每个区块设置错峰延迟', () => {
    const page = document.createElement('div');
    page.innerHTML = '<div class="card" id="a"></div><div class="card" id="b"></div>';
    page.style.animation = 'fade 1s';

    mod.runPageEnterAnim(page);

    expect(page.style.animation).toBe('none');
    const a = page.querySelector('#a');
    const b = page.querySelector('#b');
    expect(a.classList.contains('pc-enter-block')).toBe(true);
    expect(b.classList.contains('pc-enter-block')).toBe(true);
    expect(a.style.getPropertyValue('--pc-delay')).toBe('0ms');
    expect(b.style.getPropertyValue('--pc-delay')).toBe('25ms');
  });

  it('空页面进入动画安全返回', () => {
    expect(() => mod.runPageEnterAnim(null)).not.toThrow();
    expect(() => mod.runPageEnterAnim(document.createElement('div'))).not.toThrow();
  });
});

describe('runPageExitAnim', () => {
  it('添加退场类并在动画结束后回调', async () => {
    const page = document.createElement('div');
    const done = vi.fn();

    mod.runPageExitAnim(page, done);

    expect(page.classList.contains('pc-exit-page')).toBe(true);
    await wait(120);
    expect(page.classList.contains('pc-exit-page')).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('无元素时立即回调', () => {
    const done = vi.fn();
    mod.runPageExitAnim(null, done);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('navigateToPage', () => {
  it('目标页面不存在时记录错误', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mod.navigateToPage('missing-page');
    expect(errSpy).toHaveBeenCalledWith('[Navigate] Page not found:', 'missing-page');
    expect(document.getElementById('page-home').classList.contains('active')).toBe(true);
  });

  it('点击当前页时只重置滚动位置', async () => {
    const home = document.getElementById('page-home');
    home.scrollTop = 42;
    await mod.navigateToPage('home');
    expect(home.scrollTop).toBe(0);
    expect(document.querySelectorAll('.page.active').length).toBe(1);
  });

  it('切页后旧页失去 active、新页与导航按钮激活', async () => {
    await mod.navigateToPage('versions');
    await wait(260);

    expect(document.getElementById('page-home').classList.contains('active')).toBe(false);
    expect(document.getElementById('page-versions').classList.contains('active')).toBe(true);
    expect(document.querySelector('.nav-btn[data-page="versions"]').classList.contains('active')).toBe(true);
    expect(S._pageTransitionLock).toBe(false);
  });

  it('进入详情页时记录来源页并保持来源导航高亮', async () => {
    await mod.navigateToPage('version-detail');
    await wait(260);

    expect(appState.previousPage).toBe('home');
    expect(document.getElementById('page-version-detail').classList.contains('active')).toBe(true);
    expect(document.querySelector('.nav-btn[data-page="home"]').classList.contains('active')).toBe(true);
    expect(document.querySelector('.nav-btn[data-page="versions"]').classList.contains('active')).toBe(false);
  });

  it('过渡锁存在时记录待切换页面且不立即切页', async () => {
    S._pageTransitionLock = true;
    await mod.navigateToPage('mods');
    expect(S._pendingPageTransition).toBe('mods');
    expect(document.getElementById('page-home').classList.contains('active')).toBe(true);
    expect(document.getElementById('page-mods').classList.contains('active')).toBe(false);
  });

  it('插件页直接切换并同步导航态', async () => {
    await mod.navigateToPage('plugins');
    expect(document.getElementById('page-plugins').classList.contains('active')).toBe(true);
    expect(document.getElementById('page-home').classList.contains('active')).toBe(false);
    expect(S._pageTransitionLock).toBe(false);
  });

  it('子菜单页面激活时展开父级菜单', async () => {
    await mod.navigateToPage('modpacks');
    await wait(140);

    const subBtn = document.querySelector('.nav-sub-btn[data-page="modpacks"]');
    expect(subBtn.classList.contains('active')).toBe(true);
    expect(subBtn.closest('.nav-submenu-group').classList.contains('open')).toBe(true);
    expect(document.querySelector('.nav-submenu-toggle').classList.contains('active')).toBe(true);
  });

  it('切页时恢复被缓存清理的图片 src', async () => {
    const target = document.getElementById('page-versions');
    target.innerHTML = '<img id="cached-img" data-_cached-src="img/bg.png">';

    await mod.navigateToPage('versions');
    await wait(260);

    const img = document.getElementById('cached-img');
    expect(img.getAttribute('src')).toBe('img/bg.png');
    expect(img.hasAttribute('data-_cached-src')).toBe(false);
  });

  it('进入已安装版本页时拉取版本列表', async () => {
    mockApiRoute('/api/versions', { versions: [], installed: [] });
    await mod.navigateToPage('installed-versions');

    await vi.waitFor(() => {
      expect(getApiCalls().some((c) => c.path === '/api/versions')).toBe(true);
    }, { timeout: 3000 });
  });
});

describe('openVersionDetail', () => {
  beforeEach(() => {
    mockApiRoute('/api/version-icon', { success: true, dataUrl: 'data:image/png;base64,icon' });
  });

  it('填充详情页基础信息并选中空加载器', async () => {
    await mod.openVersionDetail('1.20.1', 'https://example.com/v.json', 'release');

    expect(S.currentVersionDetail).toEqual({ id: '1.20.1', url: 'https://example.com/v.json', type: 'release' });
    expect(document.getElementById('verdetail-name').textContent).toBe('1.20.1');
    expect(document.getElementById('verdetail-meta').textContent).toBe('正式版');
    const cards = [...document.querySelectorAll('.loader-card')];
    expect(cards[0].classList.contains('selected')).toBe(true);
    expect(cards[1].classList.contains('selected')).toBe(false);
    expect(document.getElementById('loader-version-section').style.display).toBe('none');
    expect(document.getElementById('loader-version-list').innerHTML).toBe('');
    expect(document.getElementById('fabric-api-section-detail').style.display).toBe('none');
    expect(document.getElementById('fabric-api-picker-detail').style.display).toBe('none');
    expect(S.selectedLoaderType).toBe('');
    expect(S.selectedLoaderVersion).toBe('');

    await vi.waitFor(() => {
      expect(document.getElementById('verdetail-icon').src).toContain('data:image/png');
    });
  });

  it('未知版本类型回退到原始类型文本', async () => {
    await mod.openVersionDetail('1.20.1', '', 'custom-type');
    expect(document.getElementById('verdetail-meta').textContent).toBe('custom-type');
  });
});
