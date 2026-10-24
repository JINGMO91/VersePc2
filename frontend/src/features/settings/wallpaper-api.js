import { S } from './wallpaper-state.js';
import { WallpaperEngine } from './wallpaper-renderers.js';
import { PanoramaRenderer } from './wallpaper-panorama.js';
import { wpfilePath, wewpVideoPath, _ensureGlobalDlBar, showGlobalDownloadProgress, hideGlobalDownloadProgress } from './wallpaper-utils.js';

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

// 供跨域读取当前壁纸引擎实例（实例在初始化后才创建，不能导出快照值）
function getWallpaperEngine() {
    return S.wallpaperEngine;
}

export { wpfilePath, wewpVideoPath, initWallpaper, updateWallpaperTheme, switchWallpaperMode, setCustomWallpaperImage, setCustomWallpaperVideo, setWallpaperOpacity, setWallpaperBlur, setWallpaperFitMode, setPanoramaTheme, onWallpaperBrightnessChange, setPanoramaRotationSpeed, setPanoramaMouseFollow, startSceneWallpaper, stopSceneWallpaper, _ensureGlobalDlBar, showGlobalDownloadProgress, hideGlobalDownloadProgress, getWallpaperEngine };
