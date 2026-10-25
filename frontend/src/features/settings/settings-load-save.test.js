// @vitest-environment jsdom
// settings-load-save.test.js — 设置页纯展示辅助单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { updateSpeedLimitLabel } from './settings-load-save.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('updateSpeedLimitLabel', () => {
  it('0 显示无限制，正数显示 MB/s', () => {
    document.body.innerHTML = '<span id="speed-limit-value"></span>';
    updateSpeedLimitLabel(0);
    expect(document.getElementById('speed-limit-value').textContent).toBe('无限制');
    updateSpeedLimitLabel(32);
    expect(document.getElementById('speed-limit-value').textContent).toBe('32 MB/s');
  });

  it('节点不存在时静默返回', () => {
    expect(() => updateSpeedLimitLabel(10)).not.toThrow();
  });
});
