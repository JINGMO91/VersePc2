import { bridge as bridge } from '../../core/tauri-bridge.js';
import { LiquidGlass as LiquidGlass } from './liquid-glass.js';
import { applyNavigationMode as applyNavigationMode } from './window-theme.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { switchWallpaperMode as switchWallpaperMode, setWallpaperOpacity as setWallpaperOpacity, setWallpaperBlur as setWallpaperBlur, setWallpaperFitMode as setWallpaperFitMode, setPanoramaTheme as setPanoramaTheme, setPanoramaRotationSpeed as setPanoramaRotationSpeed, setPanoramaMouseFollow as setPanoramaMouseFollow, getWallpaperEngine as getWallpaperEngine } from './wallpaper-engine.js';
import { personalizeState as personalizeState } from './personalize-state.js';
import { _ensureWallpaperEngine } from './personalize-wallpaper.js';

function getPersonalizeState() {
  return personalizeState;
}

async function applyWallpaperByName(mode) {
  // Wallpaper Engine 专用模式：按所选壁纸类型分发渲染
  if (mode === 'wallpaperEngine') {
    const st = getPersonalizeState();
    let sel = st && st.weWallpaper;
    if (!sel) {
      try {
        const saved = await bridge?.store?.get('versepc_we_wallpaper');
        if (saved) sel = JSON.parse(saved);
      } catch (e) {}
    }
    if (!sel) return;
    await _ensureWallpaperEngine();
    _applyWeDispatch(sel);
    return;
  }

  await _ensureWallpaperEngine();

  // 离开 WE 壁纸：清掉 WE 视频流/场景标记，避免自定义壁纸误用 wewp 本地协议
  if (typeof getWallpaperEngine() !== 'undefined' && getWallpaperEngine()) {
    getWallpaperEngine().weVideo = null;
  }

  if (typeof switchWallpaperMode === 'function') {
    switchWallpaperMode(mode);
  }

  const st = getPersonalizeState();
  if (st) st.wallpaper = mode;

  const isAurora = mode === 'auroraVideo';
  const isPanorama = mode === 'panorama';

  if (isAurora) {
    if (typeof setWallpaperFitMode === 'function') setWallpaperFitMode('cover');
    if (typeof setWallpaperBlur === 'function') setWallpaperBlur(0);
    if (typeof setWallpaperOpacity === 'function') setWallpaperOpacity(1);
    document.body.classList.add('aurora-theme');
    if (st) st.fit = 'cover';
    try {
      await bridge.store.set('versepc_wallpaper_fit', 'cover');
    } catch (e) {}
  } else {
    document.body.classList.remove('aurora-theme');
  }

  if (isPanorama) {
    try {
      const [savedTheme, savedSpeed, savedFollow] = await Promise.all([
        bridge?.store?.get('versepc_panorama_theme'),
        bridge?.store?.get('versepc_panorama_speed'),
        bridge?.store?.get('versepc_panorama_mouse_follow'),
      ]);
      if (savedTheme && typeof setPanoramaTheme === 'function') setPanoramaTheme(savedTheme);
      if (savedSpeed != null && typeof setPanoramaRotationSpeed === 'function') setPanoramaRotationSpeed(savedSpeed * 0.001);
      if (savedFollow === true && typeof setPanoramaMouseFollow === 'function') setPanoramaMouseFollow(true);
    } catch (e) {
      console.warn('[Settings] Failed to restore panorama settings:', e);
    }
  }

  try {
    await bridge.store.set('versepc_wallpaper', mode);
  } catch (e) {
    console.error('[Settings] Save wallpaper error:', e);
  }
}

async function _applyWeDispatch(sel) {
  if (!sel || typeof getWallpaperEngine() === 'undefined' || !getWallpaperEngine()) return;
  const type = sel.type;
  // WE 壁纸没有单独的模糊/透明度/适配控件，渲染时忽略自定义壁纸遗留的值，
  // 否则之前设置的背景模糊会叠加到 WE 视频/场景上，看起来“非常模糊”。
  // 只清视频流标记，不修改 wallpaperBlur/opacity/fit，避免切回自定义壁纸时丢失设置。
  getWallpaperEngine().weVideo = null;
  if (type === 'video' && sel.filePath) {
    getWallpaperEngine().weVideo = { id: sel.id, file: sel.file };
    getWallpaperEngine().customVideoPath = sel.filePath;
    if (getWallpaperEngine().currentMode === 'customVideo' && getWallpaperEngine().renderer && getWallpaperEngine().renderer.loadVideo) {
      getWallpaperEngine().renderer.loadVideo(sel.filePath);
    } else if (typeof switchWallpaperMode === 'function') {
      switchWallpaperMode('customVideo');
    }
  } else if (type === 'web') {
    const relFile = sel.file || 'index.html';
    const segs = String(relFile).split(/[\\/]/).map(s => encodeURIComponent(s)).join('/');
    const src = 'wewp://localhost/' + encodeURIComponent(sel.id || '0') + '/' + segs;
    getWallpaperEngine().webWallpaperSrc = src;
    if (getWallpaperEngine().currentMode === 'webWallpaper' && getWallpaperEngine().renderer && getWallpaperEngine().renderer.loadWeb) {
      getWallpaperEngine().renderer.loadWeb(src);
    } else if (typeof switchWallpaperMode === 'function') {
      switchWallpaperMode('webWallpaper');
    }
  } else if (type === 'scene') {
    // 场景壁纸暂时只显示预览图，避免外部渲染组件启动超时/报错。
    // 原生固定分辨率渲染器完成后，再在这里切换回动态场景。
    getWallpaperEngine()._sceneWorkshopId = null;
    getWallpaperEngine().scenePort = 0;

    let preview = sel.previewPath;
    if (!preview && sel.preview && sel.dir) {
      const sep = (bridge && bridge.isWindows === false) ? '/' : '\\';
      preview = String(sel.dir).replace(/[\\/][^\\/]+$/, '') + sep + sel.preview;
    }

    if (preview) {
      getWallpaperEngine().customImagePath = preview;
      if (getWallpaperEngine().currentMode === 'customImage' && getWallpaperEngine().renderer && getWallpaperEngine().renderer.loadImage) {
        getWallpaperEngine().renderer.loadImage(preview);
      } else if (typeof switchWallpaperMode === 'function') {
        switchWallpaperMode('customImage');
      }
    } else if (typeof switchWallpaperMode === 'function') {
      // 没有预览图时保持无背景，也不弹错误
      switchWallpaperMode('none');
    }
  } else {
    // application / 未知类型：用预览图静态占位，并明确提示限制
    if (sel.previewPath) {
      getWallpaperEngine().customImagePath = sel.previewPath;
      if (getWallpaperEngine().currentMode === 'customImage' && getWallpaperEngine().renderer && getWallpaperEngine().renderer.loadImage) {
        getWallpaperEngine().renderer.loadImage(sel.previewPath);
      } else if (typeof switchWallpaperMode === 'function') {
        switchWallpaperMode('customImage');
      }
    }
    if (typeof showToast === 'function' && type !== 'background') {
      const typeName = type === 'application' ? '应用' : '该';
      showToast(`${typeName}型壁纸暂不支持动态渲染，已显示静态预览`, 'info');
    }
  }
}

async function applyWeWallpaper(sel) {
  if (!sel) return;
  const st = getPersonalizeState();
  if (st) {
    st.wallpaper = 'wallpaperEngine';
    st.weWallpaper = sel;
  }
  try { await bridge.store.set('versepc_we_wallpaper', JSON.stringify(sel)); } catch (e) {}
  try { await bridge.store.set('versepc_wallpaper', 'wallpaperEngine'); } catch (e) {}
  await _ensureWallpaperEngine();
  _applyWeDispatch(sel);
}

function applyPanoramaThemeByName(theme) {
  if (typeof setPanoramaTheme === 'function') setPanoramaTheme(theme);
  bridge?.store?.set('versepc_panorama_theme', theme).catch(() => {});
  const st = getPersonalizeState();
  if (st) st.panoramaTheme = theme;
}

function applyWallpaperOpacityValue(value) {
  const opacity = value / 100;
  if (typeof setWallpaperOpacity === 'function') setWallpaperOpacity(opacity);
  bridge?.store?.set('versepc_wallpaper_opacity', value).catch(() => {});
  const st = getPersonalizeState();
  if (st) st.opacity = Number(value);
}

function applyWallpaperBlurValue(value) {
  if (typeof setWallpaperBlur === 'function') setWallpaperBlur(parseInt(value));
  bridge?.store?.set('versepc_wallpaper_blur', value).catch(() => {});
  const st = getPersonalizeState();
  if (st) st.blur = Number(value);
}

function applyWallpaperFitValue(value) {
  if (typeof setWallpaperFitMode === 'function') setWallpaperFitMode(value);
  bridge?.store?.set('versepc_wallpaper_fit', value).catch(() => {});
  const st = getPersonalizeState();
  if (st) st.fit = value;
}

function applyPanoramaSpeedValue(value) {
  const speed = value * 0.001;
  if (typeof setPanoramaRotationSpeed === 'function') setPanoramaRotationSpeed(speed);
  bridge?.store?.set('versepc_panorama_speed', parseInt(value)).catch(() => {});
  const st = getPersonalizeState();
  if (st) st.panoramaSpeed = Number(value);
}

function applyPanoramaFollowValue(enabled) {
  if (typeof setPanoramaMouseFollow === 'function') setPanoramaMouseFollow(enabled);
  bridge?.store?.set('versepc_panorama_mouse_follow', enabled);
  const st = getPersonalizeState();
  if (st) st.panoramaFollow = !!enabled;
}

function applyGlassEffectValue(enabled) {
  if (enabled) {
    document.documentElement.removeAttribute('data-no-glass');
  } else {
    document.documentElement.setAttribute('data-no-glass', '');
  }
  bridge.store.set('versepc_glass_effect', enabled ? '1' : '0').catch(() => {});
  const st = getPersonalizeState();
  if (st) st.glassEffect = !!enabled;
}

function applyLiquidGlassEffectValue(enabled) {
  if (enabled) {
    document.documentElement.setAttribute('data-liquid-glass', '');
  } else {
    document.documentElement.removeAttribute('data-liquid-glass');
  }
  syncLiquidGlassSurfaces(enabled);
  bridge.store.set('versepc_liquid_glass', enabled ? '1' : '0').catch(() => {});
  const st = getPersonalizeState();
  if (st) st.liquidGlass = !!enabled;
}

function applyMinimalNavValue(enabled) {
  bridge.store.set('versepc_nav_minimal', enabled ? '1' : '0').catch(() => {});
  if (typeof applyNavigationMode === 'function') applyNavigationMode(!!enabled);
  const st = getPersonalizeState();
  if (st) st.minimalNav = !!enabled;
  // 经典侧栏不挂胶囊折射；切回简约时按当前液态玻璃状态重新同步
  if (st) syncLiquidGlassSurfaces(st.liquidGlass);
  // 切换模式后同步两个子选项的状态类（经典侧栏会忽略这两个类）
  applyHideNavLabelsValue(st ? st.hideNavLabels : false);
  applyAutoCollapseNavValue(st ? st.autoCollapseNav : false);
}

function applyHideNavLabelsValue(enabled) {
  if (document.body.classList.contains('minimal-nav')) {
    document.body.classList.toggle('show-nav-labels', !enabled);
  } else {
    document.body.classList.remove('show-nav-labels');
  }
  bridge.store.set('versepc_nav_hide_labels', enabled ? '1' : '0').catch(() => {});
  const st = getPersonalizeState();
  if (st) st.hideNavLabels = !!enabled;
}

function applyAutoCollapseNavValue(enabled) {
  if (document.body.classList.contains('minimal-nav')) {
    document.body.classList.toggle('sidebar-keep-open', !enabled);
  } else {
    document.body.classList.remove('sidebar-keep-open');
  }
  bridge.store.set('versepc_nav_auto_collapse', enabled ? '1' : '0').catch(() => {});
  const st = getPersonalizeState();
  if (st) st.autoCollapseNav = !!enabled;
}

function applyNavWidthValue(value) {
  let width = parseInt(value, 10);
  if (!Number.isFinite(width)) width = 80;
  width = Math.max(64, Math.min(160, width));
  document.body.style.setProperty('--classic-sidebar-width', width + 'px');
  bridge.store.set('versepc_nav_width', width).catch(() => {});
  const st = getPersonalizeState();
  if (st) st.navWidth = width;
}

function applySidebarLabelsValue(enabled) {
  applyHideNavLabelsValue(!enabled);
}

function applySidebarPinValue(enabled) {
  applyAutoCollapseNavValue(!enabled);
}

function applyRememberWindowSizeValue(enabled) {
  bridge.store.set('versepc_window_remember_size', enabled ? '1' : '0').catch(() => {});
  // 关闭记忆时清掉旧尺寸，避免以后重新开启时恢复更早之前的窗口大小
  if (!enabled) {
    bridge.store.delete('versepc_window_state').catch(() => {});
  }
  const st = getPersonalizeState();
  if (st) st.rememberWindowSize = !!enabled;
}

function applyStartFullscreenValue(enabled) {
  bridge.store.set('versepc_window_start_fullscreen', enabled ? '1' : '0').catch(() => {});
  const st = getPersonalizeState();
  if (st) st.startFullscreen = !!enabled;
}

function syncLiquidGlassSurfaces(enabled) {
  const engine = LiquidGlass;
  if (!engine || !engine.supported) return;
  const targets = [
    [document.getElementById('sidebar-toggle-btn'), { depth: 0.5, strength: 0.3, blur: 1.2 }]
  ];
  // SDF 折射只适合胶囊造型；经典侧栏是整块面板，不挂折射层
  if (document.body.classList.contains('minimal-nav')) {
    targets.unshift([document.querySelector('.sidebar'), { depth: 0.5, strength: 0.34, blur: 1.5 }]);
  }
  targets.forEach(([element, options]) => {
    if (!element) return;
    if (enabled) engine.apply(element, options);
    else engine.remove(element);
  });
}

function applyThemeColors(themeName) {
  if (themeName === 'dark') {
    document.documentElement.style.setProperty('--accent', '#ffffff');
    document.documentElement.style.setProperty('--accent-hover', '#d0d0d0');
  } else {
    document.documentElement.style.setProperty('--accent', '#1a1a1a');
    document.documentElement.style.setProperty('--accent-hover', '#333333');
  }
}

async function updateCustomAccentColor(color) {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  if (theme === 'dark') {
    document.documentElement.style.setProperty('--accent', '#ffffff');
    document.documentElement.style.setProperty('--accent-hover', '#d0d0d0');
    document.documentElement.style.setProperty('--accent-rgb', '255, 255, 255');
  } else {
    document.documentElement.style.setProperty('--accent', '#1a1a1a');
    document.documentElement.style.setProperty('--accent-hover', '#333333');
    document.documentElement.style.setProperty('--accent-rgb', '26, 26, 26');
  }
}

function aiToggleApiKeyVisibility() {
  const input = document.getElementById('ai-api-key-input');
  if (!input) return;
  const btn = input.parentElement.querySelector('button');
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '隐藏';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '显示';
  }
}

function toggleGlassEffect(enabled) {
  applyGlassEffectValue(enabled);
}

function toggleLiquidGlassEffect(enabled) {
  applyLiquidGlassEffectValue(enabled);
}

export { getPersonalizeState, applyWallpaperByName, _applyWeDispatch, applyWeWallpaper, applyPanoramaThemeByName, applyWallpaperOpacityValue, applyWallpaperBlurValue, applyWallpaperFitValue, applyPanoramaSpeedValue, applyPanoramaFollowValue, applyGlassEffectValue, applyLiquidGlassEffectValue, applyMinimalNavValue, applyHideNavLabelsValue, applyAutoCollapseNavValue, applyNavWidthValue, applySidebarLabelsValue, applySidebarPinValue, applyRememberWindowSizeValue, applyStartFullscreenValue, syncLiquidGlassSurfaces, applyThemeColors, updateCustomAccentColor, aiToggleApiKeyVisibility, toggleGlassEffect, toggleLiquidGlassEffect };
