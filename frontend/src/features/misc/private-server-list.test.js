// @vitest-environment jsdom
// private-server-list.test.js — 私服状态与入驻横幅 HTML 单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import { getJoinBannerHtml, getPrivateServerStatusHtml } from './private-server-list.js';
import { S } from './private-server-state.js';

beforeEach(() => {
  S.privateServerCheckCache = {};
});

describe('getPrivateServerStatusHtml', () => {
  it('无缓存时显示检测中', () => {
    expect(getPrivateServerStatusHtml({ id: 'a' })).toContain('检测中');
  });

  it('在线时显示人数与延迟', () => {
    S.privateServerCheckCache.a = { online: true, playersOnline: 3, playersMax: 20, latency: 45 };
    const html = getPrivateServerStatusHtml({ id: 'a' });
    expect(html).toContain('在线');
    expect(html).toContain('3/20');
    expect(html).toContain('45ms');
    expect(html).toContain('ps-status-dot online');
  });

  it('离线时显示离线样式', () => {
    S.privateServerCheckCache.a = { online: false };
    expect(getPrivateServerStatusHtml({ id: 'a' })).toContain('离线');
  });
});

describe('getJoinBannerHtml', () => {
  it('包含入驻链接与外部打开动作', () => {
    const html = getJoinBannerHtml();
    expect(html).toContain('ps-join-banner');
    expect(html).toContain('data-action="openExternal"');
    expect(html).toContain('afdian.com/a/versejava');
  });
});
