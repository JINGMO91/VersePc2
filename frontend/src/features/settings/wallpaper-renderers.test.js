// @vitest-environment jsdom
// wallpaper-renderers.test.js — 壁纸引擎生命周期、模式切换与绘制适配单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  toast,
  sceneInstall,
  sceneRendererCtor,
  panoramaCtor,
  imageCtor,
  videoCtor,
  webCtor,
  bridgeMock,
} = vi.hoisted(() => {
  const makeSpy = () => vi.fn();
  class SceneWallpaperRenderer {
    constructor(engine) {
      this.engine = engine;
      this.loadStream = makeSpy();
      this.destroy = makeSpy();
      this.render = makeSpy();
    }
  }
  class PanoramaRenderer {
    constructor(engine) {
      this.engine = engine;
      this.destroy = makeSpy();
      this.render = makeSpy();
      this.setTheme = makeSpy();
      this.setRotationSpeed = makeSpy();
      this.setMouseFollow = makeSpy();
      this.onResize = makeSpy();
    }
  }
  class CustomImageRenderer {
    constructor(engine) {
      this.engine = engine;
      this.loaded = true;
      this._updateStyle = makeSpy();
      this.render = makeSpy();
      this.destroy = makeSpy();
    }
  }
  class CustomVideoRenderer {
    constructor(engine) {
      this.engine = engine;
      this.video = { pause: makeSpy(), play: makeSpy(() => Promise.resolve()) };
      this.render = makeSpy();
      this.destroy = makeSpy();
      this._startBrightnessSampling = makeSpy();
    }
  }
  class WebWallpaperRenderer {
    constructor(engine) {
      this.engine = engine;
      this.render = makeSpy();
      this.destroy = makeSpy();
    }
  }
  return {
    toast: vi.fn(),
    sceneInstall: vi.fn(async () => true),
    sceneRendererCtor: SceneWallpaperRenderer,
    panoramaCtor: PanoramaRenderer,
    imageCtor: CustomImageRenderer,
    videoCtor: CustomVideoRenderer,
    webCtor: WebWallpaperRenderer,
    bridgeMock: {
      invoke: vi.fn(),
      getAuroraVideoPath: vi.fn(),
    },
  };
});

vi.mock('../misc/ui-components.js', () => ({ showToast: toast }));
vi.mock('./wallpaper-scene.js', () => ({
  ensureSceneRendererInstalled: sceneInstall,
  SceneWallpaperRenderer: sceneRendererCtor,
}));
vi.mock('./wallpaper-panorama.js', () => ({ PanoramaRenderer: panoramaCtor }));
vi.mock('./wallpaper-image.js', () => ({ CustomImageRenderer: imageCtor }));
vi.mock('./wallpaper-video.js', () => ({ CustomVideoRenderer: videoCtor }));
vi.mock('./wallpaper-web.js', () => ({ WebWallpaperRenderer: webCtor }));
vi.mock('../../core/tauri-bridge.js', () => ({ bridge: bridgeMock }));

let mod;
let ctx;
let canvas;
let rafId;
let nowValue;

function buildDom() {
  document.body.innerHTML = `
    <canvas id="wallpaper-canvas"></canvas>
    <canvas id="wallpaper-canvas-gl"></canvas>
    <div id="wallpaper-video-container" style="display:none"></div>
    <div id="wallpaper-web-container" style="display:none"></div>
    <div id="wallpaper-scene-container" style="display:none"></div>
    <div id="wallpaper-overlay"></div>
    <div id="app" class="wp-light wp-dark"></div>
  `;
}

function newEngine(mode = 'none') {
  const engine = new mod.WallpaperEngine(canvas);
  engine.currentMode = mode;
  return engine;
}

beforeAll(async () => {
  vi.resetModules();
  mod = await import('./wallpaper-renderers.js');
});

beforeEach(() => {
  buildDom();
  toast.mockClear();
  sceneInstall.mockClear();
  sceneInstall.mockResolvedValue(true);
  bridgeMock.invoke.mockReset();
  bridgeMock.getAuroraVideoPath.mockReset();
  bridgeMock.getAuroraVideoPath.mockResolvedValue('');
  ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  };
  canvas = document.getElementById('wallpaper-canvas');
  canvas.getContext = vi.fn(() => ctx);
  rafId = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++rafId));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  nowValue = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => nowValue);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('drawFitMode', () => {
  const source = { width: 100, height: 50 };

  it('center 居中绘制原始尺寸', () => {
    mod.drawFitMode(ctx, source, 100, 50, 400, 200, 'center');

    expect(ctx.drawImage).toHaveBeenCalledWith(source, 150, 75, 100, 50);
  });

  it('cover 按比例放大并居中裁切', () => {
    mod.drawFitMode(ctx, source, 100, 50, 400, 400, 'cover');

    expect(ctx.drawImage).toHaveBeenCalledWith(source, -200, 0, 800, 400);
  });

  it('stretch 铺满画布', () => {
    mod.drawFitMode(ctx, source, 100, 50, 400, 200, 'stretch');

    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 400, 200);
  });

  it('tile 平铺循环', () => {
    mod.drawFitMode(ctx, source, 100, 50, 250, 120, 'tile');

    expect(ctx.drawImage).toHaveBeenCalledTimes(9);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(source, 200, 100, 100, 50);
  });

  it('四角对齐模式', () => {
    mod.drawFitMode(ctx, source, 100, 50, 400, 200, 'topLeft');
    mod.drawFitMode(ctx, source, 100, 50, 400, 200, 'topRight');
    mod.drawFitMode(ctx, source, 100, 50, 400, 200, 'bottomLeft');
    mod.drawFitMode(ctx, source, 100, 50, 400, 200, 'bottomRight');

    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, source, 0, 0, 100, 50);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, source, 300, 0, 100, 50);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(3, source, 0, 150, 100, 50);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(4, source, 300, 150, 100, 50);
  });

  it('未知模式回落到 cover', () => {
    mod.drawFitMode(ctx, source, 100, 50, 400, 400, 'unknown');

    expect(ctx.drawImage).toHaveBeenCalledWith(source, -200, 0, 800, 400);
  });

  it('smart 模式大图使用 cover，小图使用 tile', () => {
    mod.drawFitMode(ctx, source, 300, 100, 400, 200, 'smart');
    expect(ctx.drawImage).toHaveBeenLastCalledWith(source, -100, 0, 600, 200);

    ctx.drawImage.mockClear();
    mod.drawFitMode(ctx, source, 50, 25, 400, 200, 'smart');
    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('构造与尺寸', () => {
  it('初始化默认字段', () => {
    const engine = new mod.WallpaperEngine(canvas);

    expect(engine.canvas).toBe(canvas);
    expect(engine.glCanvas).toBe(document.getElementById('wallpaper-canvas-gl'));
    expect(engine.currentMode).toBe('none');
    expect(engine.wallpaperFitMode).toBe('cover');
    expect(engine.isRunning).toBe(false);
    expect(engine.renderer).toBeNull();
  });

  it('场景渲染尺寸跟随窗口与 DPR', () => {
    const engine = newEngine();

    expect(engine._sceneRenderSize()).toEqual({ width: 2560, height: 1440 });
  });

  it('场景渲染尺寸受上下限约束', () => {
    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 10000, configurable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: 9, configurable: true });
    const engine = newEngine();

    expect(engine._sceneRenderSize()).toEqual({ width: 640, height: 2160 });
  });
});

describe('start / stop', () => {
  it('启动时注册事件并进入渲染循环', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const engine = newEngine('panorama');

    engine.start();
    await Promise.resolve();

    expect(engine.isRunning).toBe(true);
    expect(engine.renderer).toBeInstanceOf(panoramaCtor);
    expect(add).toHaveBeenCalledWith('resize', engine._onResize);
    expect(add).toHaveBeenCalledWith('mousemove', engine._onMouseMove);
    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it('重复启动不重复初始化', async () => {
    const engine = newEngine('panorama');
    engine.start();
    await Promise.resolve();
    const renderer = engine.renderer;

    engine.start();

    expect(engine.renderer).toBe(renderer);
  });

  it('无壁纸模式启动后停止 RAF 循环', () => {
    const engine = newEngine('none');

    engine.start();

    expect(engine.animationId).toBeNull();
  });

  it('停止时销毁渲染器、停止场景进程并清理画布', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    bridgeMock.invoke.mockResolvedValue({ ok: true });
    const engine = newEngine('panorama');
    engine.start();
    await Promise.resolve();
    const renderer = engine.renderer;
    engine.animationId = 9;

    engine.stop();

    expect(engine.isRunning).toBe(false);
    expect(engine.animationId).toBeNull();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(9);
    expect(renderer.destroy).toHaveBeenCalled();
    expect(engine.renderer).toBeNull();
    expect(bridgeMock.invoke).toHaveBeenCalledWith('scene_renderer_stop');
    expect(remove).toHaveBeenCalledWith('resize', engine._onResize);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 2560, 1440);
  });

  it('重复停止直接返回', () => {
    const engine = newEngine();

    expect(() => engine.stop()).not.toThrow();
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it('停止场景进程失败时记录错误', async () => {
    bridgeMock.invoke.mockRejectedValue(new Error('no process'));
    const engine = newEngine();
    engine.scenePort = 9000;

    await engine._stopSceneProcess();

    expect(console.error).toHaveBeenCalled();
    expect(engine.scenePort).toBe(0);
    expect(engine._sceneWorkshopId).toBeNull();
  });
});

describe('场景壁纸进程', () => {
  it('启动成功切换到场景模式', async () => {
    bridgeMock.invoke.mockResolvedValue({ ok: true, port: 9100 });
    const engine = newEngine('none');

    await expect(engine._startSceneProcess('123')).resolves.toBe(true);

    expect(bridgeMock.invoke).toHaveBeenCalledWith('scene_renderer_start', {
      workshopId: '123',
      width: 2560,
      height: 1440,
    });
    expect(engine.scenePort).toBe(9100);
    expect(engine._sceneWorkshopId).toBe('123');
    expect(engine.currentMode).toBe('sceneWallpaper');
  });

  it('组件缺失时引导安装后重试', async () => {
    bridgeMock.invoke
      .mockResolvedValueOnce({ missing: true })
      .mockResolvedValueOnce({ ok: true, port: 9200 });
    sceneInstall.mockResolvedValue(true);
    const engine = newEngine('none');

    await expect(engine._startSceneProcess('42')).resolves.toBe(true);

    expect(sceneInstall).toHaveBeenCalled();
    expect(bridgeMock.invoke).toHaveBeenCalledTimes(2);
  });

  it('安装失败则不重试', async () => {
    bridgeMock.invoke.mockResolvedValue({ missing: true });
    sceneInstall.mockResolvedValue(false);
    const engine = newEngine('none');

    await expect(engine._startSceneProcess('42')).resolves.toBe(false);

    expect(bridgeMock.invoke).toHaveBeenCalledTimes(1);
    expect(engine.scenePort).toBe(0);
  });

  it('启动返回失败时提示', async () => {
    bridgeMock.invoke.mockResolvedValue({ ok: false, error: 'gpu' });
    const engine = newEngine('none');

    await expect(engine._startSceneProcess('42')).resolves.toBe(false);

    expect(toast).toHaveBeenCalledWith('场景壁纸启动失败: gpu', 'error');
  });

  it('启动异常时提示', async () => {
    bridgeMock.invoke.mockRejectedValue(new Error('crash'));
    const engine = newEngine('none');

    await expect(engine._startSceneProcess('42')).resolves.toBe(false);

    expect(toast).toHaveBeenCalledWith('场景壁纸启动失败', 'error');
  });

  it('已处于场景模式时直接切换视频流', async () => {
    bridgeMock.invoke.mockResolvedValue({ ok: true, port: 9300 });
    const engine = newEngine('sceneWallpaper');
    const renderer = new sceneRendererCtor(engine);
    engine.renderer = renderer;

    await expect(engine._startSceneProcess('7')).resolves.toBe(true);

    expect(renderer.loadStream).toHaveBeenCalledWith(9300);
    expect(engine.currentMode).toBe('sceneWallpaper');
  });
});

describe('挂起与恢复', () => {
  it('挂起时停止视频与亮度采样', () => {
    const engine = newEngine('customVideo');
    const renderer = new videoCtor(engine);
    renderer._brightnessCheckInterval = 12;
    engine.renderer = renderer;
    engine.animationId = 3;

    engine.suspend();

    expect(engine._suspended).toBe(true);
    expect(engine.animationId).toBeNull();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(3);
    expect(renderer.video.pause).toHaveBeenCalled();
    expect(renderer._brightnessCheckInterval).toBeNull();
  });

  it('场景模式下挂起会停止离屏进程', () => {
    bridgeMock.invoke.mockResolvedValue({ ok: true });
    const engine = newEngine('sceneWallpaper');
    engine.scenePort = 9100;

    engine.suspend();

    expect(bridgeMock.invoke).toHaveBeenCalledWith('scene_renderer_stop');
  });

  it('重复挂起直接返回', () => {
    const engine = newEngine();
    engine.suspend();

    expect(() => engine.suspend()).not.toThrow();
  });

  it('恢复时播放视频并重启亮度采样', () => {
    const engine = newEngine('customVideo');
    const renderer = new videoCtor(engine);
    engine.renderer = renderer;
    engine.suspend();
    engine.isRunning = true;

    engine.resume();

    expect(engine._suspended).toBe(false);
    expect(renderer.video.play).toHaveBeenCalled();
    expect(renderer._startBrightnessSampling).toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it('场景模式恢复时按保存的 ID 重启进程', async () => {
    bridgeMock.invoke.mockResolvedValue({ ok: true, port: 9400 });
    const engine = newEngine('sceneWallpaper');
    engine._suspended = true;
    engine._sceneWorkshopId = '88';
    engine.scenePort = 0;
    engine.isRunning = false;

    engine.resume();

    await Promise.resolve();
    await Promise.resolve();
    expect(bridgeMock.invoke).toHaveBeenCalledWith('scene_renderer_start', expect.objectContaining({ workshopId: '88' }));
  });

  it('未挂起时恢复直接返回', () => {
    const engine = newEngine();

    expect(() => engine.resume()).not.toThrow();
  });
});

describe('主题与模式切换', () => {
  it('设置主题透传给渲染器', () => {
    const engine = newEngine('panorama');
    const renderer = new panoramaCtor(engine);
    engine.renderer = renderer;

    engine.setTheme(false);

    expect(engine.isDarkTheme).toBe(false);
    expect(renderer.setTheme).toHaveBeenCalledWith(false);
  });

  it('无渲染器时设置主题安全返回', () => {
    const engine = newEngine();

    expect(() => engine.setTheme(true)).not.toThrow();
  });

  it('相同模式直接返回', () => {
    const engine = newEngine('panorama');
    engine.renderer = new panoramaCtor(engine);
    const renderer = engine.renderer;

    engine.switchMode('panorama');

    expect(engine.renderer).toBe(renderer);
  });

  it('运行时切换模式重建渲染器并开启过渡', async () => {
    const engine = newEngine('panorama');
    engine.isRunning = true;
    engine.start();
    await Promise.resolve();

    engine.switchMode('customImage');
    await Promise.resolve();

    expect(engine.currentMode).toBe('customImage');
    expect(engine.renderer).toBeInstanceOf(imageCtor);
    expect(engine.transitioning).toBe(true);
    expect(engine.transitionAlpha).toBe(0);
  });

  it('离开场景模式时停止离屏进程', () => {
    bridgeMock.invoke.mockResolvedValue({ ok: true });
    const engine = newEngine('sceneWallpaper');
    engine.isRunning = true;
    engine.scenePort = 9100;

    engine.switchMode('customImage');

    expect(bridgeMock.invoke).toHaveBeenCalledWith('scene_renderer_stop');
  });

  it('从 none 切到具体模式时重启渲染循环', () => {
    const engine = newEngine('none');
    engine.isRunning = true;

    engine.switchMode('panorama');

    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it('未运行时切换只更新模式', () => {
    const engine = newEngine('none');

    engine.switchMode('customVideo');

    expect(engine.currentMode).toBe('customVideo');
    expect(engine.renderer).toBeNull();
    expect(engine.transitioning).toBe(false);
  });
});

describe('亮度回调与极光路径', () => {
  it('亮度变化通知订阅者', () => {
    const engine = newEngine();
    const callback = vi.fn();
    engine.onBrightnessChange(callback);

    engine._notifyBrightness(0.7);

    expect(engine.wallpaperBrightness).toBe(0.7);
    expect(callback).toHaveBeenCalledWith(0.7);
  });

  it('极光视频优先使用 IPC 路径', async () => {
    bridgeMock.getAuroraVideoPath.mockResolvedValue('D:/aurora.mp4');
    const engine = newEngine();

    await expect(engine._getAuroraVideoPath()).resolves.toBe('D:/aurora.mp4');
  });

  it('IPC 为空时回退相对路径', async () => {
    bridgeMock.getAuroraVideoPath.mockResolvedValue('');
    const engine = newEngine();

    await expect(engine._getAuroraVideoPath()).resolves.toBe('resources/wallpapers/aurora.mp4');
  });

  it('IPC 异常时回退相对路径', async () => {
    bridgeMock.getAuroraVideoPath.mockRejectedValue(new Error('no ipc'));
    const engine = newEngine();

    await expect(engine._getAuroraVideoPath()).resolves.toBe('resources/wallpapers/aurora.mp4');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('_initRenderer', () => {
  it('none 模式隐藏画布并清理主题类', async () => {
    const engine = newEngine('none');

    await engine._initRenderer();

    expect(canvas.style.display).toBe('none');
    expect(document.getElementById('app').classList.contains('wp-dark')).toBe(false);
    expect(document.getElementById('wallpaper-overlay').style.background).toBe('transparent');
    expect(engine.renderer).toBeNull();
  });

  it('panorama 模式启用 GL 画布并恢复保存参数', async () => {
    const engine = newEngine('panorama');
    engine._savedPanoramaTheme = 'nether';
    engine._savedRotationSpeed = 0.02;
    engine._savedMouseFollow = true;
    const brightness = vi.fn();
    engine.onBrightnessChange(brightness);

    await engine._initRenderer();

    const renderer = engine.renderer;
    expect(document.getElementById('wallpaper-canvas-gl').style.display).toBe('block');
    expect(canvas.style.display).toBe('none');
    expect(renderer.setTheme).toHaveBeenCalledWith('nether');
    expect(renderer.setRotationSpeed).toHaveBeenCalledWith(0.02);
    expect(renderer.setMouseFollow).toHaveBeenCalledWith(true);
    expect(brightness).toHaveBeenCalledWith(0.5);
  });

  it('customImage 显示视频容器并创建图片渲染器', async () => {
    const engine = newEngine('customImage');

    await engine._initRenderer();

    expect(document.getElementById('wallpaper-video-container').style.display).toBe('block');
    expect(canvas.style.display).toBe('none');
    expect(engine.renderer).toBeInstanceOf(imageCtor);
  });

  it('customVideo 显示视频容器', async () => {
    const engine = newEngine('customVideo');

    await engine._initRenderer();

    expect(document.getElementById('wallpaper-video-container').style.display).toBe('block');
    expect(engine.renderer).toBeInstanceOf(videoCtor);
  });

  it('webWallpaper 显示网页容器', async () => {
    const engine = newEngine('webWallpaper');

    await engine._initRenderer();

    expect(document.getElementById('wallpaper-web-container').style.display).toBe('block');
    expect(engine.renderer).toBeInstanceOf(webCtor);
  });

  it('sceneWallpaper 显示场景容器', async () => {
    const engine = newEngine('sceneWallpaper');

    await engine._initRenderer();

    expect(document.getElementById('wallpaper-scene-container').style.display).toBe('block');
    expect(engine.renderer).toBeInstanceOf(sceneRendererCtor);
  });

  it('auroraVideo 先解析路径再创建视频渲染器', async () => {
    bridgeMock.getAuroraVideoPath.mockResolvedValue('D:/aurora.mp4');
    const engine = newEngine('auroraVideo');

    await engine._initRenderer();

    expect(engine.auroraVideoPath).toBe('D:/aurora.mp4');
    expect(engine.renderer).toBeInstanceOf(videoCtor);
    expect(document.getElementById('wallpaper-video-container').style.display).toBe('block');
  });

  it('未知模式回落到全景渲染器', async () => {
    const engine = newEngine('unknown-mode');

    await engine._initRenderer();

    expect(engine.renderer).toBeInstanceOf(panoramaCtor);
  });

  it('重建前销毁旧渲染器', async () => {
    const engine = newEngine('panorama');
    const previous = new panoramaCtor(engine);
    engine.renderer = previous;

    await engine._initRenderer();

    expect(previous.destroy).toHaveBeenCalled();
  });
});

describe('size / mouse / idle', () => {
  it('resize 按 DPR 调整画布并通知渲染器', () => {
    const engine = newEngine('panorama');
    const renderer = new panoramaCtor(engine);
    engine.renderer = renderer;

    engine._onResize();

    expect(canvas.width).toBe(2560);
    expect(canvas.height).toBe(1440);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(document.getElementById('wallpaper-canvas-gl').width).toBe(2560);
    expect(renderer.onResize).toHaveBeenCalled();
  });

  it('鼠标移动归一化坐标并恢复节流', () => {
    const engine = newEngine();
    engine._idleThrottle = true;
    engine._frameCount = 8;

    engine._onMouseMove({ clientX: 960, clientY: 180 });

    expect(engine.mouseX).toBe(0.5);
    expect(engine.mouseY).toBe(-0.5);
    expect(engine._lastInteraction).toBe(1000);
    expect(engine._idleThrottle).toBe(false);
    expect(engine._frameCount).toBe(0);
  });

  it('空闲超过三秒开启节流', () => {
    const engine = newEngine();
    nowValue = 5000;

    engine._onIdleCheck();

    expect(engine._idleThrottle).toBe(true);
    expect(engine._frameCount).toBe(0);
  });

  it('已节流时不重复处理', () => {
    const engine = newEngine();
    engine._idleThrottle = true;

    engine._onIdleCheck();

    expect(engine._idleThrottle).toBe(true);
  });
});

describe('_animate', () => {
  it('未运行时直接返回', () => {
    const engine = newEngine('panorama');

    engine._animate(1000);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('none 模式且不在过渡时停止循环', () => {
    const engine = newEngine('none');
    engine.isRunning = true;

    engine._animate(1000);

    expect(engine.animationId).toBeNull();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('普通模式调用渲染器并继续排帧', () => {
    const engine = newEngine('panorama');
    engine.isRunning = true;
    engine.renderer = new panoramaCtor(engine);
    engine.lastTime = 990;

    engine._animate(1000);

    expect(engine.renderer.render).toHaveBeenCalledWith(10, 1000);
    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it('静态图片已加载时只更新样式', () => {
    const engine = newEngine('customImage');
    engine.isRunning = true;
    engine.renderer = new imageCtor(engine);

    engine._animate(1000);

    expect(engine.renderer._updateStyle).toHaveBeenCalled();
    expect(engine.renderer.render).not.toHaveBeenCalled();
  });

  it('静态图片未加载时正常渲染', () => {
    const engine = newEngine('customImage');
    engine.isRunning = true;
    engine.renderer = new imageCtor(engine);
    engine.renderer.loaded = false;

    engine._animate(1000);

    expect(engine.renderer.render).toHaveBeenCalled();
  });

  it('过渡时推进透明度并绘制遮罩', () => {
    const engine = newEngine('customImage');
    engine.isRunning = true;
    engine.transitioning = true;
    engine.transitionAlpha = 0;
    engine.lastTime = 1000;

    engine._animate(1050);

    expect(engine.transitionAlpha).toBeCloseTo(0.15, 5);
    expect(engine.transitioning).toBe(true);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1280, 720);
  });

  it('透明度到达上限时结束过渡', () => {
    const engine = newEngine('customImage');
    engine.isRunning = true;
    engine.transitioning = true;
    engine.transitionAlpha = 0.9;
    engine.lastTime = 1000;

    engine._animate(1050);

    expect(engine.transitionAlpha).toBe(1);
    expect(engine.transitioning).toBe(false);
  });

  it('过渡未完成时使用 dt 推进', () => {
    const engine = newEngine('customImage');
    engine.isRunning = true;
    engine.transitioning = true;
    engine.transitionAlpha = 0;
    engine.lastTime = 1000;

    engine._animate(1010);

    expect(engine.transitionAlpha).toBeCloseTo(0.03, 5);
    expect(engine.transitioning).toBe(true);
  });

  it('全景模式空闲时隔帧渲染', () => {
    const engine = newEngine('panorama');
    engine.isRunning = true;
    engine.renderer = new panoramaCtor(engine);
    engine._idleThrottle = true;
    engine._frameCount = 1;
    nowValue = 0;

    engine._animate(1000);

    expect(engine.renderer.render).not.toHaveBeenCalled();
  });

  it('无渲染器时仍保持循环', () => {
    const engine = newEngine('panorama');
    engine.isRunning = true;

    engine._animate(1000);

    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(engine.renderer).toBeNull();
  });
});
