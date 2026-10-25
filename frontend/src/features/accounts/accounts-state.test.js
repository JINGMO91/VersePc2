// accounts-state.test.js — 账户共享状态契约单元测试
import { describe, expect, it } from 'vitest';
import { accountsState, getCurrentDetailAccount } from './accounts-state.js';

describe('accountsState', () => {
  it('提供详情账户读取入口', () => {
    const account = { id: 'steve', name: 'Steve' };
    accountsState._currentDetailAccount = account;
    expect(getCurrentDetailAccount()).toBe(account);
    accountsState._currentDetailAccount = null;
    expect(getCurrentDetailAccount()).toBeNull();
  });

  it('共享容器与默认值保持稳定', () => {
    expect(accountsState._skinFigureCache).toBeInstanceOf(Map);
    expect(accountsState._avatarMemCache).toBeInstanceOf(Map);
    expect(accountsState.ADD_CARD_ID).toBe('__ADD_ACCOUNT__');
    expect(accountsState._currentSkinBg).toBe('white');
  });
});
