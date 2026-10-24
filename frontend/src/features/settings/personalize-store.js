import { bridge as bridge } from '../../core/tauri-bridge.js';
import { applyThemeByName as applyThemeByName } from '../launch/launch-settings.js';
import { showToast as showToast, showConfirmDialog as showConfirmDialog } from '../misc/ui-components.js';
import { clearCustomThemeVars as clearCustomThemeVars, syncCustomThemeColorUI as syncCustomThemeColorUI } from './custom-theme.js';
import { getPersonalizeState, applyWallpaperByName, applyGlassEffectValue, applyLiquidGlassEffectValue, applyMinimalNavValue, applyHideNavLabelsValue, applyAutoCollapseNavValue, applyNavWidthValue, applyRememberWindowSizeValue, applyStartFullscreenValue } from './personalize-apply.js';
import { _updateCustomImagePreview } from './personalize-wallpaper.js';

async function loadWallpaperSubState() {
  const st = getPersonalizeState();
  if (!st) return;
  try {
    const [opacity, blur, fit, panoTheme, panoSpeed, panoFollow, customImage, customVideo] = await Promise.all([
      bridge?.store?.get('versepc_wallpaper_opacity'),
      bridge?.store?.get('versepc_wallpaper_blur'),
      bridge?.store?.get('versepc_wallpaper_fit'),
      bridge?.store?.get('versepc_panorama_theme'),
      bridge?.store?.get('versepc_panorama_speed'),
      bridge?.store?.get('versepc_panorama_mouse_follow'),
      bridge?.store?.get('versepc_custom_image'),
      bridge?.store?.get('versepc_custom_video'),
    ]);
    if (opacity != null) st.opacity = Number(opacity);
    if (blur != null) st.blur = Number(blur);
    if (fit) st.fit = fit;
    if (panoTheme) st.panoramaTheme = panoTheme;
    if (panoSpeed != null) st.panoramaSpeed = Number(panoSpeed);
    if (panoFollow === true) st.panoramaFollow = true;
    const customPath = customImage || customVideo || '';
    if (customPath) st.customFileName = customPath.split(/[\\/]/).pop();
  } catch (e) {
    console.warn('[Settings] Load wallpaper sub state error:', e);
  }
}

async function loadPersonalizeStateIntoStore() {
  const st = getPersonalizeState();
  if (!st) return;

  let legacy = null;
  try {
    const saved = await bridge?.store?.get('versepc_personalize_settings');
    if (saved) legacy = JSON.parse(saved);
  } catch (e) { /* 忽略旧数据解析错误 */ }

  const [savedTheme, savedWallpaper, glassSaved, liquidGlassSaved, customColor, customLight, weWallpaperSaved, navMinimalSaved, navHideLabelsSaved, navAutoCollapseSaved, navWidthSaved, rememberWindowSizeSaved, startFullscreenSaved] = await Promise.all([
    bridge?.store?.get('versepc_theme'),
    bridge?.store?.get('versepc_wallpaper'),
    bridge?.store?.get('versepc_glass_effect'),
    bridge?.store?.get('versepc_liquid_glass'),
    bridge?.store?.get('versepc_custom_theme_color'),
    bridge?.store?.get('versepc_custom_theme_light'),
    bridge?.store?.get('versepc_we_wallpaper'),
    bridge?.store?.get('versepc_nav_minimal'),
    bridge?.store?.get('versepc_nav_hide_labels'),
    bridge?.store?.get('versepc_nav_auto_collapse'),
    bridge?.store?.get('versepc_nav_width'),
    bridge?.store?.get('versepc_window_remember_size'),
    bridge?.store?.get('versepc_window_start_fullscreen'),
  ]);

  // ── 主题：单项键优先，其次旧复合键，最后默认浅色 ──
  let themeName = savedTheme || (legacy && legacy.theme) || null;
  if (themeName) {
    const legacyThemes = ['blue', 'purple', 'green', 'orange', 'red', 'pink', 'teal', 'cyan', 'amber'];
    if (legacyThemes.includes(themeName)) themeName = 'light';
  }
  st.theme = themeName || 'light';

  // ── 壁纸：单项键优先，其次旧复合键，最后无背景 ──
  let wpName = savedWallpaper || (legacy && legacy.wallpaper) || 'none';
  if (wpName === 'starry') wpName = 'panorama';
  st.wallpaper = wpName;

  // ── 毛玻璃：单项键优先，其次旧复合键 ──
  st.glassEffect = glassSaved !== null && glassSaved !== undefined
    ? (glassSaved === '1' || glassSaved === true)
    : (legacy && legacy.glassEffect !== undefined ? !!legacy.glassEffect : false);

  // ── 液态玻璃：单项键优先，其次旧复合键 ──
  st.liquidGlass = liquidGlassSaved !== null && liquidGlassSaved !== undefined
    ? (liquidGlassSaved === '1' || liquidGlassSaved === true)
    : (legacy && legacy.liquidGlass !== undefined ? !!legacy.liquidGlass : false);

  // ── 简约导航栏：默认关闭（使用经典侧栏） ──
  st.minimalNav = navMinimalSaved !== null && navMinimalSaved !== undefined
    ? (navMinimalSaved === '1' || navMinimalSaved === true)
    : false;

  // ── 导航栏钮名称隐藏：默认关闭（简约模式下显示按钮名称） ──
  st.hideNavLabels = navHideLabelsSaved !== null && navHideLabelsSaved !== undefined
    ? (navHideLabelsSaved === '1' || navHideLabelsSaved === true)
    : false;

  // ── 导航栏单点自动收回：默认关闭（点击后保持展开） ──
  st.autoCollapseNav = navAutoCollapseSaved !== null && navAutoCollapseSaved !== undefined
    ? (navAutoCollapseSaved === '1' || navAutoCollapseSaved === true)
    : false;

  // ── 默认导航栏宽度：默认 80px ──
  const savedNavWidth = parseInt(navWidthSaved, 10);
  st.navWidth = Number.isFinite(savedNavWidth)
    ? Math.max(64, Math.min(160, savedNavWidth))
    : 80;

  // ── 窗口大小记忆：单项键优先，默认开启（保留 1.7.2 已有的自动记忆行为） ──
  st.rememberWindowSize = rememberWindowSizeSaved !== null && rememberWindowSizeSaved !== undefined
    ? (rememberWindowSizeSaved === '1' || rememberWindowSizeSaved === true)
    : true;

  // ── 启动时全屏：单项键优先，默认关闭 ──
  st.startFullscreen = startFullscreenSaved !== null && startFullscreenSaved !== undefined
    ? (startFullscreenSaved === '1' || startFullscreenSaved === true)
    : false;

  if (customColor) st.customColor = customColor;
  if (customLight !== null && customLight !== undefined) {
    st.customLight = customLight === true || customLight === 'true' || customLight === '1';
  }

  // ── Wallpaper Engine 所选壁纸 ──
  st.weWallpaper = null;
  if (weWallpaperSaved) {
    try {
      st.weWallpaper = JSON.parse(weWallpaperSaved);
    } catch (e) { /* 忽略解析错误 */ }
  }

  await loadWallpaperSubState();
}

async function savePersonalizeSettings() {
  const st = getPersonalizeState();
  const settings = st
    ? {
        theme: st.theme,
        wallpaper: st.wallpaper,
        glassEffect: st.glassEffect,
        liquidGlass: st.liquidGlass,
        minimalNav: st.minimalNav,
        hideNavLabels: st.hideNavLabels,
        autoCollapseNav: st.autoCollapseNav,
        navWidth: st.navWidth,
        // 兼容旧字段（旧版本读取这两个字段）
        sidebarLabels: !st.hideNavLabels,
        sidebarPin: !st.autoCollapseNav,
        rememberWindowSize: st.rememberWindowSize,
        startFullscreen: st.startFullscreen
      }
    : {
        theme: document.querySelector('.theme-option.active')?.dataset.theme || 'light',
        wallpaper: document.querySelector('.wallpaper-option.active')?.dataset.wallpaper || 'none',
        glassEffect: document.getElementById('setting-glass-effect')?.checked ?? false,
        liquidGlass: document.getElementById('setting-liquid-glass')?.checked ?? false,
        minimalNav: document.getElementById('setting-minimal-nav')?.checked ?? false,
        hideNavLabels: document.getElementById('setting-nav-hide-labels')?.checked ?? false,
        autoCollapseNav: document.getElementById('setting-nav-auto-collapse')?.checked ?? false,
        navWidth: document.getElementById('setting-nav-width')?.value ?? 80,
        sidebarLabels: !(document.getElementById('setting-nav-hide-labels')?.checked ?? false),
        sidebarPin: !(document.getElementById('setting-nav-auto-collapse')?.checked ?? false),
        rememberWindowSize: document.getElementById('setting-window-remember-size')?.checked ?? true,
        startFullscreen: document.getElementById('setting-window-start-fullscreen')?.checked ?? false
      };

  try {
    await bridge.store.set('versepc_personalize_settings', JSON.stringify(settings));
    // 同步写入单项键，保证"保存设置"与实时修改的单项键一致，重启后以单项键为准
    await bridge.store.set('versepc_theme', settings.theme);
    await bridge.store.set('versepc_wallpaper', settings.wallpaper);
    await bridge.store.set('versepc_glass_effect', settings.glassEffect ? '1' : '0');
    await bridge.store.set('versepc_liquid_glass', settings.liquidGlass ? '1' : '0');
    await bridge.store.set('versepc_nav_minimal', settings.minimalNav ? '1' : '0');
    await bridge.store.set('versepc_nav_hide_labels', settings.hideNavLabels ? '1' : '0');
    await bridge.store.set('versepc_nav_auto_collapse', settings.autoCollapseNav ? '1' : '0');
    await bridge.store.set('versepc_nav_width', Number(settings.navWidth) || 80);
    await bridge.store.set('versepc_window_remember_size', settings.rememberWindowSize ? '1' : '0');
    await bridge.store.set('versepc_window_start_fullscreen', settings.startFullscreen ? '1' : '0');
    showToast('个性化设置已保存', 'success');
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

async function resetPersonalizeSettings() {
  const confirmed = await showConfirmDialog('重置设置', '确定要重置个性化设置为默认值吗?', '重置', '取消');
  if (!confirmed) return;

  const st = getPersonalizeState();
  if (st) {
    st.theme = 'light';
    st.wallpaper = 'none';
    st.glassEffect = false;
    st.liquidGlass = false;
    st.minimalNav = false;
    st.hideNavLabels = false;
    st.autoCollapseNav = false;
    st.navWidth = 80;
    st.rememberWindowSize = true;
    st.startFullscreen = false;
    st.customColor = '#4c8dff';
    st.customLight = false;
    st.customColorGroupVisible = false;
    st.opacity = 100;
    st.blur = 0;
    st.fit = 'cover';
    st.panoramaTheme = 'overworld';
    st.panoramaSpeed = 5;
    st.panoramaFollow = false;
    st.customFileName = '未选择';
  }

  await applyThemeByName('light');
  await applyWallpaperByName('none');
  applyGlassEffectValue(false);
  applyLiquidGlassEffectValue(false);
  applyMinimalNavValue(false);
  applyHideNavLabelsValue(false);
  applyAutoCollapseNavValue(false);
  applyNavWidthValue(80);
  applyRememberWindowSizeValue(true);
  applyStartFullscreenValue(false);

  if (typeof clearCustomThemeVars === 'function') clearCustomThemeVars();
  if (typeof syncCustomThemeColorUI === 'function') syncCustomThemeColorUI('#4c8dff');

  try {
    await bridge.store.set('versepc_personalize_settings', JSON.stringify({
      theme: 'light',
      wallpaper: 'none',
      glassEffect: false,
      liquidGlass: false,
      minimalNav: false,
      hideNavLabels: false,
      autoCollapseNav: false,
      navWidth: 80,
      sidebarLabels: false,
      sidebarPin: false,
      rememberWindowSize: true,
      startFullscreen: false
    }));
    await bridge.store.set('versepc_theme', 'light');
    await bridge.store.set('versepc_wallpaper', 'none');
    await bridge.store.delete('versepc_solid_color');
    await bridge.store.delete('versepc_custom_theme_color');
    await bridge.store.delete('versepc_custom_theme_light');
    await bridge.store.set('versepc_wallpaper_opacity', 100);
    await bridge.store.set('versepc_wallpaper_blur', 0);
    await bridge.store.set('versepc_wallpaper_fit', 'cover');
    await bridge.store.delete('versepc_custom_image');
    await bridge.store.delete('versepc_custom_video');
    await bridge.store.set('versepc_panorama_theme', 'overworld');
    await bridge.store.set('versepc_glass_effect', '0');
    await bridge.store.set('versepc_liquid_glass', '0');
    await bridge.store.set('versepc_nav_minimal', '0');
    await bridge.store.set('versepc_nav_hide_labels', '0');
    await bridge.store.set('versepc_nav_auto_collapse', '0');
    await bridge.store.set('versepc_nav_width', 80);
    await bridge.store.set('versepc_window_remember_size', '1');
    await bridge.store.set('versepc_window_start_fullscreen', '0');
    await bridge.store.delete('versepc_window_state');
    _updateCustomImagePreview(null);
    const nameEl = document.getElementById('custom-wallpaper-file-name');
    if (nameEl) nameEl.textContent = '未选择';
  } catch (e) {
    console.error('[Settings] Reset personalize settings save error:', e);
  }

  showToast('个性化设置已重置', 'success');
}

async function loadPersonalizeSettings() {
  await loadPersonalizeStateIntoStore();
  const st = getPersonalizeState();
  if (!st) return;

  // 应用效果（引擎/根节点属性/持久化由核心函数负责）
  await applyThemeByName(st.theme);
  await applyWallpaperByName(st.wallpaper);
  applyGlassEffectValue(st.glassEffect);
  applyLiquidGlassEffectValue(st.liquidGlass);
  applyMinimalNavValue(st.minimalNav);
  applyHideNavLabelsValue(st.hideNavLabels);
  applyAutoCollapseNavValue(st.autoCollapseNav);
  applyNavWidthValue(st.navWidth);
}

export { loadWallpaperSubState, loadPersonalizeStateIntoStore, savePersonalizeSettings, resetPersonalizeSettings, loadPersonalizeSettings };
