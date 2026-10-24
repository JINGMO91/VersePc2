// versions-nav.js — 页面切换动画与版本详情导航
import { bridge as bridge } from '../../core/tauri-bridge.js';
import { showLegalNotice as showLegalNotice, VERSE_FEATURES as VERSE_FEATURES } from '../misc/feature-flags.js';
import { resetCarouselPosition as resetCarouselPosition } from '../accounts/accounts.js';
import { updateGameStatus as updateGameStatus } from '../launch/launch.js';
import { onCloudPageShow as onCloudPageShow } from '../misc/cloud.js';
import { initTerracottaPage as initTerracottaPage, redstoneInitPage as redstoneInitPage, enderlinkInitPage as enderlinkInitPage } from '../misc/lan.js';
import { initServerHostPage as initServerHostPage } from '../misc/server-host.js';
import { renderFavPage as renderFavPage, setupFavSearchListeners as setupFavSearchListeners } from '../mods/favorites.js';
import { loadMods as loadMods } from '../mods/mod-browse.js';
import { openModDetail as openModDetail } from '../mods/mod-detail.js';
import { updateModSelectUI as updateModSelectUI } from '../mods/mod-install.js';
import { loadResourcePage as loadResourcePage, openResourceDetail as openResourceDetail } from '../mods/resource.js';
import { refreshMemoryInfo as refreshMemoryInfo } from '../settings/settings-misc.js';
import { dlManager as dlManager } from './custom-download.js';
import { appState as appState } from '../../core/app-state.js';
import { modDetailState as modDetailState } from '../mods/detail-state.js';
import { versionsState as S } from './versions-state.js';
import { loadVersions, renderInstalledVersionsInto } from './versions-list.js';
import { populateFolderSelector } from './versions-external.js';
import { loadLoaderVersions } from './versions-install.js';

function _collectPclBlocks(pageEl) {
  const blocks = [];
  pageEl.querySelectorAll(S._PCL_BLOCK_SELECTOR).forEach((el) => {
    if (getComputedStyle(el).display === 'none') return;
    if (el.classList.contains('card') && el.parentElement && el.parentElement.closest('.card')) return;
    blocks.push(el);
  });
  if (blocks.length === 0) {
    let kids = Array.from(pageEl.children);
    while (kids.length === 1 && kids[0].children && kids[0].children.length > 1) {
      kids = Array.from(kids[0].children);
    }
    kids.forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
      blocks.push(el);
    });
  }
  return blocks;
}

function runPageEnterAnim(pageEl) {
  if (!pageEl) return;
  const blocks = _collectPclBlocks(pageEl);
  if (blocks.length === 0) return;
  pageEl.style.animation = 'none';
  blocks.forEach((el, i) => {
    el.classList.remove('pc-enter-block');
    void el.offsetWidth;
    el.style.setProperty('--pc-delay', (i * 25) + 'ms');
    el.classList.add('pc-enter-block');
  });
}

function runPageExitAnim(pageEl, done) {
  if (!pageEl) { if (done) done(); return; }
  pageEl.classList.add('pc-exit-page');
  setTimeout(() => {
    pageEl.classList.remove('pc-exit-page');
    if (done) done();
  }, 70);
}

async function navigateToPage(pageName) {
  // 功能开关：下载/联机入口保留，进入时统一展示合规提示页
  const vf = VERSE_FEATURES || {};
  const isLanPage = pageName.indexOf('lan-') === 0 || pageName === 'private-server';
  if ((pageName === 'versions' && !vf.versionDownload) || (isLanPage && !vf.lan)) {
    if (typeof showLegalNotice === 'function') {
      showLegalNotice(pageName);
      return;
    }
  }

  if (S._pageTransitionLock) {
    S._pendingPageTransition = pageName;
    return;
  }

  if (pageName === 'downloads' && window.DynamicIsland && typeof window.DynamicIsland.isEnabled === 'function' && window.DynamicIsland.isEnabled()) {
    return;
  }

  const currentPage = document.querySelector('.page.active');
  const target = document.getElementById(`page-${pageName}`);
  if (!target) {
    console.error('[Navigate] Page not found:', pageName);
    return;
  }
  
  if (currentPage && currentPage === target) {
    target.scrollTop = 0;
    return;
  }

  // 联机页：进入时刷新一次运行中游戏实例（创建房间按钮依赖共享 store，避免轮询未及时更新导致按钮禁用）
  if ((pageName === 'lan-terracotta' || pageName === 'lan-portmap' || pageName === 'lan-enderlink')
      && typeof updateGameStatus === 'function') {
    setTimeout(() => { try { updateGameStatus(); } catch (e) {} }, 80);
  }

  if (pageName === 'plugins' || pageName === 'private-server' || pageName === 'server-host') {
    if (currentPage) {
      currentPage.classList.remove('active');
      currentPage.style.animation = '';
    }
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.nav-sub-btn').forEach(b => b.classList.remove('active'));
    const navBtn = document.querySelector(`.nav-btn[data-page="${pageName}"]`);
    if (navBtn) navBtn.classList.add('active');
    target.classList.add('active');
    target.scrollTop = 0;
    runPageEnterAnim(target);
    // 开服页：进入时刷新本地版本列表
    if (pageName === 'server-host' && typeof initServerHostPage === 'function') {
      setTimeout(() => initServerHostPage(), 50);
    }
    return;
  }
  
  const isDetailPage = pageName === 'version-detail' || pageName === 'mod-detail' || pageName === 'version-settings';
  
  if (isDetailPage && currentPage && currentPage.id.startsWith('page-')) {
    const currentPageName = currentPage.id.replace('page-', '');
    const detailPages = ['version-detail', 'mod-detail', 'version-settings'];
    if (!detailPages.includes(currentPageName)) {
      appState.previousPage = currentPageName;
    }
  }

  if (currentPage && currentPage !== target) {
    if (currentPage.id === 'page-version-settings') {
      document.querySelector('.content-area')?.classList.remove('no-scroll');
    }
    S._pageTransitionLock = true;
    currentPage.style.animation = '';
    target.style.animation = '';
    requestAnimationFrame(() => {
      runPageExitAnim(currentPage, () => {
        try {
          currentPage.classList.remove('active');
          target.classList.add('active');
          target.scrollTop = 0;
          runPageEnterAnim(target);
        } finally {
          setTimeout(() => {
            S._pageTransitionLock = false;
            if (S._pendingPageTransition && S._pendingPageTransition !== pageName) {
              const pending = S._pendingPageTransition;
              S._pendingPageTransition = null;
              navigateToPage(pending);
            } else {
              S._pendingPageTransition = null;
            }
          }, 120);
        }
      });
    });
  } else if (!currentPage) {
    target.classList.add('active');
    target.scrollTop = 0;
    target.style.animation = '';
    runPageEnterAnim(target);
  }

  // ===== 页面切换完成后：恢复该页面之前被内存清理清掉的图片 src =====
  (function restorePageImages(pageEl) {
    try {
      setTimeout(function () {
        const imgs = pageEl.querySelectorAll('img[data-_cached-src]');
        imgs.forEach(function (img) {
          if (!img.src || img.src === '' || img.getAttribute('src') === '') {
            img.src = img.dataset._cachedSrc;
          }
          delete img.dataset._cachedSrc;
        });
        const videos = pageEl.querySelectorAll('video');
        videos.forEach(function (v) {
          if (v._cachedSrcObj && !v.srcObject) {
            v.srcObject = v._cachedSrcObj;
            v._cachedSrcObj = null;
          }
        });
      }, 30);
    } catch (e) {}
  })(target);
  
  if (isDetailPage) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const backPage = appState.previousPage || 'mods';
    const navBtn = document.querySelector(`.nav-btn[data-page="${backPage}"]`);
    if (navBtn) {
      navBtn.classList.add('active');
    } else {
      const subBtn = document.querySelector(`.nav-sub-btn[data-page="${backPage}"]`);
      if (subBtn) {
        subBtn.classList.add('active');
      }
    }
  } else {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.nav-sub-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.nav-submenu-group').forEach(g => g.classList.remove('open'));
    document.querySelectorAll('.nav-submenu-toggle').forEach(t => t.classList.remove('active'));
    const navBtn = document.querySelector(`.nav-btn[data-page="${pageName}"]`);
    if (navBtn) {
      navBtn.classList.add('active');
    } else {
      const subBtn = document.querySelector(`.nav-sub-btn[data-page="${pageName}"]`);
      if (subBtn) {
        subBtn.classList.add('active');
        const parentGroup = subBtn.closest('.nav-submenu-group');
        if (parentGroup) {
          parentGroup.classList.add('open');
          const toggle = parentGroup.querySelector('.nav-submenu-toggle');
          if (toggle) toggle.classList.add('active');
        }
      }
    }
  }

  if (pageName === 'modpacks') {
    appState.modDetailHistory = [];
    setTimeout(() => loadResourcePage('modpack'), 100);
  } else if (pageName === 'settings-other') {
    setTimeout(() => { refreshMemoryInfo(); }, 200);
  } else if (pageName === 'datapacks') {
    setTimeout(() => loadResourcePage('datapack'), 100);
  } else if (pageName === 'resourcepacks') {
    setTimeout(() => loadResourcePage('resourcepack'), 100);
  } else if (pageName === 'shaders') {
    setTimeout(() => loadResourcePage('shader'), 100);
  } else if (pageName === 'mods' && appState.modMultiSelectMode) {
    appState.modDetailHistory = [];
    setTimeout(() => {
      document.getElementById('mod-multiselect-bar').style.display = 'flex';
      document.getElementById('mod-multiselect-toggle').classList.add('btn-primary');
      document.getElementById('mod-multiselect-toggle').classList.remove('btn-secondary');
      updateModSelectUI();
      loadMods();
    }, 200);
  } else if (pageName === 'mod-favorites') {
    appState.modDetailHistory = [];
    setupFavSearchListeners();
    setTimeout(function() { renderFavPage(); }, 100);
  } else if (pageName === 'mods') {
    appState.modDetailHistory = [];
  } else if (pageName === 'downloads') {
    dlManager.render();
  } else if (pageName === 'installed-versions') {
    populateFolderSelector();
    const container = document.getElementById('installed-versions-list');
    if (container) {
      if (!appState.installedVersions || appState.installedVersions.length === 0) {
        container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>加载已安装版本...</p></div>';
        loadVersions(false).then(() => {
          populateFolderSelector();
          renderInstalledVersionsInto(container);
        });
      } else {
        renderInstalledVersionsInto(container);
      }
    }
  } else if (pageName === 'lan-portmap') {
    if (typeof redstoneInitPage === 'function') {
      setTimeout(() => redstoneInitPage(), 100);
    }
  } else if (pageName === 'lan-enderlink') {
    if (typeof enderlinkInitPage === 'function') {
      setTimeout(() => enderlinkInitPage(), 100);
    }
  } else if (pageName === 'lan-terracotta') {
    if (typeof initTerracottaPage === 'function') {
      setTimeout(() => initTerracottaPage(), 100);
    }
  } else if (pageName === 'cloud') {
    if (typeof onCloudPageShow === 'function') {
      setTimeout(() => { try { onCloudPageShow(); } catch (e) { console.error('[cloud] show failed', e); } }, 100);
    }
  }

  // 切到账户页：等页面可见、尺寸稳定后，把账号轮播轨道定位到中间，避免闪到最左边
  if (pageName === 'accounts' && typeof resetCarouselPosition === 'function') {
    setTimeout(() => resetCarouselPosition(), 350);
    setTimeout(() => resetCarouselPosition(), 700);
  }
}

function goBackFromDetail() {
  if (appState.modDetailHistory.length > 0) {
    const prev = appState.modDetailHistory.pop();
    appState._isRestoringModDetail = true;
    if (prev && prev.type !== 'mod') {
      openResourceDetail(prev.id, prev.type, prev.source);
    } else {
      openModDetail(prev && prev.id, prev && prev.source);
    }
    appState._isRestoringModDetail = false;
  } else {
    const backPage = appState.previousPage || 'mods';
    navigateToPage(backPage);
  }
}

function pushModDetailHistory() {
  if (appState._isRestoringModDetail) return;
  const active = document.querySelector('.page.active');
  if (!active || active.id !== 'page-mod-detail') return;
  if (appState.modDetailHistory.length > 0) {
    const last = appState.modDetailHistory[appState.modDetailHistory.length - 1];
    if (last.id === appState.currentModDetailId && last.source === appState.currentModDetailSource) return;
  }
  appState.modDetailHistory.push({
    id: appState.currentModDetailId,
    source: appState.currentModDetailSource,
    type: modDetailState.type
  });
}

function openVersionDetail(versionId, versionUrl, versionType) {
  S.currentVersionDetail = { id: versionId, url: versionUrl, type: versionType };
  
  navigateToPage('version-detail');
  
  const iconEl = document.getElementById('verdetail-icon');
  // 统一获取 Tauri invoke 函数（兼容 v1 __TAURI__ 和 v2 __TAURI_INTERNALS__）
  function _getCore() {
    if (window.__TAURI__ && window.__TAURI__.core) return window.__TAURI__.core;
    if (window.__TAURI_INTERNALS__) return window.__TAURI_INTERNALS__;
    return null;
  }
  if (bridge.apiProxy) {
    bridge.apiProxy('GET', '/api/version-icon', {
      versionId: versionId,
      type: versionType,
      forge: '0', fabric: '0', neoforge: '0', modpack: '0'
    }, null).then(res => {
      if (res.ok) return res.json();
      throw new Error('HTTP ' + res.status);
    }).then(body => {
      if (body && body.success && body.dataUrl) {
        iconEl.src = body.dataUrl;
      }
    }).catch(() => { iconEl.src = ''; });
  } else {
    const core = _getCore();
    if (core && core.invoke) {
      core.invoke('get_version_icon', {
        id: versionId,
        versionType: versionType,
        forge: false, fabric: false, neoforge: false, modpack: false, extDir: undefined
      }).then(result => {
        if (result && result.success && result.data_url) {
          iconEl.src = result.data_url;
        } else {
          iconEl.src = '';
        }
      }).catch(() => { iconEl.src = ''; });
    } else {
      const iconParams = new URLSearchParams({
        versionId,
        type: versionType,
        forge: '0', fabric: '0', neoforge: '0', modpack: '0'
      }).toString();
      iconEl.src = `/api/version-icon?${iconParams}&_t=${appState.versionIconsTimestamp}`;
    }
  }
  document.getElementById('verdetail-name').textContent = versionId;
  const typeLabels = { release: '正式版', snapshot: '快照版', special: '愚人节版', old_beta: '旧测试版', old_alpha: '旧内测版' };
  document.getElementById('verdetail-meta').textContent = typeLabels[versionType] || versionType || '正式版';
  
  const selectedSource = document.getElementById('setting-download-source')?.value || 'china-first';
  const selectedRadio = document.querySelector(`input[name="download-source"][value="${selectedSource}"]`);
  if (selectedRadio) selectedRadio.checked = true;
  
  S.selectedLoaderType = '';
  S.selectedLoaderVersion = '';
  document.querySelectorAll('.loader-card').forEach(item => item.classList.remove('selected'));
  const emptyLoaderCard = document.querySelector('.loader-card[data-loader=""]');
  if (emptyLoaderCard) emptyLoaderCard.classList.add('selected');
  const loaderVersionSection = document.getElementById('loader-version-section');
  if (loaderVersionSection) loaderVersionSection.style.display = 'none';
  document.getElementById('loader-version-list').innerHTML = '';
  
  // 重置 Fabric API 区域：打开版本详情页时默认隐藏，避免上次选中 Fabric 后残留显示
  // 只有用户主动点击 Fabric 加载器卡片后才会显示（见 selectLoaderCard）
  const fabricApiSection = document.getElementById('fabric-api-section-detail');
  if (fabricApiSection) fabricApiSection.style.display = 'none';
  const fabricApiPicker = document.getElementById('fabric-api-picker-detail');
  if (fabricApiPicker) fabricApiPicker.style.display = 'none';
  
  loadLoaderVersions(versionId);
}

export { _collectPclBlocks, runPageEnterAnim, runPageExitAnim, navigateToPage, goBackFromDetail, pushModDetailHistory, openVersionDetail };
