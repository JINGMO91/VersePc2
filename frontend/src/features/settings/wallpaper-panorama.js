

class PanoramaRenderer {
    constructor(engine) {
        this.engine = engine;
        this.threeRenderer = null;
        this.threeScene = null;
        this.threeCamera = null;
        this.cube = null;
        this.loaded = false;
        this.autoRotation = 0;
        this.ROTATION_SPEED = 0.005;
        this.mouseFollowEnabled = false;
        this.currentTheme = 'overworld';
        this._loadSeq = 0;
        this.init();
    }

    setTheme(theme) {
        const validTheme = theme || 'overworld';
        if (this.currentTheme === validTheme) return;
        this.currentTheme = validTheme;
        this.loaded = false;
        this._loadTextures();
    }

    _loadTextures() {
        if (!this.cube) return;
        const seq = ++this._loadSeq;
        const loader = new THREE.TextureLoader();
        const safeTheme = ['overworld', 'nether', 'end', 'panorama', 'wild', 'darkforest', 'desert', 'mountains', 'cherry', 'deep_dark'].includes(this.currentTheme) ? this.currentTheme : 'overworld';
        const basePath = 'img/panorama/' + safeTheme + '/';
        const faceOrder = [1, 3, 4, 5, 0, 2];
        let loadedCount = 0;
        this.cube.material.forEach((mat, i) => {
            loader.load(basePath + 'panorama_' + faceOrder[i] + '.png', (texture) => {
                if (this._loadSeq !== seq) return; // 丢弃过期加载
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                mat.map = texture;
                mat.color = new THREE.Color(0xffffff);
                mat.needsUpdate = true;
                loadedCount++;
                if (loadedCount >= 6) this.loaded = true;
            }, undefined, () => {
                // 加载失败：如果这是最新请求，保持黑色占位
                if (this._loadSeq !== seq) return;
                loadedCount++;
                if (loadedCount >= 6) this.loaded = true;
            });
        });
    }

    init() { this._initThree(); }
    onResize() { this._onThreeResize(); }

    _initThree() {
        const glCanvas = this.engine.glCanvas;
        if (!glCanvas || typeof THREE === 'undefined') {
            console.error('[PanoramaRenderer] WebGL canvas or THREE.js not available');
            return;
        }

        try {
            this.threeScene = new THREE.Scene();
            this.threeCamera = new THREE.PerspectiveCamera(75, glCanvas.clientWidth / glCanvas.clientHeight, 0.1, 1000);
            this.threeCamera.position.set(0, 0, 0);

            this.threeRenderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: false, antialias: true, powerPreference: 'low-power' });
            this.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.threeRenderer.setSize(glCanvas.clientWidth, glCanvas.clientHeight, false);
            this.threeRenderer.setClearColor(0x0a0a0a);

            const faceOrder = [1, 3, 4, 5, 0, 2];
            const materials = faceOrder.map(() => {
                return new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x0a0a0a });
            });

            const geometry = new THREE.BoxGeometry(10, 10, 10);
            this.cube = new THREE.Mesh(geometry, materials);
            this.threeScene.add(this.cube);

            this._loadTextures();
        } catch (e) {
            console.error('[PanoramaRenderer] Three.js init error:', e);
        }
    }

    _onThreeResize() {
        if (!this.threeRenderer) return;
        const glCanvas = this.engine.glCanvas;
        if (!glCanvas) return;
        this.threeRenderer.setSize(glCanvas.clientWidth, glCanvas.clientHeight, false);
        this.threeCamera.aspect = glCanvas.clientWidth / glCanvas.clientHeight;
        this.threeCamera.updateProjectionMatrix();
    }

    render(dt, timestamp) {
        if (!this.threeRenderer || !this.cube) return;
        const clampedDt = Math.min(dt, 100);
        this.autoRotation += this.ROTATION_SPEED * clampedDt * 0.06;
        this.cube.rotation.y = this.autoRotation;
        if (this.mouseFollowEnabled && this.engine) {
            const mx = this.engine.mouseX || 0;
            const my = this.engine.mouseY || 0;
            this.cube.rotation.y += mx * 0.15;
            this.cube.rotation.x = my * 0.08;
        } else {
            this.cube.rotation.x = 0;
        }
        this.threeRenderer.render(this.threeScene, this.threeCamera);
    }

    setRotationSpeed(speed) {
        this.ROTATION_SPEED = speed;
    }

    setMouseFollow(enabled) {
        this.mouseFollowEnabled = enabled;
    }

    destroy() {
        if (this.threeRenderer) {
            this.threeRenderer.dispose();
        }
        if (this.cube) {
            this.cube.geometry.dispose();
            this.cube.material.forEach(m => {
                if (m.map) m.map.dispose();
                m.dispose();
            });
        }
    }
}

export { PanoramaRenderer };
