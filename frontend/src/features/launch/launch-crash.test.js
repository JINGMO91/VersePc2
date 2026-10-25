// @vitest-environment jsdom
// launch-crash.test.js — 崩溃分析弹窗渲染单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { showCrashAnalysisDialog } from './launch-crash.js';

const baseResult = {
  found: true,
  severity: 'high',
  reason: '游戏异常退出',
  solution: '更新显卡驱动',
  crashDescription: 'Exception in thread main',
  modName: 'example-mod',
  fixType: 'mod',
  logFile: 'logs/latest.log',
  logExcerpt: [
    { source: 'crash-report', line: 'java.lang.NullPointerException' },
    { source: 'launcher', line: 'launch failed' },
  ],
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('showCrashAnalysisDialog', () => {
  it('渲染崩溃原因、等级、解决方案与日志摘要', () => {
    showCrashAnalysisDialog(baseResult, '1.20.1');

    const overlay = document.getElementById('crash-analysis-dialog');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('游戏崩溃');
    expect(overlay.textContent).toContain('严重');
    expect(overlay.textContent).toContain('游戏异常退出');
    expect(overlay.textContent).toContain('更新显卡驱动');
    expect(overlay.textContent).toContain('example-mod');
    expect(overlay.textContent).toContain('NullPointerException');
    expect(overlay.textContent).toContain('崩溃报告');
  });

  it('关闭按钮与“知道了”都会移除弹窗', () => {
    showCrashAnalysisDialog(baseResult, '1.20.1');
    document.getElementById('crash-dialog-close').click();
    expect(document.getElementById('crash-analysis-dialog')).toBeNull();

    showCrashAnalysisDialog(baseResult, '1.20.1');
    document.getElementById('crash-dialog-ok').click();
    expect(document.getElementById('crash-analysis-dialog')).toBeNull();
  });

  it('重复打开会替换旧弹窗', () => {
    showCrashAnalysisDialog(baseResult, '1.20.1');
    showCrashAnalysisDialog({ ...baseResult, reason: '第二次崩溃' }, '1.20.1');
    expect(document.querySelectorAll('#crash-analysis-dialog').length).toBe(1);
    expect(document.getElementById('crash-analysis-dialog').textContent).toContain('第二次崩溃');
  });
});
