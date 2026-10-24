import { bridge as bridge } from '../../core/tauri-bridge.js';
import { showToast as showToast, showConfirmDialog as showConfirmDialog } from '../misc/ui-components.js';
import { showGlobalDownloadProgress, hideGlobalDownloadProgress } from './wallpaper-utils.js';

class SceneWallpaperRenderer {
    constructor(engine) {
        this.engine = engine;
        this.img = null;
        this.loaded = false;
        this._retry = 0;
        this._container = document.getElementById('wallpaper-scene-container');
        if (engine.scenePort) {
            this.loadStream(engine.scenePort);
        }
    }

    setTheme() {}
    onResize() {}

    loadStream(port) {
        // 清理旧 img（MJPEG 连接会被浏览器自动断开）
        if (this.img) {
            this.img.src = '';
            if (this.img.parentElement) {
                this.img.parentElement.removeChild(this.img);
            }
            this.img = null;
        }
        const img = document.createElement('img');
        img.style.position = 'absolute';
        img.style.top = '0';
        img.style.left = '0';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.pointerEvents = 'none';
        img.style.imageRendering = 'auto';
        // 渲染器实际输出路由是 /scene_frame（不是 /），并加时间戳避免复用失败连接
        img.src = 'http://127.0.0.1:' + port + '/scene_frame?t=' + Date.now();
        img.onload = () => { this._retry = 0; };
        img.onerror = () => {
            if (this.img !== img) return;
            if (this._retry >= 10) {
                console.error('[Wallpaper] scene stream unavailable on port', port);
                if (typeof showToast === 'function') {
                    showToast('场景壁纸渲染失败，请查看数据目录 logs/scene-renderer.log', 'error');
                }
                return;
            }
            this._retry++;
            setTimeout(() => {
                if (this.img === img) this.loadStream(port);
            }, 500);
        };
        this.img = img;
        this.loaded = true;
        if (this._container) {
            this._container.appendChild(img);
        }
        this._updateStyle();
    }

    _updateStyle() {
        if (!this.img) return;
        // 场景壁纸没有模糊/透明度/适配控件，固定原始清晰度 + cover
        const opacity = 1;
        const blur = 0;
        const fitMode = 'cover';
        this.img.style.opacity = opacity;
        this.img.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : 'none';
        this.img.style.transform = blur > 0 ? 'scale(1.05)' : 'none';
        const fitMap = {
            cover: 'cover',
            contain: 'contain',
            stretch: 'fill',
            center: 'none',
            topLeft: 'none',
            topRight: 'none',
            bottomLeft: 'none',
            bottomRight: 'none',
            tile: 'none',
            smart: 'cover'
        };
        this.img.style.objectFit = fitMap[fitMode] || 'cover';
    }

    render(_dt, _timestamp) {
        // 流由 img 自动拉取，仅同步样式（opacity/blur/fit）
        this._updateStyle();
    }

    destroy() {
        if (this.img) {
            this.img.src = '';
            if (this.img.parentElement) {
                this.img.parentElement.removeChild(this.img);
            }
            this.img = null;
        }
        this.loaded = false;
    }
}

async function ensureSceneRendererInstalled() {
    try {
        const st = bridge && bridge.sceneRenderer
            ? await bridge.sceneRenderer.installed()
            : null;
        if (st && st.installed) return true;
    } catch (e) { /* 继续走确认下载流程 */ }

    const confirmed = typeof showConfirmDialog === 'function'
        ? await showConfirmDialog('下载场景渲染器', '场景壁纸需要额外的渲染组件（约 104MB）。是否现在下载并安装？', '下载', '取消')
        : true;
    if (!confirmed) return false;

    let unsub = null;
    if (bridge && bridge.sceneRenderer && bridge.sceneRenderer.onProgress) {
        unsub = bridge.sceneRenderer.onProgress(function (p) {
            if (!p) return;
            if (p.stage === 'download') {
                showGlobalDownloadProgress('正在下载场景渲染器组件', p.percent || 0);
            } else if (p.stage === 'extract') {
                showGlobalDownloadProgress('正在解压场景渲染器组件', 99);
            }
        });
    }
    try {
        const res = bridge && bridge.sceneRenderer
            ? await bridge.sceneRenderer.download()
            : null;
        hideGlobalDownloadProgress();
        if (res && res.ok) {
            if (typeof showToast === 'function') showToast('场景渲染器安装完成', 'success');
            return true;
        }
        if (typeof showToast === 'function') showToast('场景渲染器下载失败: ' + ((res && res.error) || '未知错误'), 'error');
        return false;
    } catch (e) {
        hideGlobalDownloadProgress();
        console.error('[Wallpaper] scene renderer download error:', e);
        if (typeof showToast === 'function') showToast('场景渲染器下载失败', 'error');
        return false;
    } finally {
        if (unsub) { try { unsub(); } catch (e) {} }
    }
}

export { SceneWallpaperRenderer, ensureSceneRendererInstalled };
