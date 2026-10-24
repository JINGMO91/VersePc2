import { bridge as bridge } from '../../core/tauri-bridge.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { ensureSceneRendererInstalled, SceneWallpaperRenderer } from './wallpaper-scene.js';
import { PanoramaRenderer } from './wallpaper-panorama.js';
import { CustomImageRenderer } from './wallpaper-image.js';
import { CustomVideoRenderer } from './wallpaper-video.js';
import { WebWallpaperRenderer } from './wallpaper-web.js';

class WallpaperEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.glCanvas = document.getElementById('wallpaper-canvas-gl');
        this.animationId = null;
        this.isRunning = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.lastTime = 0;
        this.isDarkTheme = true;
        this.currentMode = 'none';
        this.renderer = null;
        this.transitionAlpha = 1;
        this.transitioning = false;
        this.wallpaperOpacity = 1;
        this.wallpaperBlur = 0;
        this.wallpaperFitMode = 'cover';
        this.customImagePath = null;
        this.customVideoPath = null;
        this.auroraVideoPath = null;
        // 场景壁纸：离屏渲染进程的本地 MJPEG 端口 + 作品 ID（用于恢复）
        this.scenePort = 0;
        this._sceneWorkshopId = null;
        this.wallpaperBrightness = 0;
        this._brightnessCallback = null;

        this._onResize = this._onResize.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onIdleCheck = this._onIdleCheck.bind(this);
        this._animate = this._animate.bind(this);
        this._savedRotationSpeed = 0.005;
        this._savedPanoramaTheme = 'overworld';
        // 空闲帧率优化：鼠标静默 3 秒后从 60fps 降到 30fps
        this._lastInteraction = performance.now();
        this._idleThrottle = false;
        this._frameCount = 0;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this._initRenderer();

        window.addEventListener('resize', this._onResize);
        window.addEventListener('mousemove', this._onMouseMove);

        this.lastTime = performance.now();
        this._animate(this.lastTime);
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.renderer && this.renderer.destroy) {
            this.renderer.destroy();
        }
        this.renderer = null;
        // 场景壁纸：停止离屏渲染进程
        this._stopSceneProcess();
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('mousemove', this._onMouseMove);
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // 停止场景壁纸离屏渲染进程（后端 scene_renderer_stop）
    async _stopSceneProcess() {
        this.scenePort = 0;
        this._sceneWorkshopId = null;
        try {
            if (bridge && bridge.invoke) {
                await bridge.invoke('scene_renderer_stop');
            }
        } catch (e) {
            console.error('[Wallpaper] scene renderer stop error:', e);
        }
    }

    // 场景渲染器输出分辨率：跟随窗口物理像素，避免固定 720p 被放大发虚
    _sceneRenderSize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        return {
            width: Math.max(640, Math.min(3840, Math.round(window.innerWidth * dpr))),
            height: Math.max(360, Math.min(2160, Math.round(window.innerHeight * dpr)))
        };
    }

    // 启动场景壁纸离屏渲染进程（后端 scene_renderer_start），成功后切入 sceneWallpaper 模式
    async _startSceneProcess(workshopId) {
        try {
            const size = this._sceneRenderSize();
            const startArgs = { workshopId: workshopId, width: size.width, height: size.height };
            let res = null;
            if (bridge && bridge.invoke) {
                res = await bridge.invoke('scene_renderer_start', startArgs);
            }
            // 组件未安装：引导下载后重试一次
            if (!res || res.missing) {
                const installed = await ensureSceneRendererInstalled();
                if (!installed) return false;
                if (bridge && bridge.invoke) {
                    res = await bridge.invoke('scene_renderer_start', startArgs);
                }
            }
            if (!res || !res.ok || !res.port) {
                if (typeof showToast === 'function') showToast('场景壁纸启动失败: ' + ((res && res.error) || '未知错误'), 'error');
                return false;
            }
            this.scenePort = res.port;
            this._sceneWorkshopId = workshopId;
            if (this.currentMode !== 'sceneWallpaper') {
                this.switchMode('sceneWallpaper');
            } else if (this.renderer && this.renderer.loadStream) {
                this.renderer.loadStream(res.port);
            }
            return true;
        } catch (e) {
            console.error('[Wallpaper] scene renderer start error:', e);
            if (typeof showToast === 'function') showToast('场景壁纸启动失败', 'error');
            return false;
        }
    }

    // 游戏运行低调模式 - 挂起渲染循环（不销毁 WebGL 上下文，便于快速恢复）
    suspend() {
        if (this._suspended) return;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.renderer && this.renderer.video) {
            try { this.renderer.video.pause(); } catch (e) {}
        }
        if (this.renderer && this.renderer._brightnessCheckInterval) {
            clearInterval(this.renderer._brightnessCheckInterval);
            this.renderer._brightnessCheckInterval = null;
        }
        // 场景壁纸：挂起时停掉离屏渲染进程释放 CPU（恢复时按保存的 ID 重新拉起）
        if (this.currentMode === 'sceneWallpaper' && this.scenePort) {
            this._stopSceneProcess();
        }
        this._suspended = true;
    }

    // 游戏运行低调模式 - 恢复渲染循环
    resume() {
        if (!this._suspended) return;
        this._suspended = false;
        if (this.renderer && this.renderer.video) {
            try { this.renderer.video.play().catch(() => {}); } catch (e) {}
        }
        if (this.renderer && !this.renderer._brightnessCheckInterval && typeof this.renderer._startBrightnessSampling === 'function') {
            this.renderer._startBrightnessSampling();
        }
        // 场景壁纸：恢复时重新启动渲染进程
        if (this.currentMode === 'sceneWallpaper' && this._sceneWorkshopId && !this.scenePort) {
            this._startSceneProcess(this._sceneWorkshopId);
        }

        // 仅在非 none 模式下恢复 RAF，避免无壁纸时空转
        if (this.isRunning && !this.animationId && this.currentMode !== 'none') {
            this.lastTime = performance.now();
            this._animate(this.lastTime);
        }
    }

    setTheme(isDark) {
        this.isDarkTheme = isDark;
        if (this.renderer && this.renderer.setTheme) {
            this.renderer.setTheme(isDark);
        }
    }

    switchMode(mode) {
        if (this.currentMode === mode) return;
        const prevMode = this.currentMode;
        const wasNone = prevMode === 'none';
        this.currentMode = mode;
        if (this.isRunning) {
            // 离开场景壁纸模式：停掉离屏渲染进程
            if (prevMode === 'sceneWallpaper' && mode !== 'sceneWallpaper') {
                this._stopSceneProcess();
            }
            this.transitioning = true;
            this.transitionAlpha = 0;
            this._initRenderer();
            // 从 none 切到具体模式时，RAF 循环已停止，需要重新启动
            if (wasNone && !this.animationId) {
                this.lastTime = performance.now();
                this._animate(this.lastTime);
            }
        }
    }

    onBrightnessChange(callback) {
        this._brightnessCallback = callback;
    }

    async _getAuroraVideoPath() {
        // 内置流光动态背景视频
        // 通过 IPC 从主进程获取路径，兼容开发和打包环境
        try {
            if (bridge && bridge.getAuroraVideoPath) {
                const p = await bridge.getAuroraVideoPath();
                console.log('[Wallpaper] Aurora video path from IPC:', p);
                if (p) return p;
            }
        } catch (e) {
            console.error('[Wallpaper] _getAuroraVideoPath IPC error:', e);
        }
        // 回退：尝试相对路径
        console.log('[Wallpaper] Using fallback aurora path');
        return 'resources/wallpapers/aurora.mp4';
    }

    _notifyBrightness(brightness) {
        this.wallpaperBrightness = brightness;
        if (this._brightnessCallback) {
            this._brightnessCallback(brightness);
        }
    }

    async _initRenderer() {
        this._onResize();

        if (this.renderer && this.renderer.destroy) {
            this.renderer.destroy();
        }

        const isGL = this.currentMode === 'panorama';
        const isNone = this.currentMode === 'none';
        const isVideoMode = this.currentMode === 'customVideo' || this.currentMode === 'auroraVideo';
        const isImageMode = this.currentMode === 'customImage';
        const isWebMode = this.currentMode === 'webWallpaper';
        const isSceneMode = this.currentMode === 'sceneWallpaper';
        const isDomMode = isVideoMode || isImageMode || isWebMode || isSceneMode;
        // 图片/视频模式用 DOM 元素显示，不需要 Canvas
        this.canvas.style.display = (isGL || isNone || isDomMode) ? 'none' : 'block';
        if (this.glCanvas) this.glCanvas.style.display = isGL ? 'block' : 'none';
        // 显示/隐藏 DOM 容器
        const videoContainer = document.getElementById('wallpaper-video-container');
        if (videoContainer) {
            videoContainer.style.display = (isVideoMode || isImageMode) ? 'block' : 'none';
        }
        const webContainer = document.getElementById('wallpaper-web-container');
        if (webContainer) {
            webContainer.style.display = isWebMode ? 'block' : 'none';
        }
        const sceneContainer = document.getElementById('wallpaper-scene-container');
        if (sceneContainer) {
            sceneContainer.style.display = isSceneMode ? 'block' : 'none';
        }
        if (isNone) {
            this.renderer = null;
            const app = document.getElementById('app');
            if (app) {
                app.classList.remove('wp-light', 'wp-dark');
            }
            const overlay = document.getElementById('wallpaper-overlay');
            if (overlay) {
                overlay.style.background = 'transparent';
            }
            return;
        }

        const factories = {
            panorama: () => new PanoramaRenderer(this),
            customImage: () => new CustomImageRenderer(this),
            customVideo: () => new CustomVideoRenderer(this),
            webWallpaper: () => new WebWallpaperRenderer(this),
            sceneWallpaper: () => new SceneWallpaperRenderer(this),
            auroraVideo: async () => {
                this.auroraVideoPath = await this._getAuroraVideoPath();
                return new CustomVideoRenderer(this);
            }
        };
        try {
            const result = await (factories[this.currentMode] || factories.panorama)();
            this.renderer = result;
        } catch (e) {
            console.error('[Wallpaper] renderer init error:', e);
            this.renderer = null;
        }

        if (this.currentMode === 'panorama') {
            if (this.renderer && this.renderer.setTheme && this._savedPanoramaTheme) {
                this.renderer.setTheme(this._savedPanoramaTheme);
            }
            if (this.renderer && this.renderer.setRotationSpeed) {
                this.renderer.setRotationSpeed(this._savedRotationSpeed);
            }
            if (this.renderer && this.renderer.setMouseFollow && this._savedMouseFollow) {
                this.renderer.setMouseFollow(this._savedMouseFollow);
            }
            this._notifyBrightness(0.5);
        }
    }

    _onResize() {
        // 按设备像素比设置内部分辨率，避免高分屏放大模糊；上限 2x 兼顾性能
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(window.innerWidth * dpr);
        this.canvas.height = Math.round(window.innerHeight * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (this.glCanvas) {
            this.glCanvas.width = Math.round(window.innerWidth * dpr);
            this.glCanvas.height = Math.round(window.innerHeight * dpr);
        }
        if (this.renderer && this.renderer.onResize) {
            this.renderer.onResize();
        }
    }

    _onMouseMove(e) {
        this.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
        this.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
        this._lastInteraction = performance.now();
        if (this._idleThrottle) {
            this._idleThrottle = false;
            this._frameCount = 0;
        }
    }

    _onIdleCheck() {
        if (this._idleThrottle) return;
        if (performance.now() - this._lastInteraction > 3000) {
            this._idleThrottle = true;
            this._frameCount = 0;
        }
    }

    _animate(timestamp) {
        if (!this.isRunning) return;

        // 没有壁纸可渲染时停止 RAF 循环，避免空转浪费 CPU
        // switchMode 切到具体模式时会重新调用 _animate 启动循环
        if (this.currentMode === 'none' && !this.transitioning) {
            this.animationId = null;
            return;
        }

        const dt = Math.min(timestamp - this.lastTime, 50);
        this.lastTime = timestamp;

        // 空闲时每 2 帧渲染 1 帧，降至 ~30fps
        this._frameCount++;
        this._onIdleCheck();
        const skipFrame = this._idleThrottle && (this._frameCount % 2 === 0) && this.currentMode === 'panorama';

        if (!skipFrame) {
            if (this.transitioning) {
                this.transitionAlpha = Math.min(1, this.transitionAlpha + dt * 0.003);
                if (this.transitionAlpha >= 1) this.transitioning = false;
            }

            if (this.renderer) {
                if (this.currentMode === 'customImage' && !this.transitioning && this.renderer.loaded) {
                    // Static image: skip redraw, but still update style for opacity/blur changes
                    if (typeof this.renderer._updateStyle === 'function') {
                        this.renderer._updateStyle();
                    }
                } else {
                    this.renderer.render(dt, timestamp);
                }
            }
        }

        if (this.transitioning && this.currentMode !== 'panorama') {
            this.ctx.fillStyle = `rgba(10, 10, 10, ${1 - this.transitionAlpha})`;
            this.ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        }

        this.animationId = requestAnimationFrame(this._animate);
    }
}

function drawFitMode(ctx, source, sourceW, sourceH, canvasW, canvasH, fitMode) {
    let mode = fitMode || 'cover';
    if (mode === 'smart') {
        mode = (sourceW < canvasW / 2 && sourceH < canvasH / 2) ? 'tile' : 'cover';
    }

    switch (mode) {
        case 'center': {
            ctx.drawImage(source, (canvasW - sourceW) / 2, (canvasH - sourceH) / 2, sourceW, sourceH);
            break;
        }
        case 'cover': {
            const scale = Math.max(canvasW / sourceW, canvasH / sourceH);
            const sw = sourceW * scale;
            const sh = sourceH * scale;
            ctx.drawImage(source, (canvasW - sw) / 2, (canvasH - sh) / 2, sw, sh);
            break;
        }
        case 'stretch': {
            ctx.drawImage(source, 0, 0, canvasW, canvasH);
            break;
        }
        case 'tile': {
            for (let ty = 0; ty < canvasH; ty += sourceH) {
                for (let tx = 0; tx < canvasW; tx += sourceW) {
                    ctx.drawImage(source, tx, ty, sourceW, sourceH);
                }
            }
            break;
        }
        case 'topLeft': {
            ctx.drawImage(source, 0, 0, sourceW, sourceH);
            break;
        }
        case 'topRight': {
            ctx.drawImage(source, canvasW - sourceW, 0, sourceW, sourceH);
            break;
        }
        case 'bottomLeft': {
            ctx.drawImage(source, 0, canvasH - sourceH, sourceW, sourceH);
            break;
        }
        case 'bottomRight': {
            ctx.drawImage(source, canvasW - sourceW, canvasH - sourceH, sourceW, sourceH);
            break;
        }
        default: {
            const scale = Math.max(canvasW / sourceW, canvasH / sourceH);
            const sw = sourceW * scale;
            const sh = sourceH * scale;
            ctx.drawImage(source, (canvasW - sw) / 2, (canvasH - sh) / 2, sw, sh);
        }
    }
}

export { WallpaperEngine, drawFitMode };
