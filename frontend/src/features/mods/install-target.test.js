// @vitest-environment jsdom
// install-target.test.js — 模组目标版本解析单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { modDetailState } from './detail-state.js';
import { resolveModTarget, resolveModVersionTarget } from './install-target.js';

beforeEach(() => {
  modDetailState.allVersions = [];
});

describe('resolveModTarget', () => {
  it('从游戏版本与加载器列表提取目标', () => {
    expect(resolveModTarget(['1.20.1', 'fabric'], ['Fabric'])).toEqual({
      game: '1.20.1',
      loader: 'fabric',
    });
  });

  it('加载器字段缺失时从游戏版本列表识别', () => {
    expect(resolveModTarget(['1.20.1', 'forge'], [])).toEqual({
      game: '1.20.1',
      loader: 'forge',
    });
  });

  it('没有合法游戏版本时返回空游戏版本', () => {
    expect(resolveModTarget(['snapshot', 'fabric'], ['quilt'])).toEqual({
      game: '',
      loader: 'quilt',
    });
  });
});

describe('resolveModVersionTarget', () => {
  it('按版本 id 查找并解析目标', () => {
    modDetailState.allVersions = [
      { id: 'v1', gameVersions: ['1.21.1'], loaders: ['neoforge'] },
    ];
    expect(resolveModVersionTarget('v1')).toEqual({ game: '1.21.1', loader: 'neoforge' });
  });

  it('版本不存在时返回空目标', () => {
    expect(resolveModVersionTarget('missing')).toEqual({ game: '', loader: '' });
  });
});
