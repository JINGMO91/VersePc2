// @vitest-environment jsdom
// dynamic-island-view.test.js — V 岛视图纯函数单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { S } from './dynamic-island-state.js';
import {
  _buildFilesHtml,
  _buildStageHistoryHtml,
  _esc,
  _fmtSpeed,
  _getActiveTaskCount,
  _getTotalProgress,
} from './dynamic-island-view.js';

beforeEach(() => {
  S._tasks = {};
});

describe('_esc / _fmtSpeed', () => {
  it('转义 HTML 特殊字符', () => {
    expect(_esc('<a>&"')).toBe('&lt;a&gt;&amp;&quot;');
    expect(_esc('')).toBe('');
  });

  it('速度按 KB/MB 格式化，0 返回空串', () => {
    expect(_fmtSpeed(0)).toBe('');
    expect(_fmtSpeed(512)).toBe('1 KB/s');
    expect(_fmtSpeed(2 * 1024 * 1024)).toBe('2.0 MB/s');
  });
});

describe('任务统计', () => {
  it('统计下载中任务与总进度', () => {
    S._tasks = {
      a: { status: 'downloading', progress: 50 },
      b: { status: 'completed', progress: 100 },
      c: { status: 'failed', progress: 10 },
    };
    expect(_getActiveTaskCount()).toBe(1);
    expect(_getTotalProgress()).toBe(75);
  });

  it('空任务与非法进度有兜底', () => {
    expect(_getActiveTaskCount()).toBe(0);
    expect(_getTotalProgress()).toBe(0);
    S._tasks = { a: { status: 'downloading', progress: 500 } };
    expect(_getTotalProgress()).toBe(100);
  });
});

describe('HTML 片段', () => {
  it('文件列表最多显示 8 个并提示剩余数量', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      name: `f${i}.jar`,
      status: i === 0 ? 'completed' : 'downloading',
      progress: i * 10,
    }));
    const html = _buildFilesHtml(files);
    expect(html).toContain('f0.jar');
    expect(html).toContain('还有 2 个文件');
    expect(html).not.toContain('f8.jar');
  });

  it('阶段列表按进度添加完成/进行中样式', () => {
    const html = _buildStageHistoryHtml([
      { stage: 'download', progress: 100 },
      { stage: 'install', progress: 40 },
    ]);
    expect(html).toContain('v-island__stage-dot--done');
    expect(html).toContain('v-island__stage-dot--active');
    expect(html).toContain('40%');
  });

  it('空列表返回空串', () => {
    expect(_buildFilesHtml([])).toBe('');
    expect(_buildStageHistoryHtml([])).toBe('');
  });
});
