// 壁纸引擎按需初始化：独立成模块，避免个性化逻辑与壁纸渲染器互相依赖。
import { _lazyLoadScript } from '../../core/utils.js';
import { getWallpaperEngine, initWallpaper } from './wallpaper-engine.js';

export async function _ensureWallpaperEngine() {
  if (typeof getWallpaperEngine() === 'undefined' || !getWallpaperEngine()) {
    if (typeof _lazyLoadScript === 'function') {
      try { await _lazyLoadScript('js/three.bundle.js'); } catch (e) {}
    }
    if (typeof initWallpaper === 'function') {
      try { initWallpaper(); } catch (e) { console.error('[Wallpaper] init error:', e); }
    }
  }
}
