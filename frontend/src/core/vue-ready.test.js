// vue-ready.test.js — Vue 挂载完成等待单元测试
import { describe, expect, it } from 'vitest';
import { isVueMountDone, markVueMountDone, waitForVueMount } from './vue-ready.js';

describe('vue-ready', () => {
  it('初始未完成，多个等待方在标记后一起放行', async () => {
    expect(isVueMountDone()).toBe(false);

    const order = [];
    const first = waitForVueMount().then(() => order.push('first'));
    const second = waitForVueMount().then(() => order.push('second'));

    expect(isVueMountDone()).toBe(false);
    markVueMountDone();
    await Promise.all([first, second]);

    expect(order).toEqual(['first', 'second']);
    expect(isVueMountDone()).toBe(true);
  });

  it('已完成时立即返回', async () => {
    await expect(waitForVueMount()).resolves.toBeUndefined();
  });
});
