import { bridge as bridge } from '../../core/tauri-bridge.js';
import { decodeFileBuffer as decodeFileBuffer } from '../../core/utils.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { wpfilePath } from './wallpaper-api.js';

class CustomImageRenderer {
    constructor(engine) {
        this.engine = engine;
        this.image = null;
        this.loaded = false;
        this._lastBrightness = -1;
        this._brightnessSampleCanvas = document.createElement('canvas');
        this._brightnessSampleCanvas.width = 32;
        this._brightnessSampleCanvas.height = 32;
        this._brightnessSampleCtx = this._brightnessSampleCanvas.getContext('2d', { willReadFrequently: true });
        this._container = document.getElementById('wallpaper-video-container');
        if (engine.customImagePath) {
            this.loadImage(engine.customImagePath);
        }
    }

    setTheme() {}
    onResize() {}

    async loadImage(filePath) {
        this.loaded = false;
        this._lastBrightness = -1;
        // 清理旧图片
        if (this.image) {
            const oldSrc = this.image.src;
            if (this.image.parentElement) {
                this.image.parentElement.removeChild(this.image);
            }
            if (oldSrc && oldSrc.startsWith('blob:')) {
                URL.revokeObjectURL(oldSrc);
            }
        }

        // 通过 IPC 读取文件 buffer，转 blob URL
        let imgUrl = wpfilePath(filePath);
        if (filePath && !filePath.startsWith('blob:') && !filePath.startsWith('wpfile://') && !filePath.startsWith('data:')) {
            try {
                if (bridge && bridge.readFileBuffer) {
                    const buffer = await bridge.readFileBuffer(filePath);
                    // Tauri 返回可能是 Base64 字符串 / number[] / Uint8Array，统一解码
                    const u8 = typeof decodeFileBuffer === 'function'
                        ? decodeFileBuffer(buffer)
                        : (buffer ? (buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)) : null);
                    if (u8 && u8.byteLength > 0) {
                        const ext = filePath.toLowerCase().split('.').pop();
                        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
                        const mime = mimeMap[ext] || 'image/png';
                        const blob = new Blob([u8], { type: mime });
                        imgUrl = URL.createObjectURL(blob);
                    }
                }
            } catch (e) {
                console.error('[Wallpaper] Failed to read image buffer:', e);
            }
        }

        // 创建 img DOM 元素，用 CSS filter 实现 GPU 加速 blur
        this.image = new Image();
        this.image.style.position = 'absolute';
        this.image.style.top = '0';
        this.image.style.left = '0';
        this.image.style.width = '100%';
        this.image.style.height = '100%';
        this.image.style.pointerEvents = 'none';
        this.image.onload = () => {
            this.loaded = true;
            this._sampleBrightness();
            this._updateStyle();
        };
        this.image.onerror = (e) => {
            console.error('[Wallpaper] Image load failed:', filePath, e);
            this.loaded = false;
            this.image = null;
            if (typeof showToast === 'function') showToast('图片壁纸加载失败，请检查文件是否存在或更换其他位置', 'error');
        };
        this.image.src = imgUrl;

        // 添加到容器
        if (this._container) {
            this._container.appendChild(this.image);
        }
    }

    _updateStyle() {
        if (!this.image) return;
        const opacity = this.engine.wallpaperOpacity != null ? this.engine.wallpaperOpacity : 1;
        const blur = this.engine.wallpaperBlur || 0;
        const fitMode = this.engine.wallpaperFitMode || 'smart';

        this.image.style.opacity = opacity;
        // CSS filter blur 由 GPU 加速
        this.image.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';
        // 固定放大 5% 避免 blur 边缘出现透明，不会随 blur 增大而过度放大
        this.image.style.transform = blur > 0 ? 'scale(1.05)' : 'none';
        // object-fit 映射
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
        this.image.style.objectFit = fitMap[fitMode] || 'cover';
    }

    _sampleBrightness() {
        if (!this.loaded || !this.image) return;
        try {
            const sCtx = this._brightnessSampleCtx;
            sCtx.drawImage(this.image, 0, 0, 32, 32);
            const data = sCtx.getImageData(0, 0, 32, 32).data;
            let total = 0;
            const pixelCount = 32 * 32;
            for (let i = 0; i < data.length; i += 4) {
                total += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            }
            const brightness = total / pixelCount / 255;
            this._lastBrightness = brightness;
            this.engine._notifyBrightness(brightness);
        } catch (e) {
            this.engine._notifyBrightness(0.5);
        }
    }

    render(dt, timestamp) {
        // 图片由 DOM 显示，无需 Canvas 绘制
        // 只需更新样式（opacity/blur/fit 变化时）
        this._updateStyle();
    }

    destroy() {
        if (this.image) {
            const src = this.image.src;
            if (this.image.parentElement) {
                this.image.parentElement.removeChild(this.image);
            }
            if (src && src.startsWith('blob:')) {
                URL.revokeObjectURL(src);
            }
            this.image = null;
        }
        this.loaded = false;
    }
}

export { CustomImageRenderer };
