// @vitest-environment jsdom
// dynamic-island-agent.test.js — V 岛动作解析、界面快照与代理执行单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTauriMock, mockCommand } from '../../test-utils/tauri-mock.js';

let agent;
let S;
let tools;

const AI_CONFIG = { provider: 'zhipu', apiKey: 'test-key', model: 'glm-4-flash' };

function islandEl() {
  document.body.innerHTML = `
    <div id="v-island">
      <div class="v-island__subtitle"></div>
      <div class="v-island__detail"></div>
      <div class="v-island__input"><input /></div>
    </div>
  `;
  return document.getElementById('v-island');
}

function visibleButton(text) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.position = 'fixed';
  btn.getBoundingClientRect = () => ({ width: 100, height: 20 });
  return btn;
}

function visibleInput(props = {}) {
  const input = document.createElement('input');
  Object.assign(input, props);
  input.style.position = 'fixed';
  input.getBoundingClientRect = () => ({ width: 100, height: 20 });
  return input;
}

function aiReply(reply) {
  mockCommand('ai_chat', () => ({ ok: true, reply }));
}

beforeAll(async () => {
  installTauriMock();
  vi.resetModules();
  S = (await import('./dynamic-island-state.js')).S;
  agent = await import('./dynamic-island-agent.js');
  tools = agent._tools;
}, 60000);

beforeEach(() => {
  installTauriMock({ commands: { ai_chat: () => ({ ok: true, reply: '默认回复' }) } });
  localStorage.clear();
  localStorage.setItem('v-island-ai-config', JSON.stringify(AI_CONFIG));
  S._el = null;
  S._expanded = false;
  S._state = 'idle';
  S._dialogHistory = [];
  S._pendingConfirm = null;
  S._snapshotElements = [];
  const staleIdx = tools.findIndex((t) => t.name === '__test_ok');
  if (staleIdx >= 0) tools.splice(staleIdx, 1);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('_parseAction / _parseUIAction', () => {
  it('解析动作、参数并保留说明文字', () => {
    const reply = '好的{{ACTION:{"name":"search_mod","args":{"query":"sodium"}}}}正在搜索';
    expect(agent._parseAction(reply)).toEqual({
      name: 'search_mod',
      args: { query: 'sodium' },
      text: '好的正在搜索',
    });
  });

  it('支持嵌套 JSON 参数', () => {
    const reply = '{{ACTION:{"name":"x","args":{"a":{"b":1}}}}';
    expect(agent._parseAction(reply).args).toEqual({ a: { b: 1 } });
  });

  it('无标记或 JSON 损坏时返回 null', () => {
    expect(agent._parseAction('普通回复')).toBeNull();
    expect(agent._parseAction('{{ACTION:{"name":"x"')).toBeNull();
    expect(agent._parseAction('{{ACTION:{bad}}}')).toBeNull();
  });

  it('解析 UI 目标并把字符串索引转成数字', () => {
    expect(agent._parseUIAction('{{UI:{"type":"click","target":"3"}}')).toEqual({
      type: 'click',
      target: 3,
    });
  });

  it('无标记或损坏时返回 null', () => {
    expect(agent._parseUIAction('none')).toBeNull();
    expect(agent._parseUIAction('{{UI:{"type":}}')).toBeNull();
  });
});

describe('_shouldUseAgentMode / _buildToolPrompt', () => {
  it('命中操作类关键词时启用代理模式', () => {
    expect(agent._shouldUseAgentMode('帮我下载一个模组')).toBe(true);
    expect(agent._shouldUseAgentMode('打开设置')).toBe(true);
    expect(agent._shouldUseAgentMode('切换账户')).toBe(true);
  });

  it('普通闲聊不启用', () => {
    expect(agent._shouldUseAgentMode('今天天气怎么样')).toBe(false);
    expect(agent._shouldUseAgentMode('')).toBe(false);
  });

  it('工具提示包含动作标记、工具名与确认标记', () => {
    tools.push({ name: '__test_prompt', desc: '测试', danger: true, params: { q: '关键词' }, run: () => '' });
    const prompt = agent._buildToolPrompt();
    tools.pop();
    expect(prompt).toContain('{{ACTION:');
    expect(prompt).toContain('__test_prompt[确认]:q(关键词)');
    expect(prompt).toContain('启动器助手');
  });
});

describe('_snapshotUI', () => {
  it('收集可见按钮与输入框并跳过隐藏和 V 岛自身元素', () => {
    islandEl();
    const btn = visibleButton('搜索 Sodium');
    const input = visibleInput({ placeholder: '搜索模组', value: 'abc123' });
    const hidden = document.createElement('div');
    hidden.setAttribute('role', 'button');
    hidden.textContent = '隐藏按钮';
    hidden.style.position = 'fixed';
    const islandBtn = visibleButton('岛内按钮');
    document.getElementById('v-island').appendChild(islandBtn);
    document.body.append(btn, input, hidden);

    const snapshot = agent._snapshotUI();

    expect(snapshot).toContain('[0] click "搜索 Sodium"');
    expect(snapshot).toContain('[1] input "搜索模组" (placeholder:搜索模组) (current:abc123)');
    expect(snapshot).not.toContain('隐藏按钮');
    expect(snapshot).not.toContain('岛内按钮');
    expect(S._snapshotElements).toEqual([btn, input]);
  });

  it('没有可交互元素时返回空字符串', () => {
    document.body.innerHTML = '<div>plain</div>';
    expect(agent._snapshotUI()).toBe('');
    expect(S._snapshotElements).toEqual([]);
  });
});

describe('_executeAction', () => {
  it('执行已注册工具并返回结果', () => {
    const run = vi.fn(() => '执行成功');
    tools.push({ name: '__test_ok', desc: '测试', params: {}, run });
    expect(agent._executeAction({ name: '__test_ok', args: { a: 1 } })).toBe('执行成功');
    expect(run).toHaveBeenCalledWith({ a: 1 });
  });

  it('未知工具返回提示', () => {
    expect(agent._executeAction({ name: 'nope' })).toContain('未知操作');
  });

  it('工具抛错时返回错误信息', () => {
    tools.push({ name: '__test_ok', params: {}, run: () => { throw new Error('boom'); } });
    expect(agent._executeAction({ name: '__test_ok' })).toBe('执行出错：boom');
  });
});

describe('_executeUIAction', () => {
  it('点击快照元素并返回描述', () => {
    const btn = visibleButton('开始搜索');
    const clicked = vi.fn();
    btn.addEventListener('click', clicked);
    btn.scrollIntoView = vi.fn();
    S._snapshotElements = [btn];

    expect(agent._executeUIAction({ type: 'click', target: 0 })).toBe('已点击"开始搜索"');
    expect(clicked).toHaveBeenCalled();
  });

  it('输入文本并触发 input/change/Enter 事件', () => {
    const input = visibleInput();
    input.scrollIntoView = vi.fn();
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();
    const enterSpy = vi.fn();
    input.addEventListener('input', inputSpy);
    input.addEventListener('change', changeSpy);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterSpy(); });
    S._snapshotElements = [input];

    expect(agent._executeUIAction({ type: 'input', target: 0, value: 'hello', enter: true })).toBe('已输入"hello"');
    expect(input.value).toBe('hello');
    expect(inputSpy).toHaveBeenCalled();
    expect(changeSpy).toHaveBeenCalled();
    expect(enterSpy).toHaveBeenCalled();
  });

  it('done 返回 null，未知类型返回提示', () => {
    expect(agent._executeUIAction({ type: 'done' })).toBeNull();
    expect(agent._executeUIAction({ type: 'scroll' })).toContain('未知操作类型');
  });

  it('目标不存在时返回提示', () => {
    S._snapshotElements = [];
    expect(agent._executeUIAction({ type: 'click', target: 9 })).toContain('不存在');
  });

  it('点击抛错时返回失败原因', () => {
    const btn = visibleButton('坏按钮');
    btn.scrollIntoView = () => { throw new Error('不可见'); };
    S._snapshotElements = [btn];
    expect(agent._executeUIAction({ type: 'click', target: 0 })).toBe('点击失败：不可见');
  });
});

describe('_generateSummary', () => {
  it('没有执行步骤时提示重试', () => {
    expect(agent._generateSummary('q', [], '')).toContain('操作未能完成');
  });

  it('从界面快照提取结果并跳过安装/下载按钮', () => {
    const snapshot = [
      '[0] click "Sodium 模组搜索结果第一条，这是一个很长的描述文字"',
      '[1] click "安装 Sodium 模组按钮"',
      '[2] click "Fabric API 搜索结果第二条，同样是很长的描述文字"',
      '[3] click "第三人称视角设置选项，也是很长的描述文字"',
    ].join('\n');

    const summary = agent._generateSummary('q', ['点击搜索', '查看结果'], snapshot);

    expect(summary).toContain('已完成 2 步操作');
    expect(summary).toContain('查看结果');
    expect(summary).toContain('当前界面显示3个结果');
    expect(summary).not.toContain('安装 Sodium');
    expect(summary).toContain('等');
  });
});

describe('_typewriter / _showReply', () => {
  it('逐字输出并在结束后移除光标', async () => {
    vi.useFakeTimers();
    const detail = document.createElement('div');
    detail.innerHTML = '<span class="v-typing-text"></span><span class="v-typing-cursor"></span>';
    const textEl = detail.querySelector('.v-typing-text');

    agent._typewriter(textEl, '你好世界', 30);
    await vi.advanceTimersByTimeAsync(200);

    expect(textEl.textContent).toBe('你好世界');
    expect(detail.querySelector('.v-typing-cursor')).toBeNull();
  });

  it('显示回复、切换展开态并设置自动收起计时', async () => {
    vi.useFakeTimers();
    const el = islandEl();
    S._el = el;

    agent._showReply('问题', '回答');

    expect(el.classList.contains('v-island--thinking')).toBe(false);
    expect(el.classList.contains('v-island--expanded')).toBe(true);
    expect(S._expanded).toBe(true);
    expect(el.querySelector('.v-island__subtitle').textContent).toBe('V 岛回复');
    expect(el.querySelector('.v-island__detail').innerHTML).toContain('v-typing-text');
    expect(S._replyHideTimer).toBeTruthy();

    await vi.advanceTimersByTimeAsync(200);
    expect(el.querySelector('.v-typing-text').textContent).toBe('回答');
  });
});

describe('_showConfirmDialog', () => {
  function setup() {
    const el = islandEl();
    S._el = el;
    tools.push({ name: '__test_ok', desc: '危险操作', params: {}, run: () => '执行完成' });
    return el;
  }

  it('确认后执行动作并回复结果', async () => {
    vi.useFakeTimers();
    const el = setup();

    agent._showConfirmDialog({ name: '__test_ok', args: {} }, '问题', '要执行吗');
    expect(el.querySelector('.v-island__confirm-yes')).toBeTruthy();
    expect(el.textContent).toContain('要执行吗');

    el.querySelector('.v-island__confirm-yes').click();
    await vi.advanceTimersByTimeAsync(200);

    expect(el.querySelector('.v-island__subtitle').textContent).toBe('V 岛回复');
    expect(el.querySelector('.v-typing-text').textContent).toBe('执行完成');
  });

  it('取消后回复已取消', async () => {
    vi.useFakeTimers();
    const el = setup();

    agent._showConfirmDialog({ name: '__test_ok', args: {} }, '问题', '要执行吗');
    el.querySelector('.v-island__confirm-no').click();
    await vi.advanceTimersByTimeAsync(200);

    expect(el.querySelector('.v-typing-text').textContent).toBe('已取消操作');
  });
});

describe('_askQuestion', () => {
  it('普通对话回复并记录历史', async () => {
    vi.useFakeTimers();
    S._el = islandEl();
    aiReply('你好呀');

    await agent._askQuestion('今天心情怎么样');

    expect(S._dialogHistory[S._dialogHistory.length - 1]).toEqual({ role: 'assistant', content: '你好呀' });
    expect(S._el.querySelector('.v-island__subtitle').textContent).toBe('V 岛回复');
  });

  it('安全动作直接执行并写入结果', async () => {
    vi.useFakeTimers();
    S._el = islandEl();
    tools.push({ name: '__test_ok', desc: '测试', params: {}, run: () => '操作完成' });
    aiReply('{{ACTION:{"name":"__test_ok","args":{}}}}');

    await agent._askQuestion('请执行这个动作');

    expect(S._dialogHistory[S._dialogHistory.length - 1]).toEqual({ role: 'assistant', content: '操作完成' });
  });

  it('危险动作先请求确认', async () => {
    vi.useFakeTimers();
    S._el = islandEl();
    tools.push({ name: '__test_ok', desc: '危险操作', danger: true, params: {}, run: () => 'done' });
    aiReply('{{ACTION:{"name":"__test_ok","args":{}}}}');

    await agent._askQuestion('删除它吧');

    expect(S._pendingConfirm).toMatchObject({ name: '__test_ok' });
    expect(S._el.querySelector('.v-island__confirm-yes')).toBeTruthy();
  });

  it('确认回复直接执行待确认动作', async () => {
    vi.useFakeTimers();
    S._el = islandEl();
    tools.push({ name: '__test_ok', desc: '测试', params: {}, run: () => '确认后完成' });
    S._pendingConfirm = { name: '__test_ok', args: {} };

    await agent._askQuestion('确认');

    expect(S._pendingConfirm).toBeNull();
    expect(S._dialogHistory[S._dialogHistory.length - 1].content).toBe('确认后完成');
  });

  it('代理模式按 UI 指令点击并验证结果', async () => {
    vi.useFakeTimers();
    S._el = islandEl();
    const btn = visibleButton('搜索 Sodium');
    const clicked = vi.fn();
    btn.addEventListener('click', clicked);
    btn.scrollIntoView = vi.fn();
    document.body.appendChild(btn);

    let call = 0;
    mockCommand('ai_chat', () => {
      call++;
      if (call === 1) return { ok: true, reply: '{{UI:{"type":"click","target":0,"think":"点击搜索"}}}' };
      if (call === 2) return { ok: true, reply: '{{UI:{"type":"done","think":"完成"}}}' };
      return { ok: true, reply: '已为你找到 Sodium' };
    });

    const pending = agent._askQuestion('帮我搜索 Sodium');
    await vi.advanceTimersByTimeAsync(3000);
    await pending;

    expect(clicked).toHaveBeenCalled();
    expect(call).toBe(3);
    expect(S._el.querySelector('.v-island__subtitle').textContent).toBe('V 岛回复');
    await vi.advanceTimersByTimeAsync(1000);
    expect(S._el.querySelector('.v-typing-text').textContent).toContain('已为你找到 Sodium');
  });

  it('代理模式收到普通回复时直接展示', async () => {
    vi.useFakeTimers();
    S._el = islandEl();
    aiReply('我无法完成这个操作');

    await agent._askQuestion('帮我搜索');

    await vi.advanceTimersByTimeAsync(400);
    expect(S._el.querySelector('.v-typing-text').textContent).toBe('我无法完成这个操作');
  });
});
