// @vitest-environment jsdom
// announcement.test.js — 启动次数与支持里程碑单元测试
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../../core/app-state.js';
import {
  getLaunchCount,
  incrementLaunchCount,
  isSupportMilestone,
  showSupportModal,
  SUPPORT_MILESTONES,
} from './announcement.js';

beforeEach(() => {
  localStorage.clear();
  appState._launchCounted = false;
  document.body.innerHTML = '';
});

describe('启动次数', () => {
  it('默认 0，递增后写回本地存储', () => {
    expect(getLaunchCount()).toBe(0);
    expect(incrementLaunchCount()).toBe(1);
    expect(getLaunchCount()).toBe(1);
  });

  it('同一次启动只计数一次', () => {
    incrementLaunchCount();
    expect(incrementLaunchCount()).toBe(1);
    expect(getLaunchCount()).toBe(1);
  });
});

describe('支持里程碑', () => {
  it('只命中约定次数', () => {
    expect(SUPPORT_MILESTONES.length).toBeGreaterThan(0);
    for (const count of SUPPORT_MILESTONES) {
      expect(isSupportMilestone(count)).toBe(true);
    }
    expect(isSupportMilestone(2)).toBe(false);
  });

  it('展示支持弹窗并关闭启动遮罩', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="support-modal-count"></div>
      <div id="support-modal" style="display:none"></div>
      <div id="game-launch-overlay" style="display:flex"></div>
    `;
    showSupportModal(50);
    vi.advanceTimersByTime(800);

    expect(document.getElementById('support-modal-count').textContent).toBe('50');
    expect(document.getElementById('support-modal').style.display).toBe('');
    expect(document.getElementById('support-modal').classList.contains('modal-visible')).toBe(true);
    expect(document.getElementById('game-launch-overlay').style.display).toBe('none');
    vi.useRealTimers();
  });
});
