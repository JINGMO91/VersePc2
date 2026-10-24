

class WebWallpaperRenderer {
    constructor(engine) {
        this.engine = engine;
        this.iframe = null;
        this._container = document.getElementById('wallpaper-web-container');
        if (engine.webWallpaperSrc) {
            this.loadWeb(engine.webWallpaperSrc);
        }
    }

    setTheme() {}
    onResize() {}

    loadWeb(src) {
        if (this.iframe) {
            this.iframe.remove();
            this.iframe = null;
        }
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0;';
        iframe.setAttribute('allow', 'autoplay');
        iframe.setAttribute('tabindex', '-1');
        iframe.src = src;
        this.iframe = iframe;
        if (this._container) {
            this._container.appendChild(iframe);
        }
    }

    destroy() {
        if (this.iframe) {
            this.iframe.remove();
            this.iframe = null;
        }
    }
}

export { WebWallpaperRenderer };
