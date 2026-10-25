// personalize-state.test.js — 个性化设置默认值单元测试
import { describe, expect, it } from 'vitest';
import { personalizeState } from './personalize-state.js';

describe('personalizeState', () => {
  it('主题与壁纸默认值', () => {
    expect(personalizeState.theme).toBe('light');
    expect(personalizeState.wallpaper).toBe('none');
    expect(personalizeState.customColor).toBe('#4c8dff');
  });

  it('导航与窗口默认值符合当前产品约定', () => {
    expect(personalizeState.hideNavLabels).toBe(false);
    expect(personalizeState.minimalNav).toBe(false);
    expect(personalizeState.navWidth).toBe(80);
    expect(personalizeState.rememberWindowSize).toBe(true);
    expect(personalizeState.startFullscreen).toBe(false);
  });

  it('壁纸参数默认值', () => {
    expect(personalizeState.opacity).toBe(100);
    expect(personalizeState.blur).toBe(0);
    expect(personalizeState.fit).toBe('cover');
    expect(personalizeState.panoramaTheme).toBe('overworld');
    expect(personalizeState.panoramaSpeed).toBe(5);
    expect(personalizeState.customFileName).toBe('未选择');
  });
});
