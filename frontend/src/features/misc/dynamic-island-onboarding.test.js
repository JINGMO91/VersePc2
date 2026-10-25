// @vitest-environment jsdom
// dynamic-island-onboarding.test.js — V 岛引导页阶段切换、供应商配置与开关联动单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  speakMock,
  stopSpeakMock,
  startVoiceMock,
  stopWakeMock,
  ensureHoverMock,
  dismissMock,
  previewMock,
  saveAIConfigMock,
  getAIConfigMock,
  providers,
} = vi.hoisted(() => ({
  speakMock: vi.fn((text, done) => { if (done) done(); }),
  stopSpeakMock: vi.fn(),
  startVoiceMock: vi.fn(),
  stopWakeMock: vi.fn(),
  ensureHoverMock: vi.fn(),
  dismissMock: vi.fn(),
  previewMock: vi.fn(),
  saveAIConfigMock: vi.fn(),
  getAIConfigMock: vi.fn(() => ({})),
  providers: {
    zhipu: {
      name: '智谱',
      icon: 'zhipu',
      models: [{ id: 'glm-4', name: 'GLM-4', free: true }, { id: 'glm-3', name: 'GLM-3' }],
    },
    openai: { name: 'OpenAI', icon: 'openai', models: [{ id: 'gpt-4o', name: 'GPT-4o' }] },
  },
}));

vi.mock('./dynamic-island-tts.js', () => ({ speak: speakMock, stopSpeak: stopSpeakMock }));
vi.mock('./dynamic-island-voice.js', () => ({
  _startVoiceAssistant: startVoiceMock,
  _stopWake: stopWakeMock,
}));
vi.mock('./dynamic-island-config.js', () => ({
  AI_PROVIDERS: providers,
  _getAIConfig: getAIConfigMock,
  _saveAIConfig: saveAIConfigMock,
}));
vi.mock('./dynamic-island-view.js', () => ({
  _ensureHoverZone: ensureHoverMock,
  dismiss: dismissMock,
  preview: previewMock,
}));

let mod;

beforeAll(async () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    callback();
    return 1;
  }));
  vi.resetModules();
  mod = await import('./dynamic-island-onboarding.js');
});

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  speakMock.mockClear();
  stopSpeakMock.mockClear();
  startVoiceMock.mockClear();
  stopWakeMock.mockClear();
  ensureHoverMock.mockClear();
  dismissMock.mockClear();
  previewMock.mockClear();
  saveAIConfigMock.mockClear();
  getAIConfigMock.mockClear();
  getAIConfigMock.mockImplementation(() => ({}));
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    callback();
    return 1;
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('完成标记', () => {
  it('读取、写入与重置', () => {
    expect(mod._isOnboardingComplete()).toBe(false);

    mod._completeOnboarding();
    expect(localStorage.getItem('v-island-onboarding-complete')).toBe('true');
    expect(mod._isOnboardingComplete()).toBe(true);

    mod._resetOnboarding();
    expect(mod._isOnboardingComplete()).toBe(false);
  });
});

describe('_showOnboarding', () => {
  it('创建完整引导结构并触发可见动画', async () => {
    mod._showOnboarding();
    await vi.advanceTimersByTimeAsync(600);

    const overlay = document.getElementById('v-island-onboarding');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('v-island-onboarding--visible')).toBe(true);
    expect(overlay.querySelectorAll('.v-island-onboarding__phase')).toHaveLength(3);
    expect(overlay.querySelector('[data-phase="greeting"]').style.display).toBe('');
    expect(overlay.querySelector('[data-phase="provider"]').style.display).toBe('none');
    expect(speakMock).toHaveBeenCalled();
  });

  it('重复显示会替换旧节点', () => {
    mod._showOnboarding();
    mod._showOnboarding();

    expect(document.querySelectorAll('#v-island-onboarding')).toHaveLength(1);
  });

  it('问候阶段结束后切到供应商阶段', async () => {
    mod._showOnboarding();

    await vi.advanceTimersByTimeAsync(4000);

    expect(document.querySelector('[data-phase="provider"]').style.display).toBe('');
    expect(document.getElementById('v-island-onboarding-providers').children.length).toBe(3);
  });
});

describe('_hideOnboarding', () => {
  it('淡出后移除节点', async () => {
    mod._showOnboarding();

    mod._hideOnboarding();

    const overlay = document.getElementById('v-island-onboarding');
    expect(overlay.classList.contains('v-island-onboarding--fadeout')).toBe(true);

    await vi.advanceTimersByTimeAsync(600);
    expect(document.getElementById('v-island-onboarding')).toBeNull();
  });

  it('节点不存在时安全返回', () => {
    expect(() => mod._hideOnboarding()).not.toThrow();
  });
});

describe('_runGreetingPhase', () => {
  it('逐行播报四段欢迎语', async () => {
    document.body.innerHTML = `
      <div class="v-island-onboarding__phase" data-phase="greeting">
        <h1 class="v-island-onboarding__title"></h1>
        <h1 class="v-island-onboarding__title"></h1>
        <h1 class="v-island-onboarding__title"></h1>
        <h1 class="v-island-onboarding__title"></h1>
      </div>
      <div class="v-island-onboarding__phase" data-phase="provider" style="display:none"></div>
    `;

    mod._runGreetingPhase();
    await vi.advanceTimersByTimeAsync(3500);

    expect(speakMock).toHaveBeenCalledTimes(4);
    expect(speakMock.mock.calls[0][0]).toBe('Hi～我是 V 岛');
    expect(speakMock.mock.calls[3][0]).toBe('在此之前，我们先完成一些配置');
    expect(document.querySelector('[data-phase="provider"]').style.display).toBe('');
  });

  it('语音回调缺失时仍会推进', async () => {
    speakMock.mockImplementation(() => {});
    document.body.innerHTML = `
      <div class="v-island-onboarding__phase" data-phase="greeting">
        <h1 class="v-island-onboarding__title"></h1>
      </div>
    `;

    mod._runGreetingPhase();
    await vi.advanceTimersByTimeAsync(500);

    expect(speakMock).toHaveBeenCalledTimes(1);
  });
});

describe('_switchPhase', () => {
  it('只显示目标阶段', () => {
    document.body.innerHTML = `
      <div class="v-island-onboarding__phase" data-phase="greeting"></div>
      <div class="v-island-onboarding__phase" data-phase="done" style="display:none"></div>
    `;

    mod._switchPhase('done');

    expect(document.querySelector('[data-phase="greeting"]').style.display).toBe('none');
    expect(document.querySelector('[data-phase="done"]').style.display).toBe('');
  });
});

describe('_runProviderPhase', () => {
  function setupProviderDom() {
    document.body.innerHTML = `
      <div id="v-island-onboarding"></div>
      <div class="v-island-onboarding__phase" data-phase="provider">
        <div id="v-island-onboarding-providers"></div>
        <div id="v-island-onboarding-config" style="display:none"></div>
        <button id="v-island-onboarding-skip"></button>
        <button id="v-island-onboarding-next" disabled></button>
      </div>
      <div class="v-island-onboarding__phase" data-phase="done" style="display:none">
        <button id="v-island-onboarding-finish"></button>
      </div>
    `;
  }

  it('渲染预置供应商与自定义卡片', () => {
    setupProviderDom();

    mod._runProviderPhase();

    const cards = document.querySelectorAll('.v-island-onboarding-provider-card');
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain('智谱');
    expect(cards[2].textContent).toContain('自定义供应商');
    expect(document.getElementById('v-island-onboarding-config').style.display).toBe('none');
    expect(document.getElementById('v-island-onboarding-next').disabled).toBe(true);
  });

  it('缺少供应商容器时直接返回', () => {
    document.body.innerHTML = '';

    expect(() => mod._runProviderPhase()).not.toThrow();
  });

  it('点击供应商卡片展示配置并启用下一步', () => {
    setupProviderDom();
    mod._runProviderPhase();
    const card = document.querySelector('.v-island-onboarding-provider-card');

    card.click();

    expect(card.classList.contains('v-island-onboarding-provider-card--active')).toBe(true);
    expect(document.getElementById('v-island-onboarding-config').style.display).toBe('');
    expect(document.getElementById('v-island-onboarding-key')).not.toBeNull();

    document.getElementById('v-island-onboarding-key').value = 'key';
    document.getElementById('v-island-onboarding-key').oninput();
    expect(document.getElementById('v-island-onboarding-next').disabled).toBe(false);
  });

  it('切换卡片会清除上一个激活态', () => {
    setupProviderDom();
    mod._runProviderPhase();
    const cards = document.querySelectorAll('.v-island-onboarding-provider-card');

    cards[0].click();
    cards[1].click();

    expect(cards[0].classList.contains('v-island-onboarding-provider-card--active')).toBe(false);
    expect(cards[1].classList.contains('v-island-onboarding-provider-card--active')).toBe(true);
  });

  it('点击自定义卡片展示完整输入项', () => {
    setupProviderDom();
    mod._runProviderPhase();
    const custom = document.querySelectorAll('.v-island-onboarding-provider-card')[2];

    custom.click();

    expect(document.getElementById('v-island-onboarding-endpoint')).not.toBeNull();
    expect(document.getElementById('v-island-onboarding-format')).not.toBeNull();
    expect(document.getElementById('v-island-onboarding-model').tagName).toBe('INPUT');
  });

  it('跳过配置直接进入完成阶段', () => {
    setupProviderDom();
    mod._runProviderPhase();

    document.getElementById('v-island-onboarding-skip').click();

    expect(saveAIConfigMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-phase="done"]').style.display).toBe('');
  });

  it('下一步保存供应商并进入完成阶段', () => {
    setupProviderDom();
    mod._runProviderPhase();
    document.querySelector('.v-island-onboarding-provider-card').click();
    const keyInput = document.getElementById('v-island-onboarding-key');
    keyInput.value = 'secret';
    keyInput.oninput();
    document.getElementById('v-island-onboarding-model').value = 'glm-4';

    document.getElementById('v-island-onboarding-next').click();

    expect(saveAIConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'zhipu',
      apiKey: 'secret',
      model: 'glm-4',
    }));
    expect(document.querySelector('[data-phase="done"]').style.display).toBe('');
  });

  it('完成按钮写入标记、收起引导并启动语音助手', () => {
    setupProviderDom();
    mod._runProviderPhase();

    document.getElementById('v-island-onboarding-finish').click();

    expect(mod._isOnboardingComplete()).toBe(true);
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(startVoiceMock).toHaveBeenCalled();
    expect(document.getElementById('v-island-onboarding').classList.contains('v-island-onboarding--fadeout')).toBe(true);
  });
});

describe('_showProviderConfig', () => {
  function setup() {
    document.body.innerHTML = `
      <div id="v-island-onboarding-config" style="display:none"></div>
      <button id="v-island-onboarding-next" disabled></button>
    `;
    return document.getElementById('v-island-onboarding-next');
  }

  it('预置供应商渲染模型选项与免费标记', () => {
    const next = setup();

    mod._showProviderConfig('zhipu', next);

    const options = document.querySelectorAll('#v-island-onboarding-model option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toBe('GLM-4 (免费)');
    expect(options[1].textContent).toBe('GLM-3');
    expect(document.getElementById('v-island-onboarding-config').style.display).toBe('');
  });

  it('预置供应商仅填写 Key 即可继续', () => {
    const next = setup();
    mod._showProviderConfig('openai', next);
    const key = document.getElementById('v-island-onboarding-key');

    expect(next.disabled).toBe(true);
    key.value = 'k';
    key.oninput();
    expect(next.disabled).toBe(false);
  });

  it('自定义供应商要求接口、模型与 Key 全部填写', () => {
    const next = setup();
    mod._showProviderConfig('custom', next);

    const key = document.getElementById('v-island-onboarding-key');
    const endpoint = document.getElementById('v-island-onboarding-endpoint');
    const model = document.getElementById('v-island-onboarding-model');

    key.value = 'k';
    key.oninput();
    expect(next.disabled).toBe(true);
    endpoint.value = 'https://api.example.com';
    endpoint.oninput();
    expect(next.disabled).toBe(true);
    model.value = 'gpt-4o-mini';
    model.oninput();
    expect(next.disabled).toBe(false);
  });

  it('未知供应商保持隐藏', () => {
    const next = setup();

    mod._showProviderConfig('unknown', next);

    expect(document.getElementById('v-island-onboarding-config').style.display).toBe('none');
  });

  it('配置容器缺失时安全返回', () => {
    document.body.innerHTML = '';

    expect(() => mod._showProviderConfig('zhipu')).not.toThrow();
  });
});

describe('_saveProviderSelection', () => {
  it('空选择不写入', () => {
    mod._saveProviderSelection(null);

    expect(saveAIConfigMock).not.toHaveBeenCalled();
  });

  it('预置供应商写入 Key 与模型并清理自定义字段', () => {
    document.body.innerHTML = `
      <input id="v-island-onboarding-key" value=" secret ">
      <select id="v-island-onboarding-model"><option value="glm-4" selected></option></select>
    `;
    getAIConfigMock.mockReturnValue({ endpoint: 'old', apiFormat: 'openai' });

    mod._saveProviderSelection('zhipu');

    expect(saveAIConfigMock).toHaveBeenCalledWith({
      provider: 'zhipu',
      apiKey: 'secret',
      model: 'glm-4',
    });
  });

  it('自定义供应商写入完整配置', () => {
    document.body.innerHTML = `
      <input id="v-island-onboarding-endpoint" value=" https://api.example.com ">
      <select id="v-island-onboarding-format"><option value="anthropic" selected></option></select>
      <input id="v-island-onboarding-key" value=" k ">
      <input id="v-island-onboarding-model" value=" model-x ">
    `;

    mod._saveProviderSelection('custom');

    expect(saveAIConfigMock).toHaveBeenCalledWith({
      provider: 'custom',
      endpoint: 'https://api.example.com',
      apiFormat: 'anthropic',
      apiKey: 'k',
      model: 'model-x',
    });
  });

  it('缺少输入项时使用空值', () => {
    document.body.innerHTML = '';

    mod._saveProviderSelection('openai');

    expect(saveAIConfigMock).toHaveBeenCalledWith({ provider: 'openai', apiKey: '', model: '' });
  });
});

describe('_initToggle', () => {
  function setupToggle(checked = false) {
    document.body.innerHTML = '<input type="checkbox" id="vIsland">';
    const el = document.getElementById('vIsland');
    el.checked = checked;
    return el;
  }

  it('元素不存在时返回 false', () => {
    expect(mod._initToggle()).toBe(false);
  });

  it('恢复保存的开启状态', () => {
    localStorage.setItem('vIsland-enabled', 'true');
    const el = setupToggle();

    expect(mod._initToggle()).toBe(true);

    expect(el.checked).toBe(true);
    expect(document.body.classList.contains('v-island-enabled')).toBe(true);
  });

  it('已启用且完成引导时启动语音助手', () => {
    localStorage.setItem('vIsland-enabled', 'true');
    localStorage.setItem('v-island-onboarding-complete', 'true');
    setupToggle();

    mod._initToggle();

    expect(startVoiceMock).toHaveBeenCalled();
  });

  it('重复初始化不会重复绑定', () => {
    const el = setupToggle();
    mod._initToggle();

    expect(mod._initToggle()).toBe(true);
    expect(el._vIslandBound).toBe(true);
  });

  it('开启时保存状态并延迟展示引导', async () => {
    const el = setupToggle();
    mod._initToggle();

    el.checked = true;
    el.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(800);

    expect(localStorage.getItem('vIsland-enabled')).toBe('true');
    expect(document.body.classList.contains('v-island-enabled')).toBe(true);
    expect(ensureHoverMock).toHaveBeenCalled();
    expect(previewMock).toHaveBeenCalled();
    expect(document.getElementById('v-island-onboarding')).not.toBeNull();
  });

  it('开启且已完成引导时直接启动语音助手', () => {
    localStorage.setItem('v-island-onboarding-complete', 'true');
    const el = setupToggle();
    mod._initToggle();

    el.checked = true;
    el.dispatchEvent(new Event('change'));

    expect(startVoiceMock).toHaveBeenCalled();
    expect(document.getElementById('v-island-onboarding')).toBeNull();
  });

  it('关闭时清理状态与语音', () => {
    localStorage.setItem('vIsland-enabled', 'true');
    const el = setupToggle(true);
    mod._initToggle();
    document.body.classList.add('v-island-enabled');

    el.checked = false;
    el.dispatchEvent(new Event('change'));

    expect(localStorage.getItem('vIsland-enabled')).toBe('false');
    expect(document.body.classList.contains('v-island-enabled')).toBe(false);
    expect(stopWakeMock).toHaveBeenCalled();
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(dismissMock).toHaveBeenCalled();
  });
});
