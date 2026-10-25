// @vitest-environment jsdom
// lan-shared.test.js — 联机流程步骤切换单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { showLanStep } from './lan-shared.js';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="tc-host-panel">
      <div id="tc-host-step1"></div>
      <div id="tc-host-step2"></div>
      <div id="tc-host-step3"></div>
    </div>
  `;
});

describe('showLanStep', () => {
  it('只显示目标步骤并添加进入动画类', () => {
    showLanStep('tc', 'host', 2);

    expect(document.getElementById('tc-host-step1').style.display).toBe('none');
    expect(document.getElementById('tc-host-step2').style.display).toBe('');
    expect(document.getElementById('tc-host-step3').style.display).toBe('none');
    expect(document.getElementById('tc-host-step2').classList.contains('terracotta-step--enter')).toBe(true);
  });

  it('面板不存在时静默返回', () => {
    expect(() => showLanStep('missing', 'host', 1)).not.toThrow();
  });
});
