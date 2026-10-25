// @vitest-environment jsdom
// cloud.test.js — 云盘登录状态、登录成功/失败与退出单元测试
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTauriMock, resetTauriMock } from '../../test-utils/tauri-mock.js';

let cloud;

function mountCloud() {
  document.body.innerHTML = `
    <div id="cloud-login-card"></div>
    <div id="cloud-main" hidden></div>
    <button id="cloud-buy-btn"></button>
    <button id="cloud-redeem-btn"></button>
    <button id="cloud-refresh-btn"></button>
    <button id="cloud-logout-btn"></button>
    <input id="cloud-uid" />
    <input id="cloud-password" />
    <button id="cloud-login-btn"></button>
    <div id="cloud-login-hint"></div>
  `;
}

async function loadCloud(routes = {}) {
  installTauriMock({
    apiRoutes: {
      '/api/cloud/login': { status: 200, body: { ok: true, token: 'token-1', name: '玩家', uid: '1234' } },
      '/api/cloud/relay': { status: 500, body: { ok: false, msg: '概览不可用' } },
      ...routes,
    },
  });
  vi.resetModules();
  return import('./cloud.js');
}

beforeEach(() => {
  localStorage.clear();
  mountCloud();
});

afterEach(() => {
  resetTauriMock();
  delete window.__TAURI_INTERNALS__;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('cloudUpdateLoginState', () => {
  it('UID 至少 4 位且密码非空才启用登录按钮', async () => {
    cloud = await loadCloud();
    const uid = document.getElementById('cloud-uid');
    const password = document.getElementById('cloud-password');
    const button = document.getElementById('cloud-login-btn');

    cloud.cloudUpdateLoginState();
    expect(button.disabled).toBe(true);

    uid.value = '123';
    password.value = 'x';
    cloud.cloudUpdateLoginState();
    expect(button.disabled).toBe(true);

    uid.value = '1234';
    cloud.cloudUpdateLoginState();
    expect(button.disabled).toBe(false);
  });
});

describe('cloudLogin', () => {
  it('登录成功后写入本地存储并切换页面', async () => {
    cloud = await loadCloud();
    document.getElementById('cloud-uid').value = '1234';
    document.getElementById('cloud-password').value = 'pw';
    await cloud.cloudLogin();

    expect(localStorage.getItem('verse-cloud-token')).toBe('token-1');
    expect(localStorage.getItem('verse-cloud-name')).toBe('玩家');
    expect(localStorage.getItem('verse-cloud-uid')).toBe('1234');
    expect(document.getElementById('cloud-password').value).toBe('');
    expect(document.getElementById('cloud-login-card').hidden).toBe(true);
    expect(document.getElementById('cloud-main').hidden).toBe(false);
  });

  it('登录失败显示服务端提示', async () => {
    cloud = await loadCloud({
      '/api/cloud/login': { status: 401, body: { ok: false, msg: 'UID 或密码错误' } },
    });
    document.getElementById('cloud-uid').value = '1234';
    document.getElementById('cloud-password').value = 'bad';
    await cloud.cloudLogin();
    expect(document.getElementById('cloud-login-hint').textContent).toBe('UID 或密码错误');
    expect(localStorage.getItem('verse-cloud-token')).toBeNull();
  });

  it('缺少输入时直接返回', async () => {
    cloud = await loadCloud();
    await cloud.cloudLogin();
    expect(document.getElementById('cloud-login-hint').textContent).toBe('');
  });
});

describe('cloudLogout', () => {
  it('清除 token 并恢复登录卡片', async () => {
    cloud = await loadCloud();
    localStorage.setItem('verse-cloud-token', 'token-1');
    document.getElementById('cloud-login-card').hidden = true;
    document.getElementById('cloud-main').hidden = false;

    cloud.cloudLogout();
    expect(localStorage.getItem('verse-cloud-token')).toBeNull();
    expect(document.getElementById('cloud-login-card').hidden).toBe(false);
    expect(document.getElementById('cloud-main').hidden).toBe(true);
  });
});
