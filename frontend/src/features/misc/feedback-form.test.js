// @vitest-environment jsdom
// feedback-form.test.js — 反馈表单交互、验证码、签名与站点提交单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  toast,
  renderFilesMock,
  collectLogsMock,
  renderAutoLogsMock,
  getFormMock,
  validateMock,
  updateStateMock,
  setSubmittingMock,
  bridgeMock,
} = vi.hoisted(() => ({
  toast: vi.fn(),
  renderFilesMock: vi.fn(),
  collectLogsMock: vi.fn(),
  renderAutoLogsMock: vi.fn(),
  getFormMock: vi.fn(),
  validateMock: vi.fn(),
  updateStateMock: vi.fn(),
  setSubmittingMock: vi.fn(),
  bridgeMock: { openExternal: vi.fn(async () => {}) },
}));

vi.mock('./ui-components.js', () => ({ showToast: toast }));
vi.mock('./feedback-attachments.js', () => ({ renderFeedbackFiles: renderFilesMock }));
vi.mock('./feedback-logs.js', () => ({
  collectAutoLogs: collectLogsMock,
  renderAutoLogFiles: renderAutoLogsMock,
}));
vi.mock('./feedback-validate.js', () => ({
  getFeedbackForm: getFormMock,
  validateFeedback: validateMock,
  updateFeedbackSubmitState: updateStateMock,
  setFeedbackSubmitting: setSubmittingMock,
}));
vi.mock('../../core/tauri-bridge.js', () => ({ bridge: bridgeMock }));

let mod;
let feedbackState;
let FEEDBACK_SITE_URL;

function buildDom() {
  document.body.innerHTML = `
    <div id="fb-type-group">
      <button class="fb-type-btn active" data-type="bug"></button>
      <button class="fb-type-btn" data-type="feature"></button>
      <button class="fb-type-btn" data-type="other"></button>
    </div>
    <div id="fb-category-group">
      <button class="fb-category-btn" data-cat="launch"></button>
      <button class="fb-category-btn active" data-cat="other"></button>
    </div>
    <input id="fb-title">
    <textarea id="fb-detail"></textarea>
    <input id="fb-contact">
    <input id="fb-captcha-input">
    <div id="fb-detail-counter"></div>
    <div id="fb-captcha-image"></div>
    <div id="fb-captcha-group" hidden></div>
    <div id="fb-auto-log-tip"></div>
    <div id="fb-auto-log-badge" hidden></div>
    <input type="checkbox" id="fb-include-env" checked>
    <button id="fb-submit-btn"></button>
    <div id="fb-submit-hint"></div>
  `;
}

function validForm(overrides = {}) {
  return {
    type: 'bug',
    typeLabel: '问题反馈',
    category: 'launch',
    categoryLabel: '启动问题',
    title: '  登录失败  ',
    detail: '  启动后立即崩溃，无法进入游戏  ',
    contact: '  a@b.com  ',
    captcha: '  1234  ',
    ...overrides,
  };
}

function defaultFetch() {
  return vi.fn(async (url, options) => {
    if (url.endsWith('/api/feedback/captcha')) {
      return { ok: true, json: async () => ({ id: 'cap-1', svg: '<svg>captcha</svg>' }) };
    }
    if (url.endsWith('/api/feedback/signinfo')) {
      return { ok: true, json: async () => ({ key: 'ab12' }) };
    }
    if (options && options.method === 'POST') {
      return { ok: true, status: 200 };
    }
    return { ok: true, json: async () => ({}) };
  });
}

beforeAll(async () => {
  vi.resetModules();
  ({ feedbackState, FEEDBACK_SITE_URL } = await import('./feedback-state.js'));
  mod = await import('./feedback-form.js');
});

beforeEach(() => {
  buildDom();
  feedbackState.type = 'bug';
  feedbackState.category = 'other';
  feedbackState.files = [];
  feedbackState.autoLogs = [];
  feedbackState.env = null;
  feedbackState.submitting = false;
  feedbackState.captchaId = '';
  feedbackState.signKey = '';
  toast.mockClear();
  renderFilesMock.mockClear();
  collectLogsMock.mockClear();
  renderAutoLogsMock.mockClear();
  updateStateMock.mockClear();
  setSubmittingMock.mockClear();
  setSubmittingMock.mockImplementation((value) => { feedbackState.submitting = value; });
  getFormMock.mockReset();
  getFormMock.mockReturnValue(validForm());
  validateMock.mockReset();
  validateMock.mockReturnValue('');
  bridgeMock.openExternal.mockReset();
  bridgeMock.openExternal.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', defaultFetch());
  let seed = 0;
  vi.stubGlobal('crypto', {
    getRandomValues: (array) => {
      for (let i = 0; i < array.length; i++) array[i] = (seed++ + i) % 256;
      return array;
    },
    subtle: {
      importKey: vi.fn(async () => 'key'),
      sign: vi.fn(async () => new Uint8Array([0xab, 0xcd]).buffer),
    },
  });
  vi.spyOn(window, 'open').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('类型与分类选择', () => {
  it('空按钮安全返回', () => {
    expect(() => mod.selectFeedbackType(null)).not.toThrow();
    expect(() => mod.selectFeedbackCategory(null)).not.toThrow();
  });

  it('切换类型并刷新提交状态', () => {
    const btn = document.querySelector('.fb-type-btn[data-type="feature"]');

    mod.selectFeedbackType(btn);

    expect(feedbackState.type).toBe('feature');
    expect(btn.classList.contains('active')).toBe(true);
    expect(document.querySelector('.fb-type-btn[data-type="bug"]').classList.contains('active')).toBe(false);
    expect(updateStateMock).toHaveBeenCalled();
  });

  it('未提供类型时使用 other', () => {
    const btn = document.createElement('button');

    mod.selectFeedbackType(btn);

    expect(feedbackState.type).toBe('other');
  });

  it('切换分类会清空并重新收集日志', () => {
    const btn = document.querySelector('.fb-category-btn[data-cat="launch"]');
    feedbackState.autoLogs = [{ name: 'old.log' }];

    mod.selectFeedbackCategory(btn);

    expect(feedbackState.category).toBe('launch');
    expect(feedbackState.autoLogs).toEqual([]);
    expect(renderAutoLogsMock).toHaveBeenCalled();
    expect(collectLogsMock).toHaveBeenCalled();
    expect(updateStateMock).toHaveBeenCalled();
  });

  it('缺少分组容器时仍更新状态', () => {
    document.getElementById('fb-type-group').remove();
    document.getElementById('fb-category-group').remove();

    mod.selectFeedbackType({ dataset: { type: 'bug' }, classList: { add: vi.fn() } });
    mod.selectFeedbackCategory({ dataset: { cat: 'download' }, classList: { add: vi.fn() } });

    expect(feedbackState.type).toBe('bug');
    expect(feedbackState.category).toBe('download');
  });
});

describe('onFeedbackDetailInput', () => {
  it('更新字数统计并刷新提交状态', () => {
    document.getElementById('fb-detail').value = 'hello';

    mod.onFeedbackDetailInput();

    expect(document.getElementById('fb-detail-counter').textContent).toBe('5 / 2000');
    expect(updateStateMock).toHaveBeenCalled();
  });

  it('计数器缺失时安全返回', () => {
    document.getElementById('fb-detail-counter').remove();

    expect(() => mod.onFeedbackDetailInput()).not.toThrow();
    expect(updateStateMock).toHaveBeenCalled();
  });
});

describe('验证码', () => {
  it('加载验证码与签名密钥', async () => {
    await mod.loadFeedbackCaptcha();

    expect(feedbackState.captchaId).toBe('cap-1');
    expect(feedbackState.signKey).toBe('ab12');
    expect(document.getElementById('fb-captcha-image').innerHTML).toBe('<svg>captcha</svg>');
    expect(document.getElementById('fb-captcha-group').hidden).toBe(false);
    expect(updateStateMock).toHaveBeenCalled();
  });

  it('已有签名密钥时跳过 signinfo', async () => {
    feedbackState.signKey = 'existing';

    await mod.loadFeedbackCaptcha();

    const urls = fetch.mock.calls.map((call) => call[0]);
    expect(urls.some((url) => url.includes('/signinfo'))).toBe(false);
  });

  it('接口失败时静默并继续刷新状态', async () => {
    fetch.mockRejectedValue(new Error('offline'));

    await expect(mod.loadFeedbackCaptcha()).resolves.toBeUndefined();
    expect(updateStateMock).toHaveBeenCalled();
  });

  it('刷新按钮重新加载', async () => {
    mod.refreshFeedbackCaptcha();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledWith(FEEDBACK_SITE_URL + '/api/feedback/captcha', expect.any(Object));
  });

  it('HTTP 状态异常抛出', async () => {
    fetch.mockResolvedValue({ ok: false, status: 502 });

    await expect(mod.fetchFeedbackJson('https://x')).rejects.toThrow('HTTP 502');
  });

  it('成功时返回 JSON', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ a: 1 }) });

    await expect(mod.fetchFeedbackJson('https://x')).resolves.toEqual({ a: 1 });
  });
});

describe('resetFeedbackForm', () => {
  it('清空字段并恢复默认类型与分类', () => {
    document.getElementById('fb-title').value = 't';
    document.getElementById('fb-detail').value = 'd';
    document.getElementById('fb-contact').value = 'c';
    document.getElementById('fb-captcha-input').value = 'x';
    feedbackState.type = 'feature';
    feedbackState.category = 'launch';
    feedbackState.files = [{ name: 'a' }];
    feedbackState.autoLogs = [{ name: 'b' }];
    document.getElementById('fb-auto-log-badge').hidden = false;
    document.getElementById('fb-auto-log-tip').className = 'x';

    mod.resetFeedbackForm();

    expect(document.getElementById('fb-title').value).toBe('');
    expect(document.getElementById('fb-detail').value).toBe('');
    expect(document.getElementById('fb-contact').value).toBe('');
    expect(document.getElementById('fb-captcha-input').value).toBe('');
    expect(feedbackState.files).toEqual([]);
    expect(feedbackState.autoLogs).toEqual([]);
    expect(feedbackState.type).toBe('bug');
    expect(feedbackState.category).toBe('other');
    expect(document.querySelector('.fb-type-btn[data-type="bug"]').classList.contains('active')).toBe(true);
    expect(document.querySelector('.fb-category-btn[data-cat="other"]').classList.contains('active')).toBe(true);
    expect(document.getElementById('fb-auto-log-badge').hidden).toBe(true);
    expect(document.getElementById('fb-auto-log-tip').className).toBe('fb-auto-log-tip');
    expect(renderFilesMock).toHaveBeenCalled();
    expect(renderAutoLogsMock).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });

  it('字段与分组缺失时安全返回', () => {
    ['fb-title', 'fb-detail', 'fb-contact', 'fb-captcha-input', 'fb-type-group', 'fb-category-group', 'fb-auto-log-tip', 'fb-auto-log-badge'].forEach((id) => {
      document.getElementById(id).remove();
    });

    expect(() => mod.resetFeedbackForm()).not.toThrow();
  });
});

describe('submitFeedback', () => {
  it('正在提交时忽略重复点击', async () => {
    feedbackState.submitting = true;

    await mod.submitFeedback();

    expect(validateMock).not.toHaveBeenCalled();
  });

  it('校验失败时提示并刷新状态', async () => {
    validateMock.mockReturnValue('请填写反馈标题');

    await mod.submitFeedback();

    expect(updateStateMock).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('请填写反馈标题', 'error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('提交成功后重置并再次加载验证码', async () => {
    feedbackState.signKey = 'ab12';
    feedbackState.captchaId = 'cap-1';
    feedbackState.env = { launcher: '0.5', system: 'Windows', java: '17' };
    feedbackState.autoLogs = [{ name: 'launch.log', file: new Blob(['log']) }];
    feedbackState.files = [{ name: 'shot.png', file: new Blob(['img']) }];

    await mod.submitFeedback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setSubmittingMock).toHaveBeenNthCalledWith(1, true);
    expect(setSubmittingMock).toHaveBeenNthCalledWith(2, false);
    expect(document.getElementById('fb-title').value).toBe('');
    expect(toast).toHaveBeenCalledWith('反馈已提交，感谢你的反馈！', 'success');
    expect(fetch.mock.calls.filter((call) => call[1] && call[1].method === 'POST')).toHaveLength(1);
  });

  it('提交失败时清空验证码并刷新', async () => {
    feedbackState.signKey = 'ab12';
    feedbackState.captchaId = 'cap-1';
    fetch.mockImplementation(async (url, options) => {
      if (url.endsWith('/api/feedback/captcha')) return { ok: true, json: async () => ({ id: 'new', svg: 's' }) };
      if (options && options.method === 'POST') return { ok: false, status: 400, json: async () => ({ error: 'captcha incorrect' }) };
      return { ok: true, json: async () => ({}) };
    });
    document.getElementById('fb-captcha-input').value = '1234';

    await mod.submitFeedback();
    await Promise.resolve();
    await Promise.resolve();

    expect(feedbackState.submitting).toBe(false);
    expect(document.getElementById('fb-captcha-input').value).toBe('');
    expect(toast).toHaveBeenCalledWith('验证码不正确，请点击验证码刷新后重试', 'error');
    expect(updateStateMock).toHaveBeenCalled();
  });

  it('429 时提示次日再试', async () => {
    feedbackState.signKey = 'ab12';
    fetch.mockImplementation(async (url, options) => {
      if (url.endsWith('/api/feedback/captcha')) return { ok: true, json: async () => ({}) };
      if (options && options.method === 'POST') return { ok: false, status: 429, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    });

    await mod.submitFeedback();
    await Promise.resolve();

    expect(toast).toHaveBeenCalledWith('今日已提交过反馈，请明日再试', 'error');
  });

  it('无错误消息时使用默认文案', async () => {
    feedbackState.signKey = '';

    await mod.submitFeedback();

    expect(toast).toHaveBeenCalledWith('验证码与签名信息尚未就绪，请稍后重试', 'error');
    expect(feedbackState.submitting).toBe(false);
  });
});

describe('sendFeedbackToSite', () => {
  function payload(overrides = {}) {
    return {
      category: 'launch',
      categoryLabel: '启动问题',
      title: '标题',
      detail: '详细描述',
      contact: 'a@b.com',
      captcha: '1234',
      env: null,
      autoLogs: [],
      files: [],
      ...overrides,
    };
  }

  it('签名未就绪时拒绝提交', async () => {
    feedbackState.signKey = '';

    await expect(mod.sendFeedbackToSite(payload())).rejects.toThrow('验证码与签名信息尚未就绪，请稍后重试');
  });

  it('组装表单字段、环境信息与文件', async () => {
    feedbackState.signKey = 'ab12';
    feedbackState.captchaId = 'cap-9';
    const autoLogs = Array.from({ length: 8 }, (_, i) => ({ name: 'log' + i + '.txt', file: new Blob(['l']) }));
    const files = Array.from({ length: 5 }, (_, i) => ({ name: 'shot' + i + '.png', file: new Blob(['s']) }));

    await expect(mod.sendFeedbackToSite(payload({
      env: { launcher: '0.5', system: 'Win', java: '17' },
      autoLogs,
      files: files.slice(0, 3),
    }))).resolves.toBe(true);

    const formData = fetch.mock.calls.at(-1)[1].body;
    expect(formData.get('client')).toBe('versepc2');
    expect(formData.get('title')).toBe('标题');
    expect(formData.get('description')).toContain('【环境信息】启动器：0.5；操作系统：Win；Java：17');
    expect(formData.get('category')).toBe('启动问题');
    expect(formData.get('email')).toBe('a@b.com');
    expect(formData.get('captchaId')).toBe('cap-9');
    expect(formData.get('captchaAnswer')).toBe('1234');
    expect(formData.get('sig')).toBe('abcd');
    expect(formData.get('file0')).toBeTruthy();
  });

  it('超过附件上限时只保留前十个', async () => {
    feedbackState.signKey = 'ab12';
    feedbackState.captchaId = 'cap';
    const autoLogs = Array.from({ length: 6 }, (_, i) => ({ name: 'log' + i, file: new Blob(['a']) }));
    const files = Array.from({ length: 8 }, (_, i) => ({ name: 'file' + i, file: new Blob(['b']) }));

    await mod.sendFeedbackToSite(payload({ autoLogs, files }));

    const formData = fetch.mock.calls.at(-1)[1].body;
    const appended = [...formData.keys()].filter((key) => key.startsWith('file'));
    expect(appended).toHaveLength(10);
  });

  it('429 响应抛出每日限制错误', async () => {
    feedbackState.signKey = 'ab12';
    fetch.mockResolvedValue({ ok: false, status: 429 });

    const error = await mod.sendFeedbackToSite(payload()).catch((e) => e);

    expect(error.status).toBe(429);
    expect(error.dailyLimit).toBe(true);
  });

  it.each([
    ['captcha incorrect', '验证码不正确，请点击验证码刷新后重试'],
    ['invalid signature', '提交校验失败，请刷新验证码后重试'],
    ['replay denied', '请勿重复提交，请刷新验证码后重试'],
  ])('错误码 %s 映射为对应提示', async (code, message) => {
    feedbackState.signKey = 'ab12';
    fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: code }) });

    await expect(mod.sendFeedbackToSite(payload())).rejects.toThrow(message);
  });

  it('响应体不可解析时使用状态码文案', async () => {
    feedbackState.signKey = 'ab12';
    fetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('bad'); } });

    await expect(mod.sendFeedbackToSite(payload())).rejects.toThrow('提交失败（500），请稍后重试');
  });

  it('空环境信息不追加描述', async () => {
    feedbackState.signKey = 'ab12';
    feedbackState.captchaId = 'cap';

    await mod.sendFeedbackToSite(payload());

    expect(fetch.mock.calls.at(-1)[1].body.get('description')).toBe('详细描述');
  });
});

describe('签名与编码工具', () => {
  it('HMAC 输出十六进制', async () => {
    await expect(mod.hmacFeedbackSha256('zz-ab-cd', 'msg')).resolves.toBe('abcd');
    expect(crypto.subtle.importKey).toHaveBeenCalledWith(
      'raw',
      new Uint8Array([0xab, 0xcd]),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  });

  it('hexToBytes 过滤非法字符', () => {
    expect(Array.from(mod.hexToBytes('zz 0a-FF!!'))).toEqual([0x0a, 0xff]);
    expect(mod.hexToBytes('').length).toBe(0);
  });

  it('bytesToHex 补零', () => {
    expect(mod.bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });

  it('nonce 为 8-32 位字母数字', () => {
    const nonce = mod.randomFeedbackNonce();

    expect(nonce).toMatch(/^[0-9a-z]+$/);
    expect(nonce.length).toBeGreaterThanOrEqual(8);
    expect(nonce.length).toBeLessThanOrEqual(32);
  });
});

describe('openFeedbackSite', () => {
  it('优先调用桥接层打开外部浏览器', () => {
    mod.openFeedbackSite();

    expect(bridgeMock.openExternal).toHaveBeenCalledWith(FEEDBACK_SITE_URL);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('桥接层异常被吞掉', async () => {
    bridgeMock.openExternal.mockRejectedValue(new Error('no'));

    expect(() => mod.openFeedbackSite()).not.toThrow();
    await Promise.resolve();
  });

  it('无桥接能力时回退 window.open', () => {
    delete bridgeMock.openExternal;

    mod.openFeedbackSite();

    expect(window.open).toHaveBeenCalledWith(FEEDBACK_SITE_URL, '_blank');
    bridgeMock.openExternal = vi.fn(async () => {});
  });
});
