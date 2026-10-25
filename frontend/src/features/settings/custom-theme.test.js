// @vitest-environment jsdom
// custom-theme.test.js — 自定义主题色算法单元测试
import { describe, expect, it } from 'vitest';
import {
  _contrastTextColor,
  _hexToRgb,
  _hslToHex,
  _rgbToHsl,
  generateCustomThemeVars,
} from './custom-theme.js';

describe('颜色空间转换', () => {
  it('解析合法六位十六进制，拒绝非法输入', () => {
    expect(_hexToRgb('#4c8dff')).toEqual({ r: 76, g: 141, b: 255 });
    expect(_hexToRgb('4c8dff')).toEqual({ r: 76, g: 141, b: 255 });
    expect(_hexToRgb('#fff')).toBeNull();
    expect(_hexToRgb('red')).toBeNull();
  });

  it('RGB 转 HSL 覆盖灰色与彩色', () => {
    expect(_rgbToHsl(255, 255, 255)).toEqual({ h: 0, s: 0, l: 100 });
    expect(_rgbToHsl(0, 0, 0)).toEqual({ h: 0, s: 0, l: 0 });
    const blue = _rgbToHsl(76, 141, 255);
    expect(blue.h).toBeGreaterThan(200);
    expect(blue.h).toBeLessThan(230);
  });

  it('HSL 转回十六进制并夹取越界值', () => {
    expect(_hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(_hslToHex(360, 100, 50)).toBe('#ff0000');
    expect(_hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(_hslToHex(0, -20, 50)).toBe('#808080');
  });

  it('对比色按亮度选择黑或白', () => {
    expect(_contrastTextColor('#ffffff')).toBe('#0a0a0a');
    expect(_contrastTextColor('#000000')).toBe('#ffffff');
    expect(_contrastTextColor('bad')).toBe('#ffffff');
  });
});

describe('generateCustomThemeVars', () => {
  it('非法颜色返回 null', () => {
    expect(generateCustomThemeVars('bad')).toBeNull();
  });

  it('深色与浅色基底生成完整变量集', () => {
    const dark = generateCustomThemeVars('#4c8dff');
    const light = generateCustomThemeVars('#4c8dff', true);
    expect(Object.keys(dark).length).toBeGreaterThan(20);
    expect(Object.keys(light).length).toBeGreaterThan(20);
    expect(dark['--accent']).toMatch(/^#[0-9a-f]{6}$/);
    expect(light['--bg-primary']).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark['--accent-rgb']).toMatch(/^\d+, \d+, \d+$/);
  });

  it('无彩色主题保持灰阶，不漂移成彩色', () => {
    const vars = generateCustomThemeVars('#808080');
    const rgb = _hexToRgb(vars['--accent']);
    expect(rgb.r).toBe(rgb.g);
    expect(rgb.g).toBe(rgb.b);
    expect(vars['--bg-glass']).toContain('0%');
  });
});
