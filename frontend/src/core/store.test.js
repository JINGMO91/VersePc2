// @vitest-environment jsdom
// core/store.test.js — 设置存储薄封装单元测试
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getCommandCalls, installTauriMock } from '../test-utils/tauri-mock.js';

let store;

beforeAll(async () => {
  installTauriMock({ commands: {
    store_get: ({ key }) => ({ key, value: 1 }),
    store_set: ({ key, value }) => ({ key, value }),
    store_delete: ({ key }) => ({ key }),
  } });
  vi.resetModules();
  ({ store } = await import('./store.js'));
});

describe('store', () => {
  it('get 透传 key', async () => {
    await expect(store.get('theme')).resolves.toEqual({ key: 'theme', value: 1 });
    expect(getCommandCalls().at(-1)).toMatchObject({ cmd: 'store_get', args: { key: 'theme' } });
  });

  it('set 透传 key 与 value', async () => {
    await expect(store.set('theme', 'dark')).resolves.toEqual({ key: 'theme', value: 'dark' });
    expect(getCommandCalls().at(-1)).toMatchObject({ cmd: 'store_set', args: { key: 'theme', value: 'dark' } });
  });

  it('delete 透传 key', async () => {
    await expect(store.delete('theme')).resolves.toEqual({ key: 'theme' });
    expect(getCommandCalls().at(-1)).toMatchObject({ cmd: 'store_delete', args: { key: 'theme' } });
  });
});
