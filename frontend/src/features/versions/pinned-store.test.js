// @vitest-environment jsdom
// pinned-store.test.js — 置顶面板持久化与切换单元测试
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function loadStore(initial) {
  vi.resetModules();
  localStorage.clear();
  if (initial !== undefined) {
    localStorage.setItem('versepc_pinned', JSON.stringify(initial));
  }
  return import('./pinned-store.js');
}

describe('初始数据', () => {
  it('从 localStorage 恢复数组', async () => {
    const mod = await loadStore([{ type: 'version', id: '1.20.1', name: '1.20.1', extra: {} }]);
    expect(mod.pinnedStore.items).toHaveLength(1);
    expect(mod.isPinned('version', '1.20.1')).toBe(true);
  });

  it('非法 JSON 回退为空数组', async () => {
    vi.resetModules();
    localStorage.setItem('versepc_pinned', '{bad json');
    const mod = await import('./pinned-store.js');
    expect(mod.pinnedStore.items).toEqual([]);
  });
});

describe('置顶切换', () => {
  it('未置顶时插入到最前并写入 localStorage', async () => {
    const mod = await loadStore([]);
    mod.togglePinVersion('1.20.1', '1.20.1', 'Forge');
    mod.togglePinSave('world', '存档 A', '1.20.1', 'icon.png', '普通');

    expect(mod.pinnedStore.items.map((item) => item.id)).toEqual(['world', '1.20.1']);
    expect(JSON.parse(localStorage.getItem('versepc_pinned'))).toHaveLength(2);
  });

  it('再次切换移除同一项', async () => {
    const mod = await loadStore([
      { type: 'version', id: '1.20.1', name: '1.20.1', extra: {} },
    ]);
    expect(mod.togglePinVersion('1.20.1', '1.20.1', 'Forge')).toBe(false);
    expect(mod.pinnedStore.items).toEqual([]);
    expect(JSON.parse(localStorage.getItem('versepc_pinned'))).toEqual([]);
  });

  it('removePinned 返回是否删除成功', async () => {
    const mod = await loadStore([{ type: 'mod', id: 'sodium', name: 'Sodium', extra: {} }]);
    expect(mod.removePinned('mod', 'sodium')).toBe(true);
    expect(mod.removePinned('mod', 'sodium')).toBe(false);
  });

  it('项目置顶写入 source 与 icon', async () => {
    const mod = await loadStore([]);
    mod.togglePinProject('shader', 'bsl', 'BSL', 'modrinth', 'https://x/icon.png');
    expect(mod.pinnedStore.items[0].extra).toEqual({
      projectId: 'bsl',
      source: 'modrinth',
      icon: 'https://x/icon.png',
    });
  });
});
