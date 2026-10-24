import { bridge as bridge } from '../../core/tauri-bridge.js';
import { _lazyLoadScript as _lazyLoadScript } from '../../core/utils.js';
import { selectWallpaper as selectWallpaper, _updateCustomImagePreview as _updateCustomImagePreview, onWallpaperOpacityChange as onWallpaperOpacityChange, onWallpaperBlurChange as onWallpaperBlurChange, onWallpaperFitChange as onWallpaperFitChange, selectPanoramaTheme as selectPanoramaTheme } from '../settings/personalize.js';
import { initWallpaper as initWallpaper, setCustomWallpaperImage as setCustomWallpaperImage, setCustomWallpaperVideo as setCustomWallpaperVideo, setPanoramaRotationSpeed as setPanoramaRotationSpeed, setPanoramaMouseFollow as setPanoramaMouseFollow } from '../settings/wallpaper-engine.js';

async function backgroundLoadWallpaper() {
  try {
    const savedWallpaper = await bridge?.store?.get('versepc_wallpaper');
    if (savedWallpaper && savedWallpaper !== 'none') {
      try { await _lazyLoadScript('js/three.bundle.js'); } catch (_) {}
      try { initWallpaper(); } catch (e) { console.error('[Wallpaper] init error:', e); }
      try { await loadWallpaperSettings(); } catch (_) {}
    }
  } catch (e) {}
}

function setupWindowMemoryEvents() {
  try {
    if (!window.__TAURI__ || !window.__TAURI__.event) return;
    const ta = window.__TAURI__.event;

    // 壁纸引擎挂起/恢复（若已加载）
    function suspendWallpaper() {
      try {
        const w = window.wallpaperEngine;
        if (w && typeof w.suspend === 'function') w.suspend();
      } catch (e) {}
    }
    function resumeWallpaper() {
      try {
        const w = window.wallpaperEngine;
        if (w && typeof w.resume === 'function') w.resume();
      } catch (e) {}
    }

    ta.listen('window-minimized', function () {
      suspendWallpaper();
      // 最小化时：额外释放前端资源
      try {
        // 暂停启动栏封面图的视频/动画（如果有）
        const launchLogoImg = document.querySelector('.launch-cover-image, .launch-cover-video');
        if (launchLogoImg && launchLogoImg.tagName === 'VIDEO') try { launchLogoImg.pause(); } catch (e) {}
        // 清理不可见的图片缓存（隐藏页面中的大图）
        clearHiddenImageCache();
        // 尝试 V8 GC（如果通过启动参数暴露了 gc 函数）
        try { if (window.gc) { window.gc(); window.gc(); } } catch (e) {}
      } catch (e) {}
    });
    ta.listen('window-restored', function () {
      resumeWallpaper();
      // 恢复封面图视频
      const launchLogoImg = document.querySelector('.launch-cover-video');
      if (launchLogoImg && launchLogoImg.tagName === 'VIDEO' && !launchLogoImg.paused) {
        // 不强制自动播放，避免打扰用户
      }
      // 恢复后也尝试一次 GC 和清理
      try { if (window.gc) window.gc(); } catch (e) {}
    });

    // 后端定时触发的内存优化请求（最小化后每 30 秒一次）
    ta.listen('memory-optimize-request', function () {
      try {
        // 1. 清理不可见页面的图片引用（临时把 src 设为 ''，DOM 不删，返回时浏览器会重新加载）
        clearHiddenImageCache();
        // 2. 如果壁纸已经挂起（最小化状态），把 canvas 清空减少显存占用
        const w = window.wallpaperEngine;
        if (w && w._suspended) {
          try {
            const canvas = document.getElementById('wallpaper-canvas');
            const glCanvas = document.getElementById('wallpaper-canvas-gl');
            if (canvas && canvas.width > 0) {
              const ctx = canvas.getContext('2d');
              if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
          } catch (e) {}
        }
        // 3. V8 GC（仅当启动参数暴露时有效）
        try { if (window.gc) { window.gc(); window.gc(); } } catch (e) {}
        // 4. 清理控制台日志输出缓冲区，避免大字符串长期驻留
        try {
          if (typeof window.clearGameLogBuffer === 'function') {
            window.clearGameLogBuffer();
          }
        } catch (e) {}
      } catch (e) {}
    });
  } catch (e) {}
}

function clearHiddenImageCache() {
  try {
    // 找到所有非激活页面里的 img / video 元素
    const pages = document.querySelectorAll('.page:not(.active)');
    pages.forEach(function (page) {
      // 图片：只处理非小图标的大图片（避免清掉 SVG 图标）
      const imgs = page.querySelectorAll('img[src]:not([src*="svg"]):not(.nav-icon-svg):not(.account-avatar-img):not(.mod-icon-img)');
      imgs.forEach(function (img) {
        if (img.naturalWidth > 100 || img.naturalHeight > 100) {
          // 保存原地址到 data 属性，切回页面时恢复（通过 MutationObserver 或页面切换钩子）
          if (!img.dataset._cachedSrc) {
            img.dataset._cachedSrc = img.src;
            // 只清理大内存占用的图片（宽高超过 500px 的解码缓存占用才显著）
            if (img.naturalWidth > 500 || img.naturalHeight > 500) {
              img.removeAttribute('src');
            }
          }
        }
      });
      // 视频：暂停并移除 srcObject
      const videos = page.querySelectorAll('video');
      videos.forEach(function (v) {
        try {
          if (v.srcObject) {
            v._cachedSrcObj = v.srcObject;
            v.srcObject = null;
          }
          v.pause();
        } catch (e) {}
      });
    });
  } catch (e) {}
}

function loadWallpaperSettings() {
  Promise.all([
    bridge.store.get('versepc_custom_image'),
    bridge.store.get('versepc_custom_video'),
    bridge.store.get('versepc_wallpaper'),
    bridge.store.get('versepc_wallpaper_opacity'),
    bridge.store.get('versepc_wallpaper_blur'),
    bridge.store.get('versepc_wallpaper_fit'),
    bridge.store.get('versepc_panorama_theme'),
    bridge?.store?.get('versepc_panorama_speed'),
    bridge?.store?.get('versepc_panorama_mouse_follow'),
  ]).then(([
    savedCustomImage,
    savedCustomVideo,
    savedWallpaper,
    savedOpacity,
    savedBlur,
    savedFit,
    savedPanoramaTheme,
    savedPanoramaSpeed,
    savedMouseFollow,
  ]) => {
    if (savedCustomImage && typeof setCustomWallpaperImage === 'function') {
      setCustomWallpaperImage(savedCustomImage);
    }
    if (savedCustomVideo && typeof setCustomWallpaperVideo === 'function') {
      setCustomWallpaperVideo(savedCustomVideo);
    }
    if (savedWallpaper) {
      let wpName = savedWallpaper;
      if (wpName === 'starry') wpName = 'panorama';
      const wpEl = document.querySelector(`.wallpaper-option[data-wallpaper="${wpName}"]`);
      if (wpEl) selectWallpaper(wpEl);
    }
    if (savedOpacity != null) {
      const slider = document.getElementById('wallpaper-opacity-slider');
      if (slider) { slider.value = savedOpacity; onWallpaperOpacityChange(savedOpacity); }
    }
    if (savedBlur != null) {
      const slider = document.getElementById('wallpaper-blur-slider');
      if (slider) { slider.value = savedBlur; onWallpaperBlurChange(savedBlur); }
    }
    if (savedFit) {
      const select = document.getElementById('wallpaper-fit-select');
      if (select) { select.value = savedFit; onWallpaperFitChange(savedFit); }
    }
    if (savedPanoramaTheme) {
      const themeEl = document.querySelector(`.panorama-theme-option[data-theme="${savedPanoramaTheme}"]`);
      if (themeEl) selectPanoramaTheme(themeEl);
    }
    if (savedPanoramaSpeed) {
      const slider = document.getElementById('panoramaSpeedSlider');
      if (slider) slider.value = savedPanoramaSpeed;
      const label = document.getElementById('panoramaSpeedLabel');
      if (label) label.textContent = savedPanoramaSpeed;
      if (typeof setPanoramaRotationSpeed === 'function') setPanoramaRotationSpeed(savedPanoramaSpeed * 0.001);
    }
    if (savedMouseFollow === true) {
      const toggle = document.getElementById('panoramaMouseFollowToggle');
      if (toggle) toggle.checked = true;
      if (typeof setPanoramaMouseFollow === 'function') setPanoramaMouseFollow(true);
    }
    if (savedCustomImage) {
      const nameEl = document.getElementById('custom-wallpaper-file-name');
      if (nameEl) nameEl.textContent = savedCustomImage.split(/[\\/]/).pop();
      _updateCustomImagePreview(savedCustomImage);
    }
    if (savedCustomVideo) {
      const nameEl = document.getElementById('custom-wallpaper-file-name');
      if (nameEl) nameEl.textContent = savedCustomVideo.split(/[\\/]/).pop();
    }
  }).catch(e => console.error('[Init] Load wallpaper settings error:', e));
}

export { backgroundLoadWallpaper, setupWindowMemoryEvents, clearHiddenImageCache, loadWallpaperSettings };
