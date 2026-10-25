// @vitest-environment jsdom
// static-icons.test.js — 侧边栏图标注入单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { mountStaticIcons } from './static-icons.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('mountStaticIcons', () => {
  it('注入图标容器与首页 symbol', () => {
    mountStaticIcons();
    expect(document.querySelectorAll('#static-icons-root').length).toBe(1);
    expect(document.querySelectorAll('#static-icons-root #icon-home').length).toBe(1);
  });

  it('重复调用保持幂等', () => {
    mountStaticIcons();
    mountStaticIcons();
    expect(document.querySelectorAll('#static-icons-root').length).toBe(1);
    expect(document.querySelectorAll('#icon-home').length).toBe(1);
  });

  it('包含侧边栏所需的核心图标', () => {
    mountStaticIcons();
    for (const id of ['icon-home', 'icon-settings', 'icon-cloud', 'icon-feedback']) {
      expect(document.querySelectorAll(`#${id}`).length).toBe(1);
    }
  });
});
