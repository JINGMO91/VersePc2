// @vitest-environment jsdom
// liquid-glass.test.js — 液态玻璃表面构建、样式同步与内核能力判定单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let mod;
let LiquidGlass;
let ctx;
let rafCallback;
let roInstances;

function setChromiumUA() {
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
    configurable: true,
  });
}

function makeElement(width = 120, height = 60) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
  });
  return element;
}

beforeAll(async () => {
  setChromiumUA();
  vi.stubGlobal('CSS', { supports: vi.fn(() => true) });
  class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      roInstances.push(this);
    }
  }
  roInstances = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    rafCallback = callback;
    return 7;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.resetModules();
  mod = await import('./liquid-glass.js');
  LiquidGlass = mod.LiquidGlass;
});

beforeEach(() => {
  roInstances = [];
  rafCallback = null;
  requestAnimationFrame.mockClear();
  cancelAnimationFrame.mockClear();
  ctx = {
    createImageData: vi.fn((width, height) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    })),
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA');
  LiquidGlass.removeAll();
  document.getElementById('liquid-glass-style')?.remove();
});

afterEach(() => {
  LiquidGlass.removeAll();
  document.getElementById('liquid-glass-style')?.remove();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('能力检测', () => {
  it('Chromium 内核下标记支持', () => {
    expect(LiquidGlass.supported).toBe(true);
  });

  it('非 Chromium 内核禁用', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 Firefox/120.0',
      configurable: true,
    });
    vi.resetModules();
    const fresh = await import('./liquid-glass.js');
    expect(fresh.LiquidGlass.supported).toBe(false);

    setChromiumUA();
    vi.resetModules();
    await import('./liquid-glass.js');
  });

  it('缺少 ResizeObserver 时禁用', async () => {
    const original = globalThis.ResizeObserver;
    vi.stubGlobal('ResizeObserver', undefined);
    vi.resetModules();
    const fresh = await import('./liquid-glass.js');

    expect(fresh.LiquidGlass.supported).toBe(false);

    vi.stubGlobal('ResizeObserver', original);
    vi.resetModules();
  });

  it('CSS.supports 抛错时禁用', async () => {
    const original = globalThis.CSS;
    vi.stubGlobal('CSS', { supports: () => { throw new Error('no'); } });
    vi.resetModules();
    const fresh = await import('./liquid-glass.js');

    expect(fresh.LiquidGlass.supported).toBe(false);

    vi.stubGlobal('CSS', original);
    vi.resetModules();
  });
});

describe('apply', () => {
  it('空元素返回 null', () => {
    expect(LiquidGlass.apply(null)).toBeNull();
  });

  it('创建 SVG 滤镜、样式规则与数据引用', () => {
    const element = makeElement();

    const surface = LiquidGlass.apply(element);

    expect(surface).not.toBeNull();
    expect(element.dataset.liquidGlassRef).toBe(surface.filterId);
    const svg = document.querySelector('body > svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const filter = svg.querySelector('filter');
    expect(filter.getAttribute('id')).toBe(surface.filterId);
    expect(filter.getAttribute('colorInterpolationFilters')).toBe('sRGB');
    expect(svg.querySelectorAll('feDisplacementMap')).toHaveLength(3);
    expect(svg.querySelectorAll('feColorMatrix')).toHaveLength(3);
    expect(svg.querySelectorAll('feBlend')).toHaveLength(2);
    expect(svg.querySelector('feImage').getAttribute('href')).toBe('data:image/png;base64,AA');

    const style = document.getElementById('liquid-glass-style');
    expect(style.textContent).toContain(`[data-liquid-glass-ref="${surface.filterId}"]`);
    expect(style.textContent).toContain('backdrop-filter:url(#' + surface.filterId + ') blur(1.5px) saturate(1.8) brightness(1.04) !important');
    expect(roInstances).toHaveLength(1);
    expect(roInstances[0].observe).toHaveBeenCalledWith(element);
  });

  it('合并自定义参数', () => {
    const element = makeElement();

    const surface = LiquidGlass.apply(element, { blur: 3, strength: 0.5 });

    expect(surface.options.blur).toBe(3);
    expect(surface.options.strength).toBe(0.5);
    expect(surface.options.saturate).toBe(1.8);
  });

  it('重复应用返回同一表面', () => {
    const element = makeElement();

    const first = LiquidGlass.apply(element);
    const second = LiquidGlass.apply(element);

    expect(second).toBe(first);
    expect(document.querySelectorAll('body > svg')).toHaveLength(1);
  });
});

describe('尺寸与位移贴图', () => {
  it('测量元素尺寸并写入滤镜属性', () => {
    const element = makeElement(200, 100);
    const surface = LiquidGlass.apply(element);
    ctx.putImageData.mockClear();

    surface.measure(true);

    expect(surface.width).toBe(200);
    expect(surface.height).toBe(100);
    expect(surface.filter.getAttribute('width')).toBe('200');
    expect(surface.image.getAttribute('height')).toBe('100');
    expect(surface.image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('data:image/png;base64,AA');
    expect(ctx.putImageData).toHaveBeenCalled();
  });

  it('小尺寸按最小边钳制', () => {
    const element = makeElement(2, 3);
    const surface = LiquidGlass.apply(element);

    expect(surface.width).toBe(8);
    expect(surface.height).toBe(8);
  });

  it('尺寸未变化且非强制时跳过重建', () => {
    const element = makeElement(100, 50);
    const surface = LiquidGlass.apply(element);
    HTMLCanvasElement.prototype.toDataURL.mockClear();

    surface.measure(false);

    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
  });

  it('色散通道按比例设置位移强度', () => {
    const element = makeElement(160, 80);
    const surface = LiquidGlass.apply(element, { chroma: 0.1 });
    const scales = surface.displacements.map((node) => Number(node.getAttribute('scale')));
    const base = scales[1];

    expect(base).toBeGreaterThan(0);
    expect(scales[0]).toBeCloseTo(base * 0.9, 5);
    expect(scales[2]).toBeCloseTo(base * 1.1, 5);
  });

  it('超大尺寸按最长边缩放到上限', () => {
    const element = makeElement(2000, 1000);
    const surface = LiquidGlass.apply(element);

    const canvas = HTMLCanvasElement.prototype.getContext.mock.instances.at(-1);
    expect(canvas.width).toBeLessThanOrEqual(256);
    expect(canvas.width).toBeGreaterThanOrEqual(8);
    expect(surface.filter.getAttribute('width')).toBe('2000');
  });

  it('位移贴图写入 RGBA 像素', () => {
    const element = makeElement(64, 64);
    LiquidGlass.apply(element);

    const imageData = ctx.createImageData.mock.results.at(-1).value;
    expect(imageData.data[3]).toBe(255);
    expect(imageData.data[2]).toBe(0);
  });
});

describe('schedule', () => {
  it('通过 requestAnimationFrame 合并刷新', () => {
    const element = makeElement();
    const surface = LiquidGlass.apply(element);
    surface.frame = 0;

    surface.schedule();
    surface.schedule();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(surface.frame).toBe(7);

    rafCallback();
    expect(surface.frame).toBe(0);
    expect(surface.width).toBe(120);
  });

  it('已排帧时不再重复调度', () => {
    const element = makeElement();
    const surface = LiquidGlass.apply(element);
    surface.frame = 5;

    surface.schedule();

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('refresh 只刷新已存在的表面', () => {
    const element = makeElement();
    const surface = LiquidGlass.apply(element);
    surface.frame = 0;

    LiquidGlass.refresh(element);
    LiquidGlass.refresh(document.createElement('div'));

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
});

describe('remove / removeAll', () => {
  it('移除表面时销毁节点与样式', () => {
    const element = makeElement();
    const surface = LiquidGlass.apply(element);

    LiquidGlass.remove(element);

    expect(element.dataset.liquidGlassRef).toBeUndefined();
    expect(surface.svg.isConnected).toBe(false);
    expect(roInstances[0].disconnect).toHaveBeenCalled();
    expect(document.getElementById('liquid-glass-style').textContent).toBe('');
  });

  it('未应用的元素移除时无副作用', () => {
    expect(() => LiquidGlass.remove(document.createElement('div'))).not.toThrow();
  });

  it('removeAll 清理全部表面与样式', () => {
    const a = makeElement();
    const b = makeElement();
    const surfaceA = LiquidGlass.apply(a);
    const surfaceB = LiquidGlass.apply(b);
    expect(document.querySelectorAll('body > svg')).toHaveLength(2);

    LiquidGlass.removeAll();

    expect(surfaceA.svg.isConnected).toBe(false);
    expect(surfaceB.svg.isConnected).toBe(false);
    expect(document.getElementById('liquid-glass-style').textContent).toBe('');
  });

  it('destroy 会取消待执行帧', () => {
    const element = makeElement();
    const surface = LiquidGlass.apply(element);
    surface.frame = 9;

    surface.destroy();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(9);
    expect(roInstances[0].disconnect).toHaveBeenCalled();
  });

  it('样式宿主复用同一个 style 节点', () => {
    LiquidGlass.apply(makeElement());
    const first = document.getElementById('liquid-glass-style');
    LiquidGlass.apply(makeElement());
    const second = document.getElementById('liquid-glass-style');

    expect(second).toBe(first);
    expect(document.querySelectorAll('#liquid-glass-style')).toHaveLength(1);
  });
});
