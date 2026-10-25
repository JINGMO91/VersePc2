// @vitest-environment jsdom
// java.test.js — Java 安装弹窗、进度轮询、清理与主题色工具单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiCalls, installTauriMock, mockApiRoute } from '../../test-utils/tauri-mock.js';

let mod;
let appState;

function buildDom() {
  document.body.innerHTML = `
    <div id="toast-container"></div>
    <button id="java-install-btn"></button>
    <div id="java-install-progress" style="display:none"></div>
    <div id="java-source-list"></div>
    <div id="java-install-progress-bar"></div>
    <div id="java-progress-text"></div>
    <div id="java-progress-status"></div>
    <div id="java-progress-source"></div>
    <div id="java-progress-speed"></div>
    <div id="java-progress-size-text"></div>
    <div id="stat-java"></div>
    <input id="setting-java-path">
    <button id="cleanup-scan-btn"></button>
    <button id="cleanup-run-btn"></button>
    <div id="cleanup-size-info"></div>
    <div id="cleanup-details"></div>
  `;
}

beforeAll(async () => {
  installTauriMock();
  vi.resetModules();
  appState = (await import('../../core/app-state.js')).appState;
  mod = await import('./java.js');
});

beforeEach(() => {
  installTauriMock();
  buildDom();
  if (appState.javaInstallPollTimer) clearInterval(appState.javaInstallPollTimer);
  appState.javaInstallPollTimer = null;
  document.getElementById('java-install-modal')?.remove();
  document.documentElement.style.cssText = '';
  document.documentElement.className = '';
});

afterEach(() => {
  vi.useRealTimers();
  if (appState.javaInstallPollTimer) clearInterval(appState.javaInstallPollTimer);
  appState.javaInstallPollTimer = null;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('showJavaInstallModal / closeJavaInstallModal', () => {
  it('创建 Java 缺失提示弹窗并可重复替换', () => {
    mod.showJavaInstallModal(21);
    mod.showJavaInstallModal(17);

    const modals = document.querySelectorAll('#java-install-modal');
    expect(modals.length).toBe(1);
    expect(modals[0].textContent).toContain('未检测到 Java 17+');
    expect(document.body.contains(modals[0])).toBe(true);
  });

  it('关闭弹窗清理轮询并在动画后移除', async () => {
    vi.useFakeTimers();
    mod.showJavaInstallModal(21);
    appState.javaInstallPollTimer = setInterval(() => {}, 1000);

    mod.closeJavaInstallModal();

    expect(appState.javaInstallPollTimer).toBeNull();
    expect(document.getElementById('java-install-modal').classList.contains('modal-visible')).toBe(false);
    await vi.advanceTimersByTimeAsync(320);
    expect(document.getElementById('java-install-modal')).toBeNull();
  });
});

describe('下载源列表', () => {
  it('渲染下载源条目', async () => {
    mockApiRoute('/api/java/download-sources', {
      sources: [
        { id: 'official', name: '官方源', description: '官方 CDN' },
        { id: 'mirror', name: '国内镜像', description: '加速下载' },
      ],
    });

    await mod.loadJavaDownloadSources();

    const items = document.querySelectorAll('#java-source-list .java-source-item');
    expect(items.length).toBe(2);
    expect(items[0].dataset.source).toBe('official');
    expect(items[0].textContent).toContain('官方源');
    expect(items[1].textContent).toContain('国内镜像');
  });

  it('缺少列表容器时安全返回', async () => {
    document.getElementById('java-source-list').remove();
    mockApiRoute('/api/java/download-sources', { sources: [{ id: 'a', name: 'A' }] });
    await expect(mod.loadJavaDownloadSources()).resolves.toBeUndefined();
  });

  it('接口失败时记录错误', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApiRoute('/api/java/download-sources', { status: 500, body: {} });
    await mod.loadJavaDownloadSources();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('startJavaAutoInstall', () => {
  it('拿到会话后开始轮询', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/java/auto-install', { success: true, sessionId: 's1' });
    mockApiRoute('/api/java/install-status', { status: 'completed', progress: 100 });

    await mod.startJavaAutoInstall(21);

    expect(document.getElementById('java-install-btn').disabled).toBe(true);
    expect(document.getElementById('java-install-progress').style.display).toBe('block');
    expect(document.getElementById('java-source-list').style.display).toBe('none');
    expect(appState.javaInstallPollTimer).not.toBeNull();
  });

  it('请求失败时恢复按钮', async () => {
    mockApiRoute('/api/java/auto-install', { success: false });

    await mod.startJavaAutoInstall(21);

    expect(document.getElementById('java-install-btn').disabled).toBe(false);
    expect(document.getElementById('toast-container').textContent).toContain('Java检测请求失败');
  });

  it('请求异常时提示错误信息', async () => {
    mockApiRoute('/api/java/auto-install', { status: 500, body: { error: 'boom' } });

    await mod.startJavaAutoInstall(21);

    expect(document.getElementById('toast-container').textContent).toContain('Java检测请求失败');
    expect(document.getElementById('java-install-btn').disabled).toBe(false);
  });
});

describe('pollJavaInstallProgress', () => {
  it('下载中同步进度、来源、速度与体积', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/java/install-status', {
      status: 'downloading', progress: 35, message: '下载 JDK', source: 'mirror', speed: 2048,
      downloadedBytes: 1024 * 1024, totalBytes: 2 * 1024 * 1024,
    });

    mod.pollJavaInstallProgress('s1', 21);
    await vi.advanceTimersByTimeAsync(520);

    expect(document.getElementById('java-install-progress-bar').style.width).toBe('35%');
    expect(document.getElementById('java-progress-status').textContent).toBe('📥 下载中...');
    expect(document.getElementById('java-progress-text').textContent).toBe('下载 JDK');
    expect(document.getElementById('java-progress-source').textContent).toBe('来源: mirror');
    expect(document.getElementById('java-progress-speed').textContent).toContain('/s');
    expect(document.getElementById('java-progress-size-text').textContent).toBe('1.0 MB / 2.0 MB');
  });

  it('安装完成后写入统计与路径并关闭弹窗', async () => {
    vi.useFakeTimers();
    mod.showJavaInstallModal(21);
    mockApiRoute('/api/java/install-status', {
      status: 'completed', progress: 100, result: { majorVersion: 21, path: '/jdk21' },
    });

    mod.pollJavaInstallProgress('s1', 21);
    await vi.advanceTimersByTimeAsync(520);

    expect(document.getElementById('stat-java').textContent).toBe('21');
    expect(document.getElementById('setting-java-path').value).toBe('/jdk21');
    expect(document.getElementById('toast-container').textContent).toContain('Java 安装成功');
    expect(appState.javaInstallPollTimer).toBeNull();

    await vi.advanceTimersByTimeAsync(2200);
    expect(document.getElementById('java-install-modal')).toBeNull();
  });

  it('安装失败时提示并恢复按钮', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/java/install-status', { status: 'failed', message: '校验失败' });

    mod.pollJavaInstallProgress('s1', 21);
    await vi.advanceTimersByTimeAsync(520);

    expect(document.getElementById('toast-container').textContent).toContain('校验失败');
    expect(document.getElementById('java-install-btn').disabled).toBe(false);
    expect(appState.javaInstallPollTimer).toBeNull();
  });

  it('需要手动配置时给出警告', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/java/install-status', { status: 'need_manual', message: '请手动配置' });

    mod.pollJavaInstallProgress('s1', 21);
    await vi.advanceTimersByTimeAsync(520);

    expect(document.getElementById('toast-container').textContent).toContain('请手动配置');
    expect(document.getElementById('java-install-btn').disabled).toBe(false);
  });

  it('状态请求失败时停止轮询', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/java/install-status', { status: 500, body: {} });

    mod.pollJavaInstallProgress('s1', 21);
    await vi.advanceTimersByTimeAsync(520);

    expect(document.getElementById('toast-container').textContent).toContain('获取安装状态失败');
    expect(appState.javaInstallPollTimer).toBeNull();
    expect(document.getElementById('java-install-btn').disabled).toBe(false);
  });

  it('未知状态回退到后端消息', async () => {
    vi.useFakeTimers();
    mockApiRoute('/api/java/install-status', { status: 'configuring', progress: 80, message: '配置环境变量' });

    mod.pollJavaInstallProgress('s1', 21);
    await vi.advanceTimersByTimeAsync(520);

    expect(document.getElementById('java-progress-status').textContent).toBe('⚙️ 配置环境变量...');
    expect(document.getElementById('java-install-progress-bar').style.width).toBe('80%');
  });
});

describe('ensureJavaForLaunch', () => {
  it('已有合适 Java 时直接返回 true', async () => {
    mockApiRoute('/api/java/detect', { javaList: [{ majorVersion: 21 }] });
    await expect(mod.ensureJavaForLaunch(17)).resolves.toBe(true);
  });

  it('无合适 Java 时弹窗并在关闭后重新检测', async () => {
    vi.useFakeTimers();
    let count = 0;
    mockApiRoute('/api/java/detect', () => {
      count++;
      return count === 1 ? { javaList: [{ majorVersion: 8 }] } : { javaList: [{ majorVersion: 21 }] };
    });

    const promise = mod.ensureJavaForLaunch(17);
    await vi.advanceTimersByTimeAsync(10);
    expect(document.getElementById('java-install-modal')).toBeTruthy();

    document.getElementById('java-install-modal').remove();
    await vi.advanceTimersByTimeAsync(520);

    await expect(promise).resolves.toBe(true);
    expect(count).toBe(2);
  });

  it('关闭弹窗后仍无合适 Java 返回 false', async () => {
    vi.useFakeTimers();
    let count = 0;
    mockApiRoute('/api/java/detect', () => {
      count++;
      return { javaList: [{ majorVersion: 8 }] };
    });

    const promise = mod.ensureJavaForLaunch(17);
    await vi.advanceTimersByTimeAsync(10);
    document.getElementById('java-install-modal').remove();
    await vi.advanceTimersByTimeAsync(520);

    await expect(promise).resolves.toBe(false);
    expect(count).toBe(2);
  });

  it('检测接口异常返回 false', async () => {
    mockApiRoute('/api/java/detect', { status: 500, body: {} });
    await expect(mod.ensureJavaForLaunch(17)).resolves.toBe(false);
  });
});

describe('openFolder', () => {
  it('调用打开目录接口', async () => {
    await mod.openFolder('C:/logs');
    const call = getApiCalls().find((c) => c.path === '/api/open-folder');
    expect(call.args.body.folder).toBe('C:/logs');
  });

  it('打开失败时提示', async () => {
    mockApiRoute('/api/open-folder', { status: 500, body: {} });
    await mod.openFolder('C:/logs');
    expect(document.getElementById('toast-container').textContent).toContain('无法打开文件夹');
  });
});

describe('cleanupScan / cleanupRun', () => {
  const SCAN_RESULT = {
    success: true,
    totalMB: 12.5,
    totalBytes: 13 * 1024 * 1024,
    details: { gameLogs: 1024 * 1024, tempFiles: 0, natives: 2 * 1024 * 1024 },
  };

  it('扫描后展示可清理体积与明细', async () => {
    mockApiRoute('/api/cleanup/scan', SCAN_RESULT);

    await mod.cleanupScan();

    expect(document.getElementById('cleanup-size-info').textContent).toBe('可清理 12.5 MB');
    expect(document.getElementById('cleanup-run-btn').disabled).toBe(false);
    const details = document.getElementById('cleanup-details');
    expect(details.style.display).toBe('block');
    expect(details.textContent).toContain('游戏日志: 1 MB');
    expect(details.textContent).toContain('本地库缓存: 2 MB');
    expect(document.getElementById('cleanup-scan-btn').disabled).toBe(false);
  });

  it('没有可清理项时禁用清理按钮', async () => {
    mockApiRoute('/api/cleanup/scan', { success: true, totalMB: 0, totalBytes: 0, details: {} });

    await mod.cleanupScan();

    expect(document.getElementById('cleanup-details').textContent).toContain('暂无可清理的垃圾文件');
    expect(document.getElementById('cleanup-run-btn').disabled).toBe(true);
  });

  it('扫描返回失败时提示后端错误', async () => {
    mockApiRoute('/api/cleanup/scan', { success: false, error: '磁盘读取失败' });
    await mod.cleanupScan();
    expect(document.getElementById('toast-container').textContent).toContain('扫描失败: 磁盘读取失败');
  });

  it('扫描异常时提示并恢复按钮', async () => {
    mockApiRoute('/api/cleanup/scan', { status: 500, body: {} });
    const btn = document.getElementById('cleanup-scan-btn');
    btn.textContent = '扫描';

    await mod.cleanupScan();

    expect(document.getElementById('toast-container').textContent).toContain('扫描失败');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('扫描');
  });

  it('未扫描时直接清理给出提示', async () => {
    await mod.cleanupRun();
    expect(document.getElementById('toast-container').textContent).toContain('暂无可清理的内容');
  });

  it('清理成功后重置展示', async () => {
    mockApiRoute('/api/cleanup/scan', SCAN_RESULT);
    mockApiRoute('/api/cleanup', { success: true, message: '释放 12.5 MB' });
    await mod.cleanupScan();
    const details = document.getElementById('cleanup-details');
    details.style.display = 'block';

    await mod.cleanupRun();

    expect(document.getElementById('cleanup-size-info').textContent).toBe('已清理');
    expect(details.style.display).toBe('none');
    expect(details.innerHTML).toBe('');
    expect(document.getElementById('toast-container').textContent).toContain('释放 12.5 MB');
    expect(document.getElementById('cleanup-run-btn').textContent).toBe('一键清理');
  });

  it('清理返回失败时提示错误', async () => {
    mockApiRoute('/api/cleanup/scan', SCAN_RESULT);
    mockApiRoute('/api/cleanup', { success: false, error: '占用中' });
    await mod.cleanupScan();

    await mod.cleanupRun();

    expect(document.getElementById('toast-container').textContent).toContain('清理失败: 占用中');
  });

  it('清理异常时提示并恢复按钮', async () => {
    mockApiRoute('/api/cleanup/scan', SCAN_RESULT);
    mockApiRoute('/api/cleanup', { status: 500, body: {} });
    await mod.cleanupScan();

    await mod.cleanupRun();

    expect(document.getElementById('toast-container').textContent).toContain('清理失败');
    expect(document.getElementById('cleanup-run-btn').disabled).toBe(false);
    expect(document.getElementById('cleanup-run-btn').textContent).toBe('一键清理');
  });
});

describe('applyAccentColor', () => {
  it('忽略非法颜色值', () => {
    mod.applyAccentColor('red');
    mod.applyAccentColor('#fff');
    mod.applyAccentColor('');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
  });

  it('写入强调色派生变量并按亮度选择文字色', () => {
    document.documentElement.className = 'dark-theme';
    mod.applyAccentColor('#ff0000');

    const styles = document.documentElement.style;
    expect(styles.getPropertyValue('--accent')).toBe('#ff0000');
    expect(styles.getPropertyValue('--accent-glow')).toBe('rgba(255, 0, 0, 0.3)');
    expect(styles.getPropertyValue('--accent-rgb')).toBe('255, 0, 0');
    expect(styles.getPropertyValue('--accent-text')).toBe('#0a0a0a');
    expect(styles.getPropertyValue('--accent-hover')).toMatch(/^rgb\(/);
    expect(styles.getPropertyValue('--accent-ink')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('高亮度强调色使用深色文字', () => {
    mod.applyAccentColor('#ffff00');
    expect(document.documentElement.style.getPropertyValue('--accent-text')).toBe('#0a0a0a');
  });

  it('无暗色主题类时按浅色页面回退计算墨色', () => {
    mod.applyAccentColor('#00ff00');
    expect(document.documentElement.style.getPropertyValue('--accent-ink')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
