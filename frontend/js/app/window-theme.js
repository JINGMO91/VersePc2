/**
 * @file window-theme.js
 * @description 主题切换与窗口控制 - 亮/暗主题、自定义强调色、窗口最小化/关闭、页面导航
 */
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
  window.electronAPI?.store?.set('versepc_theme', themeName).catch(() => {});

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
  if (window.electronAPI && window.electronAPI.showOpenDialog) {
    window.electronAPI.showOpenDialog({ properties: ['openDirectory'] }).then(result => {
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
  if (el) el.textContent = installedVersions.length;
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
window.applyNavigationMode = applyNavigationMode;

function setupWindowControls() {
  const windowControls = document.getElementById('window-controls');
  const windowModeCheckbox = document.getElementById('setting-window-mode');
  const exitLauncherBtn = document.getElementById('exit-launcher-btn');

  const isMac = window.electronAPI?.isMac === true;
  if (isMac) {
    document.body.classList.add('is-mac');
  }
  if (windowControls && !isMac) windowControls.style.display = 'flex';

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
    window.closeSidebarPanel = () => {
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
    window.electronAPI.minimize();
  });

  const winBtnMaximize = document.getElementById('win-btn-maximize');
  if (winBtnMaximize) winBtnMaximize.addEventListener('click', () => {
    window.electronAPI.maximize();
  });

  const winBtnRestore = document.getElementById('win-btn-restore');
  if (winBtnRestore) winBtnRestore.addEventListener('click', () => {
    window.electronAPI.maximize();
  });

  const winBtnClose = document.getElementById('win-btn-close');
  if (winBtnClose) winBtnClose.addEventListener('click', () => {
    window.electronAPI.close();
  });

  if (window.electronAPI.onRequestCloseAnimate) {
    window.electronAPI.onRequestCloseAnimate(() => {
      const app = document.getElementById('app');
      if (app && !app.classList.contains('app-closing')) {
        app.classList.add('app-closing');
      }
    });
  }

  window.electronAPI.onWindowStateChanged((data) => {
    isWindowMaximized = data.maximized;
    isWindowMode = !data.fullscreen;
    if (windowModeCheckbox) {
      windowModeCheckbox.checked = isWindowMode;
    }
    updateWindowButtons();
  });

  window.electronAPI.onWindowModeChanged((data) => {
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
      window.electronAPI.setWindowMode(enabled);
      updateWindowButtons();
    });
  }

  if (exitLauncherBtn) {
    exitLauncherBtn.addEventListener('click', () => {
      window.electronAPI.quitApp();
    });
  }

  window.electronAPI.isFullscreen().then((fullscreen) => {
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
        openVersionSettings(versionId, customName || versionId);
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

  if (!controls || window.electronAPI?.isMac === true) return;

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

  if (currentPage && currentPage.id === 'page-accounts' && _currentDetailAccount) {
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

  previousPage = currentPage?.id?.replace('page-', '') || null;

  // 切到账户页后，等页面动画/hidden→visible 完成、尺寸稳定，再把轮播轨道定位到中间，
  // 避免首次进入时卡片闪到最左边
  if (pageName === 'accounts' && typeof resetCarouselPosition === 'function') {
    setTimeout(() => resetCarouselPosition(), 450);
    setTimeout(() => resetCarouselPosition(), 900);
  }
}
