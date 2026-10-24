import { API } from '../../core/api.js';
/**
 * @file window-theme.js
 * @description 主题切换与窗口控制 - 亮/暗主题、自定义强调色、窗口最小化/关闭、页面导航
 */
import { bridge } from '../../core/tauri-bridge.js';

import { resetCarouselPosition, showAccountList, getCurrentDetailAccount } from '../accounts/accounts.js';
import { applyAccentColor } from '../launch/java.js';
import { showToast } from '../misc/ui-components.js';
import { updateWallpaperTheme } from './wallpaper-engine.js';
import { selectLaunchVersion } from '../versions/versions-list.js';
import { navigateToPage, openVersionDetail } from '../versions/versions-nav.js';

import { appState } from '../../core/app-state.js';
function switchTheme(themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
  document.documentElement.classList.toggle('dark-theme', themeName === 'dark');
  document.documentElement.classList.toggle('light-theme', themeName === 'light');

  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-hover');
  document.documentElement.style.removeProperty('--accent-rgb');

  const app = document.getElementById('app');
  if (app && themeName === 'light') {
    app.classList.remove('wp-light', 'wp-dark');
  }

  if (typeof updateWallpaperTheme === 'function') {
    updateWallpaperTheme(themeName === 'dark');
  }

  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-theme') === themeName);
  });

  const themeDef = getComputedStyle(document.documentElement);
  const accentColor = themeDef.getPropertyValue('--accent').trim();

  const accentColorInput = document.getElementById('custom-accent-color');
  if (accentColorInput) accentColorInput.value = accentColor;
  const accentColorValueEl = document.getElementById('custom-color-value');
  if (accentColorValueEl) accentColorValueEl.textContent = accentColor;
  const colorPreviewDot = document.getElementById('color-preview-dot');
  if (colorPreviewDot) colorPreviewDot.style.background = accentColor;

  API.saveSetting('theme', themeName);
  API.saveSetting('accentColor', accentColor);
  bridge?.store?.set('versepc_theme', themeName).catch(() => {});

  showToast(`已切换到「${getThemeLabel(themeName)}」主题`, 'success');
}

function applyCustomAccent() {
  const colorInput = document.getElementById('custom-accent-color');
  const color = colorInput?.value;
  if (!color) return;
  const colorValueEl = document.getElementById('custom-color-value');
  if (colorValueEl) colorValueEl.textContent = color;
  applyAccentColor(color);
  API.saveSetting('accentColor', color);
  showToast('强调色已应用', 'success');
}

function getThemeLabel(themeName) {
  const labels = {
    dark: '黑色',
    light: '白色'
  };
  return labels[themeName] || themeName;
}

function browseFolder(type) {
  if (bridge && bridge.showOpenDialog) {
    bridge.showOpenDialog({ properties: ['openDirectory'] }).then(result => {
      if (!result.canceled && result.filePaths.length > 0) {
        if (type === 'target') {
          document.getElementById('setting-target-dir').value = result.filePaths[0];
        }
      }
    }).catch(() => {});
  } else {
    showToast('请手动输入路径', 'info');
  }
}

function updateHomeStats() {
  const el = document.getElementById('stat-installed');
  if (el) el.textContent = appState.installedVersions.length;
}

let isWindowMode = false;
let isWindowMaximized = false;

/**
 * 应用导航栏模式。
 * classic（默认）：左侧固定侧栏，图标 + 名称，资源等子菜单在侧栏内展开。
 * minimal：保留原有的悬浮胶囊导航。
 */
function applyNavigationMode(minimal) {
  const body = document.body;
  const useMinimal = !!minimal;
  body.classList.toggle('minimal-nav', useMinimal);
  body.classList.toggle('classic-nav', !useMinimal);
  try {
    localStorage.setItem('versepc_nav_minimal', useMinimal ? '1' : '0');
  } catch (e) {}

  if (useMinimal) {
    body.classList.remove('classic-sidebar-collapsed');
    let open = false;
    try { open = localStorage.getItem('versepc_sidebar_open') === '1'; } catch (e) {}
    body.classList.toggle('sidebar-open', open);
  } else {
    body.classList.remove('sidebar-open');
    // 经典侧栏始终显示名称、点击导航不自动收起；这两个状态类只属于简约模式
    body.classList.remove('show-nav-labels');
    body.classList.remove('sidebar-keep-open');
    let collapsed = false;
    try { collapsed = localStorage.getItem('versepc_classic_sidebar_collapsed') === '1'; } catch (e) {}
    body.classList.toggle('classic-sidebar-collapsed', collapsed);
  }

  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  if (toggleBtn) {
    const expanded = useMinimal
      ? body.classList.contains('sidebar-open')
      : !body.classList.contains('classic-sidebar-collapsed');
    toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
  // 导航栏宽度变化会影响 Vue 网格/卡片布局
  window.dispatchEvent(new Event('resize'));
}
// 页面导航完成后收起侧边栏（由 setupWindowControls 注册实现）
let closeSidebarPanelImpl = null;
export function closeSidebarPanel() {
  if (closeSidebarPanelImpl) closeSidebarPanelImpl();
}

function setupWindowControls() {
  const windowControls = document.getElementById('window-controls');
  const windowModeCheckbox = document.getElementById('setting-window-mode');
  const exitLauncherBtn = document.getElementById('exit-launcher-btn');

  const isMac = bridge.isMac === true;
  if (isMac) {
    document.body.classList.add('is-mac');
  }
  // macOS 窗口同样是无边框（decorations:false），必须显示自绘的最小化/最大化/关闭按钮
  if (windowControls) windowControls.style.display = 'flex';

  // 侧边导航：经典模式为左侧固定侧栏，简约模式为悬浮胶囊
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  if (sidebarToggleBtn) {
    const overlay = document.getElementById('sidebar-overlay');
    const isClassicNav = () => document.body.classList.contains('classic-nav');

    const setSidebarOpen = (open) => {
      document.body.classList.toggle('sidebar-open', open);
      sidebarToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      try { localStorage.setItem('versepc_sidebar_open', open ? '1' : '0'); } catch (e) {}
      // 触发 resize，让 Vue 组件（网格、卡片等依赖宽度的布局）重新适配
      window.dispatchEvent(new Event('resize'));
    };

    const setClassicCollapsed = (collapsed) => {
      document.body.classList.toggle('classic-sidebar-collapsed', collapsed);
      sidebarToggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      try { localStorage.setItem('versepc_classic_sidebar_collapsed', collapsed ? '1' : '0'); } catch (e) {}
      window.dispatchEvent(new Event('resize'));
    };

    sidebarToggleBtn.addEventListener('click', () => {
      if (isClassicNav()) {
        setClassicCollapsed(!document.body.classList.contains('classic-sidebar-collapsed'));
      } else {
        setSidebarOpen(!document.body.classList.contains('sidebar-open'));
      }
    });

    if (overlay) {
      overlay.addEventListener('click', () => {
        if (isClassicNav()) return;
        // 「导航栏单点自动收回」关闭时（body.sidebar-keep-open），点击遮罩/页面区域不收起
        if (document.body.classList.contains('sidebar-keep-open')) return;
        setSidebarOpen(false);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !isClassicNav() && document.body.classList.contains('sidebar-open')) {
        setSidebarOpen(false);
      }
    });

    // 供页面导航等逻辑复用：完成导航后自动收起胶囊（经典侧栏不收起）
    closeSidebarPanelImpl = () => {
      if (isClassicNav()) return;
      setSidebarOpen(false);
    };

    // 恢复简约模式上次的展开状态（经典模式由 applyNavigationMode 恢复）
    if (!isClassicNav()) {
      try {
        if (localStorage.getItem('versepc_sidebar_open') === '1') {
          document.body.classList.add('sidebar-open');
          sidebarToggleBtn.setAttribute('aria-expanded', 'true');
        }
      } catch (e) {}
    }
  }

  const winBtnMinimize = document.getElementById('win-btn-minimize');
  if (winBtnMinimize) winBtnMinimize.addEventListener('click', () => {
    bridge.minimize();
  });

  const winBtnMaximize = document.getElementById('win-btn-maximize');
  if (winBtnMaximize) winBtnMaximize.addEventListener('click', () => {
    bridge.maximize();
  });

  const winBtnRestore = document.getElementById('win-btn-restore');
  if (winBtnRestore) winBtnRestore.addEventListener('click', () => {
    bridge.maximize();
  });

  const winBtnClose = document.getElementById('win-btn-close');
  if (winBtnClose) winBtnClose.addEventListener('click', () => {
    bridge.close();
  });

  if (bridge.onRequestCloseAnimate) {
    bridge.onRequestCloseAnimate(() => {
      const app = document.getElementById('app');
      if (app && !app.classList.contains('app-closing')) {
        app.classList.add('app-closing');
      }
    });
  }

  bridge.onWindowStateChanged((data) => {
    isWindowMaximized = data.maximized;
    isWindowMode = !data.fullscreen;
    if (windowModeCheckbox) {
      windowModeCheckbox.checked = isWindowMode;
    }
    updateWindowButtons();
  });

  bridge.onWindowModeChanged((data) => {
    isWindowMode = data.windowMode;
    isWindowMaximized = data.maximized;
    if (windowModeCheckbox) {
      windowModeCheckbox.checked = data.windowMode;
    }
    updateWindowButtons();
  });

  if (windowModeCheckbox) {
    windowModeCheckbox.addEventListener('change', () => {
      const enabled = windowModeCheckbox.checked;
      isWindowMode = enabled;
      bridge.setWindowMode(enabled);
      updateWindowButtons();
    });
  }

  if (exitLauncherBtn) {
    exitLauncherBtn.addEventListener('click', () => {
      bridge.quitApp();
    });
  }

  bridge.isFullscreen().then((fullscreen) => {
    isWindowMode = !fullscreen;
    if (windowModeCheckbox) {
      windowModeCheckbox.checked = isWindowMode;
    }
    updateWindowButtons();
  });
}

function setupVersionListClicks() {
  document.addEventListener('click', (e) => {
    // 主页内嵌版本卡片：跳转到独立的"已安装版本"页面
    const homeCard = e.target.closest('.home-current-version-card');
    if (homeCard) {
      navigateToPage('installed-versions');
      return;
    }

    // 齿轮按钮：进入版本设置页（阻止冒泡，不触发卡片选中）
    const settingsBtn = e.target.closest('.version-item-settings-btn');
    if (settingsBtn) {
      e.stopPropagation();
      const versionId = settingsBtn.dataset.versionId;
      const customName = settingsBtn.dataset.customName || '';
      if (versionId) {
        import('../versions/version-settings.js')
          .then((m) => m.openVersionSettings(versionId, customName || versionId))
          .catch((err) => console.error('[theme] 版本设置模块加载失败:', err));
      }
      return;
    }

    // 卡片本体（排除其他按钮如"设置""删除"）
    const versionItem = e.target.closest('.version-item-clickable');
    if (versionItem && !e.target.closest('button')) {
      const versionId = versionItem.dataset.versionId;
      const versionUrl = versionItem.dataset.versionUrl || '';
      const versionType = versionItem.dataset.versionType || 'release';
      const isInstalled = versionItem.dataset.installed === 'true';
      const customName = versionItem.dataset.customName || '';

      if (versionId) {
        if (isInstalled) {
          selectLaunchVersion(versionId);
        } else {
          openVersionDetail(versionId, versionUrl, versionType);
        }
      }
    }
  });
}

function updateWindowButtons() {
  const controls = document.getElementById('window-controls');
  const maximizeBtn = document.getElementById('win-btn-maximize');
  const restoreBtn = document.getElementById('win-btn-restore');

  if (!controls) return;

  controls.style.display = 'flex';
  if (isWindowMode) {
    if (isWindowMaximized) {
      maximizeBtn.style.display = 'none';
      restoreBtn.style.display = 'flex';
    } else {
      maximizeBtn.style.display = 'flex';
      restoreBtn.style.display = 'none';
    }
  } else {
    maximizeBtn.style.display = 'flex';
    restoreBtn.style.display = 'none';
  }
}





// ─── 设置子菜单和功能函数 ──────────────────────────────────

function setupSettingsSubmenu() {
}

function switchPage(pageName) {
  const currentPage = document.querySelector('.page.active');
  const target = document.getElementById(`page-${pageName}`);
  if (!target || target === currentPage) return;

  if (currentPage && currentPage.id === 'page-accounts' && getCurrentDetailAccount()) {
    showAccountList();
  }

  if (currentPage) {
    currentPage.style.animation = 'pageOut 0.18s var(--ease-out-expo) forwards';
    setTimeout(() => {
      currentPage.classList.remove('active');
      currentPage.style.animation = '';
      target.classList.add('active');
      target.style.animation = 'pageIn 0.35s var(--ease-out-expo) backwards';
    }, 160);
  } else {
    target.classList.add('active');
    target.style.animation = 'pageIn 0.35s var(--ease-out-expo) backwards';
  }

  appState.previousPage = currentPage?.id?.replace('page-', '') || null;

  // 切到账户页后，等页面动画/hidden→visible 完成、尺寸稳定，再把轮播轨道定位到中间，
  // 避免首次进入时卡片闪到最左边
  if (pageName === 'accounts' && typeof resetCarouselPosition === 'function') {
    setTimeout(() => resetCarouselPosition(), 450);
    setTimeout(() => resetCarouselPosition(), 900);
  }
}

// 迁移过渡：保持旧脚本与模板可用的全局名（Phase 5 移除）
export { switchTheme, applyCustomAccent, getThemeLabel, browseFolder, updateHomeStats, applyNavigationMode, setupWindowControls, setupVersionListClicks, updateWindowButtons, setupSettingsSubmenu, switchPage, isWindowMode, isWindowMaximized };
// let/var 用访问器同步读写，避免旧脚本读到过期值
