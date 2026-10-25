// @vitest-environment jsdom
// vset-translate.test.js — 模组汉化弹窗、批量翻译与语言文件导入导出单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTauriMock } from '../../test-utils/tauri-mock.js';

const { toast, showModal, switchTranslateTab } = vi.hoisted(() => ({
  toast: vi.fn(),
  showModal: vi.fn(),
  switchTranslateTab: vi.fn(),
}));

vi.mock('../misc/ui-components.js', () => ({ showToast: toast, showModal }));
vi.mock('../misc/translate-modal-tabs.js', () => ({ switchTranslateTab }));

let mod;
let S;
let appState;
let bridge;
let originalChat;

function buildDom() {
  document.body.innerHTML = `
    <div id="mod-translate-modal"></div>
    <div id="mod-translate-loading"></div>
    <div id="mod-translate-content" style="display:none"></div>
    <div id="mod-translate-modname"></div>
    <div id="mod-translate-langinfo"></div>
    <div id="mod-translate-ai-warning" style="display:none"></div>
    <button id="mod-translate-start-btn"></button>
    <div id="mod-translate-progress" style="display:none"></div>
    <div id="mod-translate-progress-bar"></div>
    <div id="mod-translate-progress-text"></div>
    <div id="mod-translate-result" style="display:none"></div>
    <button id="mod-translate-quick-btn"></button>
    <div id="mod-translate-quick-progress" style="display:none"></div>
    <div id="mod-translate-quick-progress-bar"></div>
    <div id="mod-translate-quick-progress-text"></div>
    <div id="mod-translate-quick-result" style="display:none"></div>
    <input id="mod-translate-file-input" type="file">
  `;
}

function resetS() {
  S._translateModJarPath = '';
  S._translateModName = '';
  S._translateLangInfo = null;
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

function setLangInfo(files) {
  S._translateLangInfo = { langFiles: files };
}

beforeAll(async () => {
  installTauriMock();
  vi.resetModules();
  ({ S } = await import('./vset-state.js'));
  ({ appState } = await import('../../core/app-state.js'));
  ({ bridge } = await import('../../core/tauri-bridge.js'));
  originalChat = bridge.ai.chat;
  mod = await import('./vset-translate.js');
});

beforeEach(() => {
  installTauriMock();
  buildDom();
  resetS();
  localStorage.clear();
  toast.mockClear();
  showModal.mockClear();
  switchTranslateTab.mockClear();
  vi.useFakeTimers();
  appState.currentSettingsVersionId = '1.20.1';
  bridge.mods = {
    findLangFiles: vi.fn(async () => ({ langFiles: [] })),
    getVersionModsDir: vi.fn(async () => 'D:/mods'),
    readJarEntry: vi.fn(async () => ({ success: true, content: '{}' })),
    writeJarEntry: vi.fn(async () => ({ success: true })),
  };
  bridge.ai.translateBatch = vi.fn(async () => ({ ok: true, results: [] }));
  vi.spyOn(bridge.ai, 'chat').mockImplementation(async () => ({ ok: true, reply: '{}' }));
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => [{ fileName: 'a.jar', jarPath: 'D:/mods/a.jar' }],
  })));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete bridge.mods;
  delete bridge.ai.translateBatch;
  bridge.ai.chat = originalChat;
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
  document.body.innerHTML = '';
});

describe('_getTranslateAIConfig', () => {
  it('读取合法配置', () => {
    localStorage.setItem('v-island-ai-config', JSON.stringify({ provider: 'zhipu', apiKey: 'k' }));

    expect(mod._getTranslateAIConfig()).toEqual({ provider: 'zhipu', apiKey: 'k' });
  });

  it('非法 JSON 返回空对象', () => {
    localStorage.setItem('v-island-ai-config', '{bad json');

    expect(mod._getTranslateAIConfig()).toEqual({});
  });
});

describe('_resolveModJarPath', () => {
  it('优先使用已安装列表的 jarPath', async () => {
    await expect(mod._resolveModJarPath('a.jar')).resolves.toBe('D:/mods/a.jar');
    expect(fetch).toHaveBeenCalledWith('/api/mods/installed?versionId=1.20.1');
  });

  it('列表不可用时回退版本模组目录', async () => {
    fetch.mockRejectedValue(new Error('offline'));

    await expect(mod._resolveModJarPath('b.jar')).resolves.toBe('D:/mods/b.jar');
    expect(bridge.mods.getVersionModsDir).toHaveBeenCalledWith('1.20.1');
  });

  it('两种方式都失败时返回空串', async () => {
    fetch.mockRejectedValue(new Error('offline'));
    bridge.mods.getVersionModsDir.mockRejectedValue(new Error('no dir'));

    await expect(mod._resolveModJarPath('c.jar')).resolves.toBe('');
  });

  it('列表中没有目标文件时回退目录', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [{ fileName: 'other.jar' }] });

    await expect(mod._resolveModJarPath('a.jar')).resolves.toBe('D:/mods/a.jar');
  });
});

describe('openModTranslateDialog', () => {
  it('未选择版本时提示', async () => {
    appState.currentSettingsVersionId = null;

    await mod.openModTranslateDialog('a.jar', 'A');

    expect(toast).toHaveBeenCalledWith('请先选择版本', 'error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('找不到模组文件时提示', async () => {
    fetch.mockRejectedValue(new Error('offline'));
    bridge.mods.getVersionModsDir.mockRejectedValue(new Error('no'));

    await mod.openModTranslateDialog('a.jar', 'A');

    expect(toast).toHaveBeenCalledWith('找不到模组文件: a.jar', 'error');
    expect(showModal).not.toHaveBeenCalled();
  });

  it('打开弹窗并展示语言文件与 AI 未配置状态', async () => {
    bridge.mods.findLangFiles.mockResolvedValue({
      langFiles: [
        { name: 'en_us.json', isEnglish: true },
        { name: 'zh_cn.json', isChinese: true },
      ],
    });

    await mod.openModTranslateDialog('a.jar', 'Example Mod');

    expect(showModal).toHaveBeenCalledWith('mod-translate-modal');
    expect(document.getElementById('mod-translate-loading').style.display).toBe('none');
    expect(document.getElementById('mod-translate-content').style.display).toBe('');
    expect(document.getElementById('mod-translate-modname').textContent).toBe('Example Mod');
    expect(document.getElementById('mod-translate-langinfo').textContent).toBe('共 2 个语言文件，英文源: en_us.json，已有中文翻译');
    expect(document.getElementById('mod-translate-ai-warning').style.display).toBe('');
    expect(document.getElementById('mod-translate-start-btn').disabled).toBe(true);
    expect(document.getElementById('mod-translate-start-btn').textContent).toBe('未配置 AI');
    expect(document.getElementById('mod-translate-progress').style.display).toBe('none');
    expect(document.getElementById('mod-translate-result').style.display).toBe('none');
    expect(switchTranslateTab).toHaveBeenCalledWith('quick');
  });

  it('无语言文件时展示占位说明', async () => {
    bridge.mods.findLangFiles.mockResolvedValue({ langFiles: [] });

    await mod.openModTranslateDialog('a.jar', 'A');

    expect(document.getElementById('mod-translate-langinfo').textContent).toBe('未找到语言文件（此模组可能没有可翻译的文本）');
  });

  it('已配置 AI 时启用机翻按钮', async () => {
    localStorage.setItem('v-island-ai-config', JSON.stringify({ provider: 'zhipu', apiKey: 'k' }));
    bridge.mods.findLangFiles.mockResolvedValue({ langFiles: [{ name: 'en_us.json', isEnglish: true }] });

    await mod.openModTranslateDialog('a.jar', 'A');

    expect(document.getElementById('mod-translate-ai-warning').style.display).toBe('none');
    expect(document.getElementById('mod-translate-start-btn').disabled).toBe(false);
    expect(document.getElementById('mod-translate-start-btn').textContent).toBe('开始机翻');
  });

  it('语言文件检查失败时展示错误', async () => {
    bridge.mods.findLangFiles.mockRejectedValue(new Error('zip broken'));

    await mod.openModTranslateDialog('a.jar', 'A');

    expect(document.getElementById('mod-translate-loading').innerHTML).toContain('检查失败: zip broken');
  });

  it('未传入模组名时使用文件名', async () => {
    bridge.mods.findLangFiles.mockResolvedValue({ langFiles: [] });

    await mod.openModTranslateDialog('a.jar');

    expect(document.getElementById('mod-translate-modname').textContent).toBe('a.jar');
  });
});

describe('startQuickTranslate', () => {
  it('没有语言信息时提示', async () => {
    await mod.startQuickTranslate();

    expect(toast).toHaveBeenCalledWith('没有可翻译的语言文件', 'error');
  });

  it('缺少英文语言文件时提示', async () => {
    setLangInfo([{ name: 'zh_cn.json', isChinese: true }]);

    await mod.startQuickTranslate();

    expect(toast).toHaveBeenCalledWith('未找到英文语言文件，无法翻译', 'error');
  });

  it('JSON 语言文件批量翻译并写入中文文件', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    S._translateModJarPath = 'D:/mods/a.jar';
    S._translateModName = 'Example';
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: JSON.stringify({ a: 'Hello', b: 'World' }) });
    bridge.ai.translateBatch.mockResolvedValue({ ok: true, results: ['你好', '世界'] });

    await mod.startQuickTranslate();

    expect(bridge.mods.readJarEntry).toHaveBeenCalledWith('D:/mods/a.jar', 'en_us.json');
    expect(bridge.ai.translateBatch).toHaveBeenCalledWith({ texts: ['Hello', 'World'], source: 'en', target: 'zh-CN' });
    expect(bridge.mods.writeJarEntry).toHaveBeenCalledWith(
      'D:/mods/a.jar',
      'zh_cn.json',
      JSON.stringify({ a: '你好', b: '世界' }, null, 2),
    );
    expect(document.getElementById('mod-translate-quick-progress-bar').style.width).toBe('100%');
    expect(document.getElementById('mod-translate-quick-result').textContent).toBe('汉化完成！共翻译 2 条文本，已写入 zh_cn.json');
    expect(document.getElementById('mod-translate-quick-btn').textContent).toBe('开始快速汉化');
    expect(document.getElementById('mod-translate-quick-btn').disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith('快速汉化完成，共翻译 2 条', 'success');
  });

  it('lang 文件解析并生成 zh_cn.lang', async () => {
    setLangInfo([{ name: 'en_us.lang', isEnglish: true }]);
    S._translateModJarPath = 'D:/mods/a.jar';
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: 'a=Hello\nb= World \ninvalid-line' });
    bridge.ai.translateBatch.mockResolvedValue({ ok: true, results: ['你好', '世界'] });

    await mod.startQuickTranslate();

    expect(bridge.mods.writeJarEntry).toHaveBeenCalledWith('D:/mods/a.jar', 'zh_cn.lang', 'a=你好\nb=世界');
  });

  it('旧式 en.lang 也映射为 zh_cn.lang', async () => {
    setLangInfo([{ name: 'en.lang', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: 'a=Hello' });
    bridge.ai.translateBatch.mockResolvedValue({ ok: true, results: ['你好'] });

    await mod.startQuickTranslate();

    expect(bridge.mods.writeJarEntry.mock.calls[0][1]).toBe('zh_cn.lang');
  });

  it('翻译结果不足时用原文补齐', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: JSON.stringify({ a: 'Hello', b: 'World' }) });
    bridge.ai.translateBatch.mockResolvedValue({ ok: true, results: ['你好'] });

    await mod.startQuickTranslate();

    const written = JSON.parse(bridge.mods.writeJarEntry.mock.calls[0][2]);
    expect(written).toEqual({ a: '你好', b: 'World' });
  });

  it('读取语言文件失败时展示错误', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: false, error: 'bad zip' });

    await mod.startQuickTranslate();

    expect(document.getElementById('mod-translate-quick-result').textContent).toBe('汉化失败：bad zip');
    expect(toast).toHaveBeenCalledWith('汉化失败：bad zip', 'error');
    expect(document.getElementById('mod-translate-quick-btn').disabled).toBe(false);
  });

  it('语言文件为空时失败', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: '{}' });

    await mod.startQuickTranslate();

    expect(document.getElementById('mod-translate-quick-result').textContent).toBe('汉化失败：语言文件为空');
  });

  it('JSON 解析失败时展示错误', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: '{not json' });

    await mod.startQuickTranslate();

    expect(document.getElementById('mod-translate-quick-result').textContent).toContain('汉化失败：');
  });

  it('翻译接口失败时提示批次', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: JSON.stringify({ a: 'Hello' }) });
    bridge.ai.translateBatch.mockResolvedValue({ ok: false, error: 'quota' });

    await mod.startQuickTranslate();

    expect(document.getElementById('mod-translate-quick-result').textContent).toBe('汉化失败：quota');
  });

  it('写入失败时提示', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: JSON.stringify({ a: 'Hello' }) });
    bridge.ai.translateBatch.mockResolvedValue({ ok: true, results: ['你好'] });
    bridge.mods.writeJarEntry.mockResolvedValue({ success: false, error: 'locked' });

    await mod.startQuickTranslate();

    expect(document.getElementById('mod-translate-quick-result').textContent).toBe('汉化失败：locked');
  });

  it('超过批量大小时分批翻译', async () => {
    const entries = {};
    for (let i = 0; i < 45; i++) entries['k' + i] = 'v' + i;
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: JSON.stringify(entries) });
    bridge.ai.translateBatch.mockImplementation(async ({ texts }) => ({ ok: true, results: texts.map((t) => 'zh-' + t) }));

    await mod.startQuickTranslate();

    expect(bridge.ai.translateBatch).toHaveBeenCalledTimes(2);
    expect(document.getElementById('mod-translate-quick-progress-bar').style.width).toBe('100%');
    expect(JSON.parse(bridge.mods.writeJarEntry.mock.calls[0][2]).k44).toBe('zh-v44');
  });
});

describe('startAutoTranslate', () => {
  beforeEach(() => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    S._translateModJarPath = 'D:/mods/a.jar';
    S._translateModName = 'Example';
    localStorage.setItem('v-island-ai-config', JSON.stringify({ provider: 'zhipu', apiKey: 'k', model: 'glm' }));
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: JSON.stringify({ a: 'Hello' }) });
    bridge.ai.chat.mockResolvedValue({ ok: true, reply: '{"a":"你好"}' });
  });

  it('没有语言信息时提示', async () => {
    S._translateLangInfo = null;

    await mod.startAutoTranslate();

    expect(toast).toHaveBeenCalledWith('没有可翻译的语言文件', 'error');
  });

  it('未配置 AI 时提示', async () => {
    localStorage.removeItem('v-island-ai-config');

    await mod.startAutoTranslate();

    expect(toast).toHaveBeenCalledWith('请先在 V岛设置中配置 AI 供应商', 'error');
    expect(bridge.ai.chat).not.toHaveBeenCalled();
  });

  it('JSON 翻译完整流程', async () => {
    await mod.startAutoTranslate();

    expect(bridge.ai.chat).toHaveBeenCalled();
    const request = bridge.ai.chat.mock.calls[0][0];
    expect(request.provider).toBe('zhipu');
    expect(request.endpoint).toContain('bigmodel.cn');
    expect(request.messages[0].role).toBe('system');
    expect(bridge.mods.writeJarEntry).toHaveBeenCalledWith('D:/mods/a.jar', 'zh_cn.json', JSON.stringify({ a: '你好' }, null, 2));
    expect(document.getElementById('mod-translate-progress-bar').style.width).toBe('100%');
    expect(document.getElementById('mod-translate-result').textContent).toBe('汉化完成！已翻译 1 条文本，写入到 zh_cn.json');
    expect(document.getElementById('mod-translate-start-btn').textContent).toBe('重新翻译');
    expect(toast).toHaveBeenCalledWith('「Example」汉化完成', 'success');
  });

  it('优先使用语言文件自带的中文名', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true, zhName: 'custom_zh.json' }]);

    await mod.startAutoTranslate();

    expect(bridge.mods.writeJarEntry.mock.calls[0][1]).toBe('custom_zh.json');
  });

  it('lang 输出缺失项回落原文', async () => {
    setLangInfo([{ name: 'en_us.lang', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: 'a=Hello\nb=World' });
    bridge.ai.chat.mockResolvedValue({ ok: true, reply: '{"a":"你好"}' });

    await mod.startAutoTranslate();

    expect(bridge.mods.writeJarEntry).toHaveBeenCalledWith('D:/mods/a.jar', 'zh_cn.lang', 'a=你好\nb=World');
  });

  it('读取失败时展示重试态', async () => {
    bridge.mods.readJarEntry.mockResolvedValue({ success: false, error: 'bad zip' });

    await mod.startAutoTranslate();

    expect(document.getElementById('mod-translate-progress').style.display).toBe('none');
    expect(document.getElementById('mod-translate-result').textContent).toBe('翻译失败: bad zip');
    expect(document.getElementById('mod-translate-start-btn').textContent).toBe('重试');
    expect(document.getElementById('mod-translate-start-btn').disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith('汉化失败: bad zip', 'error');
  });

  it('空语言文件失败', async () => {
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: '{}' });

    await mod.startAutoTranslate();

    expect(document.getElementById('mod-translate-result').textContent).toBe('翻译失败: 语言文件为空');
  });

  it('不可恢复的 AI 错误立即停止重试', async () => {
    bridge.ai.chat.mockResolvedValue({ ok: false, error: '余额不足' });

    await mod.startAutoTranslate();

    expect(bridge.ai.chat).toHaveBeenCalledTimes(1);
    expect(document.getElementById('mod-translate-result').textContent).toContain('AI 请求失败（批次 1，重试1次）：余额不足');
  });

  it('返回格式异常时重试三次后失败', async () => {
    bridge.ai.chat.mockResolvedValue({ ok: true, reply: '没有 JSON' });

    const pending = mod.startAutoTranslate();
    await settle();
    await vi.advanceTimersByTimeAsync(4000);
    await pending;

    expect(bridge.ai.chat).toHaveBeenCalledTimes(3);
    expect(document.getElementById('mod-translate-result').textContent).toContain('重试3次');
  });

  it('异常后重试成功', async () => {
    bridge.ai.chat
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ ok: true, reply: '{"a":"你好"}' });

    const pending = mod.startAutoTranslate();
    await settle();
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    expect(bridge.ai.chat).toHaveBeenCalledTimes(2);
    expect(document.getElementById('mod-translate-result').textContent).toBe('汉化完成！已翻译 1 条文本，写入到 zh_cn.json');
  });
});

describe('_translateWithAI', () => {
  it('自定义供应商使用配置的接口地址', async () => {
    await mod._translateWithAI({ a: 'Hello' }, {
      provider: 'custom',
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://custom.example.com',
      apiFormat: 'openai',
    }, true);

    const request = bridge.ai.chat.mock.calls[0][0];
    expect(request.endpoint).toBe('https://custom.example.com');
    expect(request.apiFormat).toBe('openai');
  });

  it('自定义供应商缺少接口地址时报错', async () => {
    await expect(mod._translateWithAI({ a: 'Hello' }, { provider: 'custom', apiKey: 'k' }, true)).rejects.toThrow('自定义供应商未配置接口地址');
  });

  it('未知供应商报错', async () => {
    await expect(mod._translateWithAI({ a: 'Hello' }, { provider: 'nope', apiKey: 'k' }, true)).rejects.toThrow('不支持的供应商: nope');
  });

  it('Google 供应商在基础地址中带上模型', async () => {
    await mod._translateWithAI({ a: 'Hello' }, { provider: 'google', apiKey: 'k', model: 'gemini-pro' }, true);

    expect(bridge.ai.chat.mock.calls[0][0].endpoint).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent');
  });

  it('Anthropic 供应商使用内置格式与地址', async () => {
    await mod._translateWithAI({ a: 'Hello' }, { provider: 'anthropic', apiKey: 'k', model: 'claude' }, true);

    const request = bridge.ai.chat.mock.calls[0][0];
    expect(request.endpoint).toContain('anthropic.com');
    expect(request.apiFormat).toBe('anthropic');
  });

  it('多批次并行处理并汇报进度', async () => {
    const entries = {};
    for (let i = 0; i < 51; i++) entries['k' + i] = 'v' + i;
    bridge.ai.chat.mockImplementation(async ({ messages }) => {
      const body = JSON.parse(messages[1].content);
      const reply = {};
      Object.keys(body).forEach((key) => { reply[key] = 'zh-' + body[key]; });
      return { ok: true, reply: JSON.stringify(reply) };
    });
    const onProgress = vi.fn();

    const result = await mod._translateWithAI(entries, { provider: 'zhipu', apiKey: 'k', model: 'm' }, true, onProgress);

    expect(bridge.ai.chat).toHaveBeenCalledTimes(2);
    expect(Object.keys(result)).toHaveLength(51);
    expect(onProgress).toHaveBeenLastCalledWith(51, 51);
  });

  it('从带说明文字的回答中提取 JSON', async () => {
    bridge.ai.chat.mockResolvedValue({ ok: true, reply: '翻译如下： {"a":"你好"} 以上' });

    await expect(mod._translateWithAI({ a: 'Hello' }, { provider: 'zhipu', apiKey: 'k' }, true)).resolves.toEqual({ a: '你好' });
  });
});

describe('exportModLangFile', () => {
  it('导出英文语言文件', async () => {
    setLangInfo([{ name: 'assets/example/lang/en_us.json', isEnglish: true }]);
    S._translateModJarPath = 'D:/mods/a.jar';
    bridge.mods.readJarEntry.mockResolvedValue({ success: true, content: 'raw-content' });
    URL.createObjectURL = vi.fn(() => 'blob:lang');
    URL.revokeObjectURL = vi.fn();
    let clicked = null;
    HTMLAnchorElement.prototype.click.mockImplementation(function () { clicked = this; });

    await mod.exportModLangFile();

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clicked.download).toBe('en_us.json');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:lang');
    expect(toast).toHaveBeenCalledWith('已导出 en_us.json', 'success');
  });

  it('没有语言信息时提示', async () => {
    await mod.exportModLangFile();

    expect(toast).toHaveBeenCalledWith('没有可导出的语言文件', 'error');
  });

  it('读取失败时提示', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.readJarEntry.mockResolvedValue({ success: false, error: 'not found' });

    await mod.exportModLangFile();

    expect(toast).toHaveBeenCalledWith('not found', 'error');
  });

  it('异常时提示导出失败', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.readJarEntry.mockRejectedValue(new Error('zip error'));

    await mod.exportModLangFile();

    expect(toast).toHaveBeenCalledWith('导出失败: zip error', 'error');
  });
});

describe('importModLangFile', () => {
  it('未打开汉化弹窗时提示', async () => {
    S._translateLangInfo = null;

    await mod.importModLangFile();

    expect(toast).toHaveBeenCalledWith('请先打开模组汉化弹窗', 'error');
  });

  it('导入文件写入语言文件', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true, zhName: 'custom.json' }]);
    S._translateModJarPath = 'D:/mods/a.jar';
    const input = document.getElementById('mod-translate-file-input');
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    await mod.importModLangFile();
    expect(click).toHaveBeenCalled();

    await input.onchange({ target: { files: [{ name: 'zh.json', text: async () => '{"a":"你好"}' }] } });

    expect(bridge.mods.writeJarEntry).toHaveBeenCalledWith('D:/mods/a.jar', 'custom.json', '{"a":"你好"}');
    expect(toast).toHaveBeenCalledWith('已导入 zh.json → custom.json', 'success');
  });

  it('没有中文文件名时使用默认 zh_cn.json', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    const input = document.getElementById('mod-translate-file-input');

    await mod.importModLangFile();
    await input.onchange({ target: { files: [{ name: 'x.json', text: async () => 'x' }] } });

    expect(bridge.mods.writeJarEntry.mock.calls[0][1]).toBe('zh_cn.json');
  });

  it('未选择文件时不做写入', async () => {
    setLangInfo([]);
    const input = document.getElementById('mod-translate-file-input');

    await mod.importModLangFile();
    await input.onchange({ target: { files: [] } });

    expect(bridge.mods.writeJarEntry).not.toHaveBeenCalled();
  });

  it('写入异常时提示导入失败', async () => {
    setLangInfo([{ name: 'en_us.json', isEnglish: true }]);
    bridge.mods.writeJarEntry.mockRejectedValue(new Error('locked'));
    const input = document.getElementById('mod-translate-file-input');

    await mod.importModLangFile();
    await input.onchange({ target: { files: [{ name: 'x.json', text: async () => 'x' }] } });

    expect(toast).toHaveBeenCalledWith('导入失败: locked', 'error');
  });
});
