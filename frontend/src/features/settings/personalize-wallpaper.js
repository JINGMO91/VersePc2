import { bridge as bridge } from '../../core/tauri-bridge.js';
import { _lazyLoadScript as _lazyLoadScript } from '../../core/utils.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { wpfilePath as wpfilePath, initWallpaper as initWallpaper, setCustomWallpaperImage as setCustomWallpaperImage, setCustomWallpaperVideo as setCustomWallpaperVideo, onWallpaperBrightnessChange as onWallpaperBrightnessChange, getWallpaperEngine as getWallpaperEngine } from './wallpaper-engine.js';
import { getPersonalizeState, applyWallpaperByName, applyWallpaperOpacityValue, applyWallpaperBlurValue, applyWallpaperFitValue, applyPanoramaThemeByName, applyPanoramaSpeedValue, applyPanoramaFollowValue } from './personalize-apply.js';

async function _ensureWallpaperEngine() {
  if (typeof getWallpaperEngine() === 'undefined' || !getWallpaperEngine()) {
    if (typeof _lazyLoadScript === 'function') {
      try { await _lazyLoadScript('js/three.bundle.js'); } catch (e) {}
    }
    if (typeof initWallpaper === 'function') {
      try { initWallpaper(); } catch (e) { console.error('[Wallpaper] init error:', e); }
    }
  }
}

async function selectWallpaper(element) {
  document.querySelectorAll('.wallpaper-option').forEach(opt => opt.classList.remove('active'));
  element.classList.add('active');

  const mode = element.dataset.wallpaper;
  const st = getPersonalizeState();
  if (st) st.wallpaper = mode;

  await applyWallpaperByName(mode);
}

async function pickCustomWallpaperFile() {
  const st = getPersonalizeState();
  const activeMode = st ? st.wallpaper : (document.querySelector('.wallpaper-option.active')?.dataset.wallpaper);
  const isVideo = activeMode === 'customVideo';

  const filters = isVideo
    ? [{ name: '视频文件', extensions: ['mp4', 'webm', 'mkv', 'avi'] }]
    : [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }];

  try {
    const result = await bridge.selectFile({
      title: isVideo ? '选择视频壁纸' : '选择图片壁纸',
      filters
    });

    if (result.cancelled) return;

    const filePath = result.path;
    if (!filePath) {
      if (typeof showToast === 'function') showToast('未获取到文件路径，请重新选择', 'error');
      return;
    }
    await _applyCustomWallpaperFile(filePath, isVideo);
  } catch (e) {
    console.error('[Wallpaper] Pick file error:', e);
  }
}

async function _applyCustomWallpaperFile(filePath, isVideo) {
  if (!filePath) {
    if (typeof showToast === 'function') showToast('未获取到文件路径，请重新选择', 'error');
    return;
  }
  const fileName = filePath.split(/[\\/]/).pop();
  const st = getPersonalizeState();
  if (st) st.customFileName = fileName;
  document.getElementById('custom-wallpaper-file-name').textContent = fileName;

  if (isVideo) {
    if (typeof setCustomWallpaperVideo === 'function') {
      setCustomWallpaperVideo(filePath);
    }
    try { await bridge.store.set('versepc_custom_video', filePath); } catch (e) {}
  } else {
    if (typeof setCustomWallpaperImage === 'function') {
      setCustomWallpaperImage(filePath);
    }
    try { await bridge.store.set('versepc_custom_image', filePath); } catch (e) {}
    _updateCustomImagePreview(filePath);
  }
}

function _updateCustomImagePreview(filePath) {
  const preview = document.getElementById('wp-preview-custom-image');
  if (!preview) return;
  const icon = preview.querySelector('.wp-preview-icon');
  if (filePath) {
    if (icon) icon.style.display = 'none';
    let img = preview.querySelector('.wp-preview-thumb');
    if (!img) {
      img = document.createElement('img');
      img.className = 'wp-preview-thumb';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;';
      preview.style.position = 'relative';
      preview.appendChild(img);
    }
    // Tauri 环境未注册 wpfile:// 协议，改用 readFileBuffer → blob 加载本地图片预览
    img.src = '';
    if (bridge && bridge.readFileBuffer) {
      bridge.readFileBuffer(filePath)
        .then((buffer) => {
          const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
          if (!u8 || u8.byteLength === 0) throw new Error('empty');
          const ext = String(filePath).toLowerCase().split('.').pop();
          const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
          const mime = mimeMap[ext] || 'image/png';
          const blob = new Blob([u8], { type: mime });
          img.src = URL.createObjectURL(blob);
        })
        .catch(() => {
          img.src = typeof wpfilePath === 'function' ? wpfilePath(filePath) : '';
        });
    } else {
      img.src = typeof wpfilePath === 'function' ? wpfilePath(filePath) : '';
    }
  } else {
    if (icon) icon.style.display = '';
    const img = preview.querySelector('.wp-preview-thumb');
    if (img) img.remove();
  }
}

function initWallpaperAutoAdapt() {
  if (typeof onWallpaperBrightnessChange !== 'function') return;

  onWallpaperBrightnessChange((brightness) => {
    const overlay = document.getElementById('wallpaper-overlay');
    if (!overlay) return;

    const app = document.getElementById('app');
    if (!app) return;

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isLightTheme = currentTheme === 'light' ||
        (currentTheme === 'custom' && document.documentElement.getAttribute('data-custom-theme-mode') === 'light');
    const isLight = brightness > 0.55;
    const isDark = brightness < 0.35;

    if (isLightTheme) {
      app.classList.remove('wp-light', 'wp-dark');
      overlay.style.background = 'transparent';
    } else if (isLight) {
      overlay.style.background = 'rgba(0, 0, 0, 0.15)';
      app.classList.add('wp-light');
      app.classList.remove('wp-dark');
    } else if (isDark) {
      overlay.style.background = 'transparent';
      app.classList.add('wp-dark');
      app.classList.remove('wp-light');
    } else {
      const alpha = (0.55 - brightness) * 0.3;
      overlay.style.background = `rgba(0, 0, 0, ${Math.max(0, alpha)})`;
      app.classList.remove('wp-light', 'wp-dark');
    }

    document.documentElement.style.setProperty('--wp-brightness', brightness);
  });
}

function onWallpaperOpacityChange(value) {
  const el = document.getElementById('wallpaper-opacity-value');
  if (el) el.textContent = value + '%';
  applyWallpaperOpacityValue(value);
}

function onWallpaperBlurChange(value) {
  const el = document.getElementById('wallpaper-blur-value');
  if (el) el.textContent = value + 'px';
  applyWallpaperBlurValue(value);
}

function onWallpaperFitChange(value) {
  applyWallpaperFitValue(value);
}

function selectPanoramaTheme(element) {
  document.querySelectorAll('.panorama-theme-option').forEach(opt => opt.classList.remove('active'));
  element.classList.add('active');
  applyPanoramaThemeByName(element.dataset.theme);
}

function onPanoramaSpeedChange(value) {
  const label = document.getElementById('panoramaSpeedLabel');
  if (label) label.textContent = value;
  applyPanoramaSpeedValue(value);
}

function onPanoramaMouseFollowChange(enabled) {
  applyPanoramaFollowValue(enabled);
}

export { _ensureWallpaperEngine, selectWallpaper, pickCustomWallpaperFile, _applyCustomWallpaperFile, _updateCustomImagePreview, initWallpaperAutoAdapt, onWallpaperOpacityChange, onWallpaperBlurChange, onWallpaperFitChange, selectPanoramaTheme, onPanoramaSpeedChange, onPanoramaMouseFollowChange };
