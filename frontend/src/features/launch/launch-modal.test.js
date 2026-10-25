// @vitest-environment jsdom
// launch-modal.test.js — 启动弹窗进度与错误提示单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeLaunchModal,
  hideLaunchError,
  setLaunchStep,
  showLaunchError,
  showLaunchModal,
  updateLaunchProgress,
} from './launch-modal.js';

function mountModal() {
  document.body.innerHTML = `
    <div id="game-launch-overlay" style="display:none">
      <div id="launch-splash-track" style="--launch-pct:0">
        <div id="launch-splash-progress"></div>
      </div>
      <div id="launch-splash-status"></div>
      <div id="launch-splash-logo"></div>
      <div id="launch-error-section" style="display:flex"></div>
      <div id="launch-error-msg"></div>
      <div id="launch-log-section" style="display:flex"></div>
      <div id="launch-repair-guide" style="display:flex"></div>
    </div>
  `;
}

beforeEach(mountModal);

describe('showLaunchModal / closeLaunchModal', () => {
  it('打开时展示遮罩并重置进度与附加区域', () => {
    showLaunchModal();
    expect(document.getElementById('game-launch-overlay').style.display).toBe('flex');
    expect(document.getElementById('launch-splash-progress').style.width).toBe('0%');
    expect(document.getElementById('launch-splash-track').style.getPropertyValue('--launch-pct')).toBe('0');
    expect(document.getElementById('launch-splash-status').textContent).toBe('正在验证登录状态...');
    expect(document.getElementById('launch-error-section').style.display).toBe('none');
    expect(document.getElementById('launch-log-section').style.display).toBe('none');
    expect(document.getElementById('launch-repair-guide').style.display).toBe('none');
  });

  it('关闭时隐藏遮罩', () => {
    showLaunchModal();
    closeLaunchModal();
    expect(document.getElementById('game-launch-overlay').style.display).toBe('none');
  });

  it('遮罩不存在时静默返回', () => {
    document.body.innerHTML = '';
    expect(() => showLaunchModal()).not.toThrow();
    expect(() => closeLaunchModal()).not.toThrow();
  });
});

describe('进度与步骤', () => {
  it('按步骤权重更新进度与文案', () => {
    setLaunchStep('auth', 'running', '正在验证...');
    expect(document.getElementById('launch-splash-status').textContent).toBe('正在验证...');
    expect(document.getElementById('launch-splash-progress').style.width).toBe('5%');
  });

  it('成功启动步骤固定 100%', () => {
    setLaunchStep('S.launching', 'success', '');
    expect(document.getElementById('launch-splash-progress').style.width).toBe('100%');
    expect(document.getElementById('launch-splash-status').textContent).toBe('启动成功！');
  });

  it('错误步骤显示红色状态', () => {
    setLaunchStep('auth', 'error', '失败');
    expect(document.getElementById('launch-splash-status').style.color).toBe('rgb(220, 38, 38)');
  });

  it('直接更新进度并同步波浪线头位置', () => {
    updateLaunchProgress(42);
    expect(document.getElementById('launch-splash-progress').style.width).toBe('42%');
    expect(document.getElementById('launch-splash-track').style.getPropertyValue('--launch-pct')).toBe('42');
  });
});

describe('错误提示', () => {
  it('展示错误详情并写入版本信息', () => {
    showLaunchError('启动失败\n第二行', { versionId: '1.20.1', error: 'boom' });
    expect(document.getElementById('launch-error-section').style.display).toBe('flex');
    expect(document.getElementById('launch-error-msg').innerHTML).toContain('启动失败<br>第二行');
    expect(document.getElementById('launch-error-msg').title).toContain('1.20.1');
    expect(document.getElementById('launch-splash-status').textContent).toContain('启动失败');
  });

  it('隐藏错误时恢复区域与状态颜色', () => {
    showLaunchError('失败');
    hideLaunchError();
    expect(document.getElementById('launch-error-section').style.display).toBe('none');
    expect(document.getElementById('launch-repair-guide').style.display).toBe('none');
    expect(document.getElementById('launch-splash-status').style.color).toBe('');
  });
});
