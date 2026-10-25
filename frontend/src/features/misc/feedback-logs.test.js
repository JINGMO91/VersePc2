// @vitest-environment jsdom
// feedback-logs.test.js — 自动日志收集、环境信息与日志渲染单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { escapeMock, sizeMock, bridgeMock, decodeMock } = vi.hoisted(() => ({
  escapeMock: vi.fn((value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')),
  sizeMock: vi.fn((size) => size + ' B'),
  bridgeMock: {
    readFileBuffer: vi.fn(),
    updater: { getVersion: vi.fn() },
  },
  decodeMock: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
}));

vi.mock('./feedback-attachments.js', () => ({
  escapeFeedbackText: escapeMock,
  formatFeedbackSize: sizeMock,
}));
vi.mock('../../core/tauri-bridge.js', () => ({ bridge: bridgeMock }));
vi.mock('../../core/utils.js', () => ({ decodeFileBuffer: decodeMock }));

let mod;
let feedbackState;
let API;

function buildDom() {
  document.body.innerHTML = `
    <div id="fb-auto-log-tip"></div>
    <div id="fb-auto-log-badge" hidden></div>
    <div id="fb-auto-log-list"></div>
    <div id="fb-env-list"></div>
  `;
}

function entry(name, overrides = {}) {
  return { name, path: 'D:/data/logs/' + name, modified: 1, isDirectory: false, ...overrides };
}

beforeAll(async () => {
  vi.resetModules();
  ({ feedbackState } = await import('./feedback-state.js'));
  ({ API } = await import('../../core/api.js'));
  mod = await import('./feedback-logs.js');
});

beforeEach(() => {
  buildDom();
  feedbackState.category = 'launch';
  feedbackState.autoLogs = [];
  feedbackState.env = null;
  feedbackState.envLoaded = false;
  escapeMock.mockClear();
  sizeMock.mockClear();
  decodeMock.mockClear();
  bridgeMock.readFileBuffer.mockReset();
  bridgeMock.readFileBuffer.mockResolvedValue(new Uint8Array([1, 2, 3]));
  bridgeMock.updater.getVersion.mockReset();
  bridgeMock.updater.getVersion.mockResolvedValue('0.5.0');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(API, 'getDataDir').mockResolvedValue({ dataDir: 'D:/data' });
  vi.spyOn(API, 'browseDirectory').mockResolvedValue({ items: [] });
  vi.spyOn(API, 'detectJava').mockResolvedValue({ javaList: [] });
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('collectAutoLogs', () => {
  it('其他分类无需收集日志', async () => {
    feedbackState.category = 'other';
    document.getElementById('fb-auto-log-badge').hidden = false;

    await mod.collectAutoLogs();

    expect(document.getElementById('fb-auto-log-tip').textContent).toContain('无需收集日志');
    expect(document.getElementById('fb-auto-log-tip').className).toContain('empty');
    expect(document.getElementById('fb-auto-log-badge').hidden).toBe(true);
    expect(API.getDataDir).not.toHaveBeenCalled();
  });

  it('数据目录缺失时提示失败', async () => {
    API.getDataDir.mockResolvedValue({});

    await mod.collectAutoLogs();

    expect(document.getElementById('fb-auto-log-tip').textContent).toBe('获取数据目录失败，无法自动收集日志');
  });

  it('按规则筛选、排序并读取日志', async () => {
    API.getDataDir.mockResolvedValue({ dataDir: 'D:/data/' });
    API.browseDirectory.mockResolvedValue({
      items: [
        entry('launch-debug.log', { modified: 5 }),
        entry('launch-fail-1.log', { modified: 9 }),
        entry('startup-timing.log', { modified: 1 }),
        entry('unrelated.txt', { modified: 99 }),
        entry('launch-debug.log', { isDirectory: true, modified: 100 }),
      ],
    });

    await mod.collectAutoLogs();

    expect(API.browseDirectory).toHaveBeenCalledWith('D:/data/logs', true);
    expect(feedbackState.autoLogs.map((item) => item.name)).toEqual([
      'launch-fail-1.log',
      'launch-debug.log',
      'startup-timing.log',
    ]);
    expect(feedbackState.autoLogs[0].file).toBeInstanceOf(File);
    expect(feedbackState.autoLogs[0].size).toBe(4);
    expect(feedbackState.autoLogs[0].auto).toBe(true);
    expect(document.getElementById('fb-auto-log-tip').textContent).toBe('已自动收集 3 个日志文件（不可移除，随反馈一并提交）');
    expect(document.getElementById('fb-auto-log-badge').hidden).toBe(false);
  });

  it('下载分类的 ends 规则生效', async () => {
    feedbackState.category = 'download';
    API.browseDirectory.mockResolvedValue({
      files: [
        entry('modpack-import.log'),
        entry('loader-install.log'),
        entry('abc.install'),
        entry('x.install.bak'),
      ],
    });

    await mod.collectAutoLogs();

    expect(feedbackState.autoLogs.map((item) => item.name)).toEqual([
      'modpack-import.log',
      'loader-install.log',
      'abc.install',
    ]);
  });

  it('兼容 folders 返回结构', async () => {
    API.browseDirectory.mockResolvedValue({ folders: [entry('launch-debug.log')] });

    await mod.collectAutoLogs();

    expect(feedbackState.autoLogs).toHaveLength(1);
  });

  it('最多收集八个日志', async () => {
    const items = Array.from({ length: 12 }, (_, i) => entry('launch-fail-' + i + '.log', { modified: i }));
    API.browseDirectory.mockResolvedValue({ items });

    await mod.collectAutoLogs();

    expect(feedbackState.autoLogs).toHaveLength(8);
  });

  it('无匹配日志时提示未找到', async () => {
    API.browseDirectory.mockResolvedValue({ items: [entry('other.txt')] });

    await mod.collectAutoLogs();

    expect(feedbackState.autoLogs).toEqual([]);
    expect(document.getElementById('fb-auto-log-tip').textContent).toBe('未在 data/logs 找到相关日志（可能尚未复现过问题）');
  });

  it('单个文件读取失败时跳过', async () => {
    API.browseDirectory.mockResolvedValue({ items: [entry('launch-debug.log'), entry('launch-fail-2.log')] });
    bridgeMock.readFileBuffer
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(new Uint8Array([1]));

    await mod.collectAutoLogs();

    expect(feedbackState.autoLogs.map((item) => item.name)).toEqual(['launch-fail-2.log']);
  });

  it('超过大小限制的文件跳过', async () => {
    API.browseDirectory.mockResolvedValue({ items: [entry('launch-debug.log')] });
    decodeMock.mockReturnValueOnce({ byteLength: 20 * 1024 * 1024 + 1 });

    await mod.collectAutoLogs();

    expect(feedbackState.autoLogs).toEqual([]);
  });

  it('扫描异常后最终展示未找到提示', async () => {
    API.getDataDir.mockRejectedValue(new Error('ipc down'));

    await mod.collectAutoLogs();

    expect(document.getElementById('fb-auto-log-tip').textContent).toBe('未在 data/logs 找到相关日志（可能尚未复现过问题）');
    expect(document.getElementById('fb-auto-log-tip').className).toContain('empty');
  });

  it('浏览接口无返回时按空列表处理', async () => {
    API.getDataDir.mockResolvedValue({ dataDir: 'D:/data' });
    API.browseDirectory.mockResolvedValue(undefined);

    await mod.collectAutoLogs();

    expect(feedbackState.autoLogs).toEqual([]);
  });

  it('提示与徽章缺失时仍完成收集', async () => {
    document.getElementById('fb-auto-log-tip').remove();
    document.getElementById('fb-auto-log-badge').remove();
    API.browseDirectory.mockResolvedValue({ items: [entry('launch-debug.log')] });

    await mod.collectAutoLogs();

    expect(feedbackState.autoLogs).toHaveLength(1);
  });
});

describe('readFeedbackFileAsBytes', () => {
  it('通过桥接读取并使用解码器', async () => {
    bridgeMock.readFileBuffer.mockResolvedValue([9, 8]);

    const bytes = await mod.readFeedbackFileAsBytes('D:/a.log');

    expect(bridgeMock.readFileBuffer).toHaveBeenCalledWith('D:/a.log');
    expect(decodeMock).toHaveBeenCalledWith([9, 8]);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it('桥接不可用时抛错', async () => {
    delete bridgeMock.readFileBuffer;

    await expect(mod.readFeedbackFileAsBytes('x')).rejects.toThrow('readFileBuffer unavailable');

    bridgeMock.readFileBuffer = vi.fn(async () => new Uint8Array([1]));
  });
});

describe('renderAutoLogFiles', () => {
  it('容器缺失时安全返回', () => {
    document.getElementById('fb-auto-log-list').remove();

    expect(() => mod.renderAutoLogFiles()).not.toThrow();
  });

  it('无日志时清空列表', () => {
    document.getElementById('fb-auto-log-list').innerHTML = 'old';

    mod.renderAutoLogFiles();

    expect(document.getElementById('fb-auto-log-list').innerHTML).toBe('');
  });

  it('渲染日志名称、标记与大小', () => {
    feedbackState.autoLogs = [{ name: 'a<b>.log', size: 2048, file: new File(['x'], 'a.log') }];

    mod.renderAutoLogFiles();

    const list = document.getElementById('fb-auto-log-list');
    expect(list.textContent).toContain('a<b>.log');
    expect(list.innerHTML).toContain('a&lt;b&gt;.log');
    expect(list.textContent).toContain('日志');
    expect(list.textContent).toContain('2048 B');
    expect(sizeMock).toHaveBeenCalledWith(2048);
  });
});

describe('loadFeedbackEnv', () => {
  it('已加载时直接渲染', async () => {
    feedbackState.envLoaded = true;
    feedbackState.env = { launcher: 'cached', system: 's', java: 'j' };

    await mod.loadFeedbackEnv();

    expect(bridgeMock.updater.getVersion).not.toHaveBeenCalled();
    expect(document.getElementById('fb-env-list').textContent).toContain('cached');
  });

  it('收集启动器、系统与 Java 信息', async () => {
    API.detectJava.mockResolvedValue({
      javaList: [
        { majorVersion: 8, version: '1.8.0', is64Bit: true, path: 'C:/java8' },
        { majorVersion: 17, version: '17.0.2', is64Bit: true, path: 'C:/java17' },
      ],
    });

    await mod.loadFeedbackEnv();

    expect(feedbackState.env).toEqual({
      launcher: 'VersePC2 0.5.0',
      system: 'Win32 · 64 位',
      java: 'Java 17.0.2 (64 位) · C:/java17',
    });
    expect(feedbackState.envLoaded).toBe(true);
    expect(document.getElementById('fb-env-list').textContent).toContain('Java 17.0.2');
  });

  it('无 17 以上版本时使用第一个', async () => {
    API.detectJava.mockResolvedValue({ javaList: [{ majorVersion: 8, version: '1.8', path: '' }] });

    await mod.loadFeedbackEnv();

    expect(feedbackState.env.java).toBe('Java 1.8');
  });

  it('没有 Java 时标记未检测到', async () => {
    API.detectJava.mockResolvedValue({ javaList: [] });

    await mod.loadFeedbackEnv();

    expect(feedbackState.env.java).toBe('未检测到');
  });

  it('各来源异常时保留未知值', async () => {
    bridgeMock.updater.getVersion.mockRejectedValue(new Error('no updater'));
    API.detectJava.mockRejectedValue(new Error('no java'));
    Object.defineProperty(navigator, 'platform', { value: '', configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'CustomAgent', configurable: true });

    await mod.loadFeedbackEnv();

    expect(feedbackState.env.launcher).toBe('未知');
    expect(feedbackState.env.system).toBe('CustomAgent');
    expect(feedbackState.env.java).toBe('未知');
  });

  it('桥接层无更新器时回退未知', async () => {
    const updater = bridgeMock.updater;
    delete bridgeMock.updater;

    await mod.loadFeedbackEnv();

    expect(feedbackState.env.launcher).toBe('未知');
    bridgeMock.updater = updater;
  });
});

describe('renderFeedbackEnv', () => {
  it('容器缺失时安全返回', () => {
    document.getElementById('fb-env-list').remove();

    expect(() => mod.renderFeedbackEnv()).not.toThrow();
  });

  it('尚未收集时展示加载文案', () => {
    feedbackState.env = null;

    mod.renderFeedbackEnv();

    expect(document.getElementById('fb-env-list').textContent).toContain('正在收集环境信息...');
  });

  it('渲染三行环境信息并转义', () => {
    feedbackState.env = { launcher: '<L>', system: 'S', java: 'J' };

    mod.renderFeedbackEnv();

    const list = document.getElementById('fb-env-list');
    expect(list.querySelectorAll('.fb-env-row')).toHaveLength(3);
    expect(list.textContent).toContain('<L>');
    expect(list.innerHTML).toContain('&lt;L&gt;');
    expect(escapeMock).toHaveBeenCalledWith('<L>');
  });
});
