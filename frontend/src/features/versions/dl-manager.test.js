// @vitest-environment jsdom
// dl-manager.test.js — 下载任务状态机与列表渲染单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { clearCompletedDownloads, dlManager } from './custom-download.js';

beforeEach(() => {
  dlManager.tasks.clear();
  dlManager.order.length = 0;
  dlManager._searchQuery = '';
  document.body.innerHTML = '';
});

describe('任务增删', () => {
  it('重复 id 不会重复加入队列', () => {
    dlManager.add('t1', '任务一', 'mod', 's1', '');
    dlManager.add('t1', '任务一', 'mod', 's1', '');
    expect(dlManager.tasks.size).toBe(1);
    expect(dlManager.order).toEqual(['t1']);
  });

  it('remove 同时清理任务与顺序', () => {
    dlManager.add('t1', '任务一', 'mod', 's1', '');
    dlManager.remove('t1');
    expect(dlManager.tasks.size).toBe(0);
    expect(dlManager.order).toEqual([]);
  });

  it('clearCompletedDownloads 只清理终态任务', () => {
    dlManager.add('done', '完成', 'mod', '', '');
    dlManager.add('failed', '失败', 'mod', '', '');
    dlManager.add('running', '进行中', 'mod', '', '');

    dlManager.update('done', { status: 'completed' });
    dlManager.update('failed', { status: 'failed' });
    clearCompletedDownloads();

    expect([...dlManager.tasks.keys()]).toEqual(['running']);
  });
});

describe('进度更新', () => {
  it('completed 固定为 100，failed 保留当前进度', () => {
    dlManager.add('t1', '任务', 'mod', '', '');
    dlManager.update('t1', { progress: 40, status: 'completed' });
    expect(dlManager.tasks.get('t1').progress).toBe(100);

    dlManager.add('t2', '任务二', 'mod', '', '');
    dlManager.update('t2', { progress: 35, status: 'failed' });
    expect(dlManager.tasks.get('t2').progress).toBe(35);
  });

  it('进度不会超过 100', () => {
    dlManager.add('t1', '任务', 'mod', '', '');
    dlManager.update('t1', { progress: 180, status: 'downloading' });
    expect(dlManager.tasks.get('t1').progress).toBe(100);
  });

  it('整合包进度做平滑处理并保持单调', () => {
    dlManager.add('mp', '整合包', 'modpack', '', '');
    dlManager.update('mp', { progress: 50, status: 'downloading' });
    expect(dlManager.tasks.get('mp').progress).toBe(50);

    dlManager.update('mp', { progress: 80, status: 'downloading' });
    const smoothed = dlManager.tasks.get('mp').progress;
    expect(smoothed).toBeGreaterThan(50);
    expect(smoothed).toBeLessThanOrEqual(80);
  });
});

describe('搜索过滤', () => {
  it('按名称过滤渲染结果', () => {
    const list = document.createElement('div');
    list.id = 'download-queue-list';
    document.body.appendChild(list);

    dlManager.add('a', 'Sodium Mod', 'mod', '', '');
    dlManager.add('b', 'Iris Shader', 'mod', '', '');
    dlManager.applySearch('sodium');

    expect(list.textContent).toContain('Sodium Mod');
    expect(list.textContent).not.toContain('Iris Shader');
  });

  it('无匹配时显示空提示', () => {
    const list = document.createElement('div');
    list.id = 'download-queue-list';
    document.body.appendChild(list);

    dlManager.add('a', 'Sodium', 'mod', '', '');
    dlManager.applySearch('not-found');
    expect(list.textContent).toContain('没有匹配的下载任务');
  });
});
