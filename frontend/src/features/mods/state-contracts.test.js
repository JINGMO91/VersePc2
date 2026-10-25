// state-contracts.test.js — 模组域共享状态默认值单元测试
import { describe, expect, it } from 'vitest';
import { modDetailState } from './detail-state.js';
import { S } from './install-state.js';
import { MOD_SLUG_MAP } from './mod-slug-map.js';

describe('install-state', () => {
  it('资源类型到目录名映射完整', () => {
    expect(S.resourceFolderMap).toEqual({
      resourcepack: 'resourcepacks',
      shader: 'shaderpacks',
      datapack: 'datapacks',
    });
    expect(S._mdSaveGame).toBe('');
    expect(S._mdSaveLoader).toBe('');
    expect(S._noFolderApp).toBeNull();
  });
});

describe('modDetailState', () => {
  it('详情数据与分页状态默认为空', () => {
    expect(modDetailState.data).toBeNull();
    expect(modDetailState.allVersions).toEqual([]);
    expect(modDetailState.type).toBe('mod');
    expect(modDetailState.seq).toBe(0);
    expect(modDetailState.renderedCount).toBe(0);
    expect(modDetailState.currentVersions).toEqual([]);
  });
});

describe('MOD_SLUG_MAP', () => {
  it('翻译数据缺失时保持空对象，可安全回退', () => {
    expect(MOD_SLUG_MAP).toBeTypeOf('object');
  });
});
