// launch-state.test.js — 启动进度与状态常量单元测试
import { describe, expect, it } from 'vitest';
import { S } from './launch-state.js';

describe('launch-state', () => {
  it('启动步骤进度单调递增且位于 0-100', () => {
    const values = Object.values(S.LAUNCH_STEP_PROGRESS);
    expect(values.length).toBeGreaterThan(5);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
    expect(values[0]).toBeGreaterThan(0);
    expect(values[values.length - 1]).toBeLessThan(100);
  });

  it('轮询错误上限为正数', () => {
    expect(S.MAX_STATUS_ERRORS).toBe(5);
  });
});
