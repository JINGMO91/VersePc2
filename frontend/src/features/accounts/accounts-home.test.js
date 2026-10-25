// @vitest-environment jsdom
// accounts-home.test.js — 首页联机状态面板、下载与启停编排单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiCalls, installTauriMock, mockApiRoute, mockCommand } from '../../test-utils/tauri-mock.js';

let mod;
let S;

function buildDom() {
  document.body.innerHTML = `
    <div id="acc-hero-badge"><span id="acc-badge-text"></span></div>
    <div id="acc-hero-desc"></div>
    <div id="acc-install-panel"><button id="acc-download-btn"></button><div id="acc-download-progress" style="display:none"></div></div>
    <div id="acc-control-panel"></div>
    <div id="acc-join-panel"><input id="acc-join-code"><button class="btn-primary"></button></div>
    <div id="acc-peers-panel"></div>
    <div id="acc-status-grid"></div>
    <div id="acc-config-section"></div>
    <button id="acc-start-btn"></button>
    <button id="acc-stop-btn"></button>
    <input id="acc-game-port" value="25570">
    <div id="acc-status-mode"></div>
    <div id="acc-status-ip"></div>
    <div id="acc-status-peers"></div>
    <div id="acc-status-port"></div>
    <div id="acc-card-invitation"></div>
    <div id="acc-card-connect"></div>
    <div id="acc-status-invitation"></div>
    <div id="acc-status-connect"></div>
    <div id="acc-progress-fill"></div>
    <div id="acc-progress-pct"></div>
    <div id="acc-progress-status"></div>
    <div id="acc-progress-msg"></div>
    <div id="toast-container"></div>
  `;
}

beforeAll(async () => {
  installTauriMock();
  vi.resetModules();
  S = (await import('./accounts-state.js')).accountsState;
  mod = await import('./accounts-home.js');
});

beforeEach(() => {
  installTauriMock();
  buildDom();
  S.accPollTimer = null;
  S.accDlPollTimer = null;
  S.accDlSessionId = null;
});

afterEach(() => {
  if (S.accPollTimer) clearInterval(S.accPollTimer);
  if (S.accDlPollTimer) clearInterval(S.accDlPollTimer);
  S.accPollTimer = null;
  S.accDlPollTimer = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('accUpdateHeroBadge', () => {
  it('更新徽章样式与文案', () => {
    mod.accUpdateHeroBadge('running', '运行中');
    const badge = document.getElementById('acc-hero-badge');
    expect(badge.className).toBe('acc-hero-status-badge running');
    expect(document.getElementById('acc-badge-text').textContent).toBe('运行中');
  });

  it('徽章元素缺失时安全返回', () => {
    document.getElementById('acc-hero-badge').remove();
    expect(() => mod.accUpdateHeroBadge('installed', '已就绪')).not.toThrow();
  });
});

describe('accLoadStatus', () => {
  it('未安装时展示安装入口', async () => {
    mockApiRoute('/api/easytier/status', { running: false, installed: false });

    await mod.accLoadStatus();

    expect(document.getElementById('acc-install-panel').style.display).toBe('');
    expect(document.getElementById('acc-control-panel').style.display).toBe('none');
    expect(document.getElementById('acc-join-panel').style.display).toBe('none');
    expect(document.getElementById('acc-download-btn').style.display).toBe('');
    expect(document.getElementById('acc-hero-badge').classList.contains('installed')).toBe(false);
    expect(document.getElementById('acc-badge-text').textContent).toBe('未安装');
  });

  it('已安装时展示控台并隐藏下载按钮', async () => {
    mockApiRoute('/api/easytier/status', { running: false, installed: true });

    await mod.accLoadStatus();

    expect(document.getElementById('acc-control-panel').style.display).toBe('');
    expect(document.getElementById('acc-join-panel').style.display).toBe('');
    expect(document.getElementById('acc-peers-panel').style.display).toBe('none');
    expect(document.getElementById('acc-download-btn').style.display).toBe('none');
    expect(document.getElementById('acc-hero-badge').classList.contains('installed')).toBe(true);
    expect(document.getElementById('acc-badge-text').textContent).toBe('已就绪');
  });

  it('下载中时标记下载状态', async () => {
    mockApiRoute('/api/easytier/status', { running: false, installed: false, downloading: true });

    await mod.accLoadStatus();

    expect(document.getElementById('acc-install-panel').style.display).toBe('none');
    expect(document.getElementById('acc-control-panel').style.display).toBe('');
    expect(document.getElementById('acc-badge-text').textContent).toBe('下载中...');
  });

  it('主机运行中展示房间码并启动轮询', async () => {
    mockApiRoute('/api/easytier/status', {
      running: true,
      mode: 'host',
      virtualIP: '10.1.1.2',
      gamePort: 25566,
      roomCode: 'ABC123',
    });

    await mod.accLoadStatus();

    expect(document.getElementById('acc-control-panel').style.display).toBe('');
    expect(document.getElementById('acc-peers-panel').style.display).toBe('');
    expect(document.getElementById('acc-status-mode').textContent).toBe('主机模式');
    expect(document.getElementById('acc-status-ip').textContent).toBe('10.1.1.2');
    expect(document.getElementById('acc-status-port').textContent).toBe('25566');
    expect(document.getElementById('acc-card-invitation').style.display).toBe('');
    expect(document.getElementById('acc-card-connect').style.display).toBe('none');
    expect(document.getElementById('acc-status-invitation').textContent).toBe('ABC123');
    expect(document.getElementById('acc-hero-badge').classList.contains('running')).toBe(true);
    expect(S.accPollTimer).not.toBeNull();
  });

  it('客户端模式使用 state.url 并展示连接地址', async () => {
    mockApiRoute('/api/easytier/status', {
      running: true,
      mode: 'client',
      state: { state: 'guest-ok', url: '10.9.9.9:25565' },
    });

    await mod.accLoadStatus();

    expect(document.getElementById('acc-status-mode').textContent).toBe('客户端模式');
    expect(document.getElementById('acc-status-connect').textContent).toBe('10.9.9.9:25565');
    expect(document.getElementById('acc-status-ip').textContent).toBe('10.9.9.9:25565');
    expect(document.getElementById('acc-status-peers').textContent).toBe('1');
    expect(document.getElementById('acc-card-connect').style.display).toBe('');
  });

  it('host-ok 状态对象使用房间码并更新节点数', async () => {
    mockApiRoute('/api/easytier/status', {
      running: true,
      mode: 'host',
      state: { state: 'host-ok', room: { code: 'ROOM42' } },
    });

    await mod.accLoadStatus();

    expect(document.getElementById('acc-status-invitation').textContent).toBe('ROOM42');
    expect(document.getElementById('acc-status-peers').textContent).toBe('1');
  });

  it('接口失败时记录错误', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApiRoute('/api/easytier/status', { status: 500, body: { error: 'boom' } });

    await expect(mod.accLoadStatus()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('accRefreshStatus', () => {
  it('运行停止时清理定时器并重新加载状态', async () => {
    S.accPollTimer = setInterval(() => {}, 60000);
    mockApiRoute('/api/easytier/status', { running: false, installed: true });

    await mod.accRefreshStatus();

    expect(S.accPollTimer).toBeNull();
    expect(getApiCalls().filter((c) => c.path === '/api/easytier/status').length).toBe(2);
  });

  it('根据 host-ok 与 guest-ok 更新房间信息', async () => {
    mockApiRoute('/api/easytier/status', { running: true, state: { state: 'host-ok', room: 'HOST-1' } });
    mockApiRoute('/api/easytier/peers', { state: { state: 'guest-ok', url: '10.0.0.8:25565' } });

    await mod.accRefreshStatus();

    expect(document.getElementById('acc-status-invitation').textContent).toBe('HOST-1');
    expect(document.getElementById('acc-status-peers').textContent).toBe('1');
    expect(document.getElementById('acc-status-connect').textContent).toBe('10.0.0.8:25565');
    expect(document.getElementById('acc-status-ip').textContent).toBe('10.0.0.8:25565');
  });

  it('进行中状态显示省略号、异常显示感叹号', async () => {
    mockApiRoute('/api/easytier/status', { running: true, state: { state: 'guest-connecting' } });
    mockApiRoute('/api/easytier/peers', {});
    await mod.accRefreshStatus();
    expect(document.getElementById('acc-status-peers').textContent).toBe('...');

    mockApiRoute('/api/easytier/status', { running: true, state: { state: 'exception' } });
    await mod.accRefreshStatus();
    expect(document.getElementById('acc-status-peers').textContent).toBe('!');
  });

  it('接口失败时记录错误', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApiRoute('/api/easytier/status', { status: 500, body: {} });
    await expect(mod.accRefreshStatus()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('accDownload', () => {
  it('轮询到完成后提示并刷新状态', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/easytier/download', { sessionId: 's1' });
    mockApiRoute('/api/easytier/download-status', { progress: 100, status: 'completed', message: 'done' });
    mockApiRoute('/api/easytier/status', { running: false, installed: true });

    await mod.accDownload();
    expect(S.accDlSessionId).toBe('s1');
    expect(document.getElementById('acc-download-progress').style.display).toBe('');

    await vi.advanceTimersByTimeAsync(500);

    expect(document.getElementById('acc-progress-fill').style.width).toBe('100%');
    expect(document.getElementById('acc-progress-pct').textContent).toBe('100%');
    expect(document.getElementById('acc-progress-msg').textContent).toBe('done');
    expect(document.getElementById('toast-container').textContent).toContain('陶瓦联机安装完成');
    expect(S.accDlPollTimer).toBeNull();
  });

  it('下载失败时恢复按钮', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/easytier/download', { sessionId: 's2' });
    mockApiRoute('/api/easytier/download-status', { progress: 12, status: 'error', message: '网络错误' });

    await mod.accDownload();
    await vi.advanceTimersByTimeAsync(500);

    const btn = document.getElementById('acc-download-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.innerHTML).toContain('重新下载');
    expect(document.getElementById('toast-container').textContent).toContain('安装失败: 网络错误');
  });

  it('启动下载失败时提示并恢复按钮', async () => {
    mockApiRoute('/api/easytier/download', { status: 500, body: { error: 'offline' } });

    await mod.accDownload();

    const btn = document.getElementById('acc-download-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('下载并安装');
    expect(document.getElementById('toast-container').textContent).toContain('启动下载失败');
  });
});

describe('accStartHost', () => {
  it('启动主机后写入运行状态并开始轮询', async () => {
    mockApiRoute('/api/easytier/host', {});

    await mod.accStartHost();

    const call = getApiCalls().find((c) => c.path === '/api/easytier/host');
    expect(call.args.body.gamePort).toBe(25570);
    expect(document.getElementById('acc-status-mode').textContent).toBe('主机模式');
    expect(document.getElementById('acc-status-port').textContent).toBe('25570');
    expect(document.getElementById('acc-status-invitation').textContent).toBe('等待分配...');
    expect(document.getElementById('acc-start-btn').disabled).toBe(true);
    expect(document.getElementById('acc-stop-btn').style.display).toBe('');
    expect(document.getElementById('acc-hero-badge').classList.contains('running')).toBe(true);
    expect(S.accPollTimer).not.toBeNull();
    expect(document.getElementById('toast-container').textContent).toContain('陶瓦联机已启动');
  });

  it('端口非法时回退默认端口', async () => {
    document.getElementById('acc-game-port').value = 'abc';
    mockApiRoute('/api/easytier/host', {});

    await mod.accStartHost();

    const call = getApiCalls().find((c) => c.path === '/api/easytier/host');
    expect(call.args.body.gamePort).toBe(25565);
  });

  it('启动失败时恢复按钮', async () => {
    mockApiRoute('/api/easytier/host', { status: 500, body: { error: 'denied' } });

    await mod.accStartHost();

    const btn = document.getElementById('acc-start-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.innerHTML).toContain('启动加速');
    expect(document.getElementById('toast-container').textContent).toContain('启动失败');
  });
});

describe('accJoin', () => {
  it('房间码为空时提示错误且不请求接口', async () => {
    document.getElementById('acc-join-code').value = '   ';

    await mod.accJoin();

    expect(document.getElementById('toast-container').textContent).toContain('请输入房间码');
    expect(getApiCalls().some((c) => c.path === '/api/easytier/guest')).toBe(false);
  });

  it('加入成功后切换到客户端控制面板', async () => {
    document.getElementById('acc-join-code').value = 'ROOM-1';
    mockApiRoute('/api/easytier/guest', {});

    await mod.accJoin();

    const call = getApiCalls().find((c) => c.path === '/api/easytier/guest');
    expect(call.args.body.roomCode).toBe('ROOM-1');
    expect(document.getElementById('acc-status-mode').textContent).toBe('客户端模式');
    expect(document.getElementById('acc-status-connect').textContent).toBe('等待分配...');
    expect(document.getElementById('acc-card-connect').style.display).toBe('');
    expect(document.getElementById('acc-install-panel').style.display).toBe('none');
    expect(document.getElementById('acc-stop-btn').style.display).toBe('');
    expect(S.accPollTimer).not.toBeNull();
    expect(document.getElementById('toast-container').textContent).toContain('已加入联机网络');
  });

  it('加入失败时恢复按钮并提示', async () => {
    document.getElementById('acc-join-code').value = 'ROOM-2';
    mockApiRoute('/api/easytier/guest', { status: 500, body: { error: 'expired' } });

    await mod.accJoin();

    const joinBtn = document.querySelector('#acc-join-panel .btn-primary');
    expect(joinBtn.disabled).toBe(false);
    expect(joinBtn.innerHTML).toContain('加入联机网络');
    expect(document.getElementById('toast-container').textContent).toContain('加入失败');
  });
});

describe('accStop / accCopy', () => {
  it('停止后清理轮询并刷新状态', async () => {
    S.accPollTimer = setInterval(() => {}, 60000);
    mockApiRoute('/api/easytier/stop', {});
    mockApiRoute('/api/easytier/status', { running: false, installed: true });

    await mod.accStop();

    expect(S.accPollTimer).toBeNull();
    expect(getApiCalls().some((c) => c.path === '/api/easytier/stop')).toBe(true);
    expect(document.getElementById('toast-container').textContent).toContain('加速器已停止');
    expect(getApiCalls().some((c) => c.path === '/api/easytier/status')).toBe(true);
  });

  it('复制有效房间码', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    document.getElementById('acc-status-invitation').textContent = 'ABC123';

    mod.accCopyInvitation();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('ABC123');
    await vi.waitFor(() => {
      expect(document.getElementById('toast-container').textContent).toContain('房间码已复制');
    });
  });

  it('占位房间码不触发复制', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    document.getElementById('acc-status-invitation').textContent = '等待分配...';

    mod.accCopyInvitation();

    expect(writeText).not.toHaveBeenCalled();
  });

  it('复制有效连接地址', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    document.getElementById('acc-status-connect').textContent = '10.0.0.8:25565';

    mod.accCopyConnect();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('10.0.0.8:25565');
    await vi.waitFor(() => {
      expect(document.getElementById('toast-container').textContent).toContain('连接地址已复制');
    });
  });
});

describe('loadSettingsFromLocal / 模组操作', () => {
  it('解析本地 JSON 设置', async () => {
    mockCommand('store_get', () => JSON.stringify({ theme: 'dark' }));
    expect(await mod.loadSettingsFromLocal()).toEqual({ theme: 'dark' });
  });

  it('设置缺失或损坏时返回 null', async () => {
    mockCommand('store_get', () => null);
    expect(await mod.loadSettingsFromLocal()).toBeNull();
    mockCommand('store_get', () => '{bad json');
    expect(await mod.loadSettingsFromLocal()).toBeNull();
  });

  it('启用模组成功后提示', async () => {
    mockApiRoute('/api/mods/toggle', {});

    await mod.toggleMod('m1', true);

    const call = getApiCalls().find((c) => c.path === '/api/mods/toggle');
    expect(call.args.body.modId).toBe('m1');
    expect(call.args.body.enabled).toBe(true);
    expect(document.getElementById('toast-container').textContent).toContain('模组已启用');
  });

  it('启用模组失败时提示失败', async () => {
    mockApiRoute('/api/mods/toggle', { status: 500, body: {} });

    await mod.toggleMod('m1', true);

    expect(document.getElementById('toast-container').textContent).toContain('操作失败');
  });

  it('确认删除模组后调用接口', async () => {
    mockApiRoute('/api/mods/delete', {});

    const pending = mod.deleteMod('m1');
    await vi.waitFor(() => {
      expect(document.querySelector('.confirm-ok')).toBeTruthy();
    });
    document.querySelector('.confirm-ok').click();
    await pending;

    const call = getApiCalls().find((c) => c.path === '/api/mods/delete');
    expect(call.args.body.modId).toBe('m1');
    await vi.waitFor(() => {
      expect(document.getElementById('toast-container').textContent).toContain('模组已删除');
    });
  });

  it('取消删除模组时不调用接口', async () => {
    const pending = mod.deleteMod('m1');
    await vi.waitFor(() => {
      expect(document.querySelector('.confirm-cancel')).toBeTruthy();
    });
    document.querySelector('.confirm-cancel').click();
    await pending;

    expect(getApiCalls().some((c) => c.path === '/api/mods/delete')).toBe(false);
  });

  it('删除模组失败时提示失败', async () => {
    mockApiRoute('/api/mods/delete', { status: 500, body: {} });

    const pending = mod.deleteMod('m1');
    await vi.waitFor(() => {
      expect(document.querySelector('.confirm-ok')).toBeTruthy();
    });
    document.querySelector('.confirm-ok').click();
    await pending;

    expect(document.getElementById('toast-container').textContent).toContain('删除失败');
  });
});
