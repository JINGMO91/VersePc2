import { bridge as bridge } from '../../core/tauri-bridge.js';
import { S } from './wallpaper-state.js';
import { WallpaperEngine } from './wallpaper-renderers.js';
import { PanoramaRenderer } from './wallpaper-panorama.js';

function wpfilePath(filePath) {
    if (!filePath) return '';
    if (filePath.startsWith('wpfile://') || filePath.startsWith('blob:')) return filePath;
    const normalized = filePath.replace(/\\/g, '/');
    return 'wpfile:///' + normalized.split('/').map(encodeURIComponent).join('/');
}

function wewpVideoPath(workshopId, relFile) {
    if (!workshopId || !relFile) return '';
    const segs = String(relFile).split(/[\\/]/).map(encodeURIComponent).join('/');
    // WebView2 会把自定义协议映射成 http://<scheme>.localhost；
    // <video> 不能直接吃 wewp://，必须用映射后的 http 地址（Windows 专属功能）。
    const isWindows = !bridge || bridge.isWindows;
    const origin = isWindows ? 'http://wewp.localhost' : 'wewp://localhost';
    return origin + '/' + encodeURIComponent(workshopId) + '/' + segs;
}

function initWallpaper() {
    const canvas = document.getElementById('wallpaper-canvas');
    if (!canvas) return;
    S.wallpaperEngine = new WallpaperEngine(canvas);
    S.wallpaperEngine.start();
}

function updateWallpaperTheme(isDark) {
    if (S.wallpaperEngine) S.wallpaperEngine.setTheme(isDark);
}

function switchWallpaperMode(mode) {
    if (S.wallpaperEngine) S.wallpaperEngine.switchMode(mode);
}

function setCustomWallpaperImage(filePath) {
    if (S.wallpaperEngine) {
        S.wallpaperEngine.customImagePath = filePath;
        if (S.wallpaperEngine.currentMode === 'customImage' && S.wallpaperEngine.renderer) {
            S.wallpaperEngine.renderer.loadImage(filePath);
        }
    }
}

function setCustomWallpaperVideo(filePath) {
    if (S.wallpaperEngine) {
        S.wallpaperEngine.customVideoPath = filePath;
        if (S.wallpaperEngine.currentMode === 'customVideo' && S.wallpaperEngine.renderer) {
            S.wallpaperEngine.renderer.loadVideo(filePath);
        }
    }
}

function setWallpaperOpacity(value) {
    if (S.wallpaperEngine) S.wallpaperEngine.wallpaperOpacity = value;
}

function setWallpaperBlur(value) {
    if (S.wallpaperEngine) S.wallpaperEngine.wallpaperBlur = value;
}

function setWallpaperFitMode(mode) {
    if (S.wallpaperEngine) S.wallpaperEngine.wallpaperFitMode = mode;
}

function setPanoramaTheme(theme) {
    if (S.wallpaperEngine) S.wallpaperEngine._savedPanoramaTheme = theme;
    if (S.wallpaperEngine && S.wallpaperEngine.renderer instanceof PanoramaRenderer) {
        S.wallpaperEngine.renderer.setTheme(theme);
    }
}

function onWallpaperBrightnessChange(callback) {
    if (S.wallpaperEngine) S.wallpaperEngine.onBrightnessChange(callback);
}

function setPanoramaRotationSpeed(speed) {
    if (S.wallpaperEngine) S.wallpaperEngine._savedRotationSpeed = speed;
    if (S.wallpaperEngine && S.wallpaperEngine.renderer instanceof PanoramaRenderer) {
        S.wallpaperEngine.renderer.setRotationSpeed(speed);
    }
}

function setPanoramaMouseFollow(enabled) {
    if (S.wallpaperEngine) S.wallpaperEngine._savedMouseFollow = enabled;
    if (S.wallpaperEngine && S.wallpaperEngine.renderer instanceof PanoramaRenderer) {
        S.wallpaperEngine.renderer.setMouseFollow(enabled);
    }
}

async function startSceneWallpaper(workshopId) {
    if (!S.wallpaperEngine) return false;
    return await S.wallpaperEngine._startSceneProcess(workshopId);
}

function stopSceneWallpaper() {
    if (!S.wallpaperEngine) return;
    if (S.wallpaperEngine.currentMode === 'sceneWallpaper') {
        S.wallpaperEngine.switchMode('none');
    } else {
        S.wallpaperEngine._stopSceneProcess();
    }
}

function _ensureGlobalDlBar() {
    if (S._globalDlBarEl) return S._globalDlBarEl;
    const el = document.createElement('div');
    el.id = 'global-download-progress-bar';
    el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;' +
        'width:min(420px,80vw);background:var(--bg-card,#14171d);border:1px solid var(--border,#2a2f3a);' +
        'border-radius:12px;padding:12px 16px;box-shadow:0 8px 30px rgba(0,0,0,.35);display:none;';
    el.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13px;font-weight:600;">' +
        '<span id="gdlb-title">正在下载</span>' +
        '<span id="gdlb-pct" style="color:var(--text-muted);font-weight:400;">0%</span></div>' +
        '<div style="height:6px;background:var(--bg-secondary,#1a1d24);border-radius:3px;overflow:hidden;">' +
        '<div id="gdlb-fill" style="height:100%;width:0%;background:var(--accent,#4c8dff);border-radius:3px;transition:width .2s;"></div></div>' +
        '<div id="gdlb-info" style="margin-top:6px;font-size:11px;color:var(--text-muted);"></div>';
    document.body.appendChild(el);
    S._globalDlBarEl = el;
    return el;
}

function showGlobalDownloadProgress(title, percent, detail) {
    const el = _ensureGlobalDlBar();
    const titleEl = el.querySelector('#gdlb-title');
    const pctEl = el.querySelector('#gdlb-pct');
    const fillEl = el.querySelector('#gdlb-fill');
    const infoEl = el.querySelector('#gdlb-info');
    if (title) titleEl.textContent = title;
    const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
    pctEl.textContent = p + '%';
    fillEl.style.width = p + '%';
    if (detail) infoEl.textContent = detail;
    el.style.display = 'block';
}

function hideGlobalDownloadProgress() {
    if (S._globalDlBarEl) S._globalDlBarEl.style.display = 'none';
}

// 供跨域读取当前壁纸引擎实例（实例在初始化后才创建，不能导出快照值）
function getWallpaperEngine() {
    return S.wallpaperEngine;
}

export { wpfilePath, wewpVideoPath, initWallpaper, updateWallpaperTheme, switchWallpaperMode, setCustomWallpaperImage, setCustomWallpaperVideo, setWallpaperOpacity, setWallpaperBlur, setWallpaperFitMode, setPanoramaTheme, onWallpaperBrightnessChange, setPanoramaRotationSpeed, setPanoramaMouseFollow, startSceneWallpaper, stopSceneWallpaper, _ensureGlobalDlBar, showGlobalDownloadProgress, hideGlobalDownloadProgress, getWallpaperEngine };
