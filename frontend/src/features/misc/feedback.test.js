// @vitest-environment jsdom
// feedback.test.js — 反馈表单纯逻辑单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bytesToHex,
  escapeFeedbackText,
  feedbackState,
  formatFeedbackSize,
  hexToBytes,
  randomFeedbackNonce,
  updateFeedbackSubmitState,
  validateFeedback,
} from './feedback.js';

beforeEach(() => {
  document.body.innerHTML = '';
  feedbackState.submitting = false;
});

describe('formatFeedbackSize', () => {
  it('按 B/KB/MB 分档', () => {
    expect(formatFeedbackSize(512)).toBe('512 B');
    expect(formatFeedbackSize(1536)).toBe('1.5 KB');
    expect(formatFeedbackSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('escapeFeedbackText', () => {
  it('转义 HTML 并处理空值', () => {
    expect(escapeFeedbackText('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
    expect(escapeFeedbackText(null)).toBe('');
    expect(escapeFeedbackText(undefined)).toBe('');
  });
});

describe('validateFeedback', () => {
  const form = (title, detail) => ({ title, detail, captcha: '' });

  it('标题与描述为空或过短时返回提示', () => {
    expect(validateFeedback(form('', '足够长的描述内容'))).toBe('请填写反馈标题');
    expect(validateFeedback(form('abc', '足够长的描述内容'))).toBe('标题太短，请至少填写 4 个字');
    expect(validateFeedback(form('有效的标题', ''))).toBe('请填写详细描述');
    expect(validateFeedback(form('有效的标题', '太短'))).toBe('描述太短，请至少填写 10 个字');
  });

  it('合法表单返回空串，验证码区域隐藏时忽略验证码', () => {
    expect(validateFeedback(form('有效的标题', '这是一段足够长的详细描述内容'))).toBe('');
  });
});

describe('updateFeedbackSubmitState', () => {
  function mountForm() {
    document.body.innerHTML = `
      <input id="fb-title" />
      <textarea id="fb-detail"></textarea>
      <button id="fb-submit-btn"></button>
      <div id="fb-submit-hint"></div>
    `;
  }

  it('未填写时禁用提交并显示第一条错误', () => {
    mountForm();
    updateFeedbackSubmitState();
    expect(document.getElementById('fb-submit-btn').disabled).toBe(true);
    expect(document.getElementById('fb-submit-hint').textContent).toBe('请填写反馈标题');
  });

  it('填写完整后启用提交', () => {
    mountForm();
    document.getElementById('fb-title').value = '有效的标题';
    document.getElementById('fb-detail').value = '这是一段足够长的详细描述内容';
    updateFeedbackSubmitState();
    expect(document.getElementById('fb-submit-btn').disabled).toBe(false);
    expect(document.getElementById('fb-submit-hint').textContent).toBe('');
  });

  it('提交中强制禁用按钮', () => {
    mountForm();
    document.getElementById('fb-title').value = '有效的标题';
    document.getElementById('fb-detail').value = '这是一段足够长的详细描述内容';
    feedbackState.submitting = true;
    updateFeedbackSubmitState();
    expect(document.getElementById('fb-submit-btn').disabled).toBe(true);
  });
});

describe('十六进制工具', () => {
  it('字节与十六进制互转并忽略非法字符', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
    expect([...hexToBytes('0a-FF zz')]).toEqual([10, 255]);
  });

  it('随机 nonce 为字母数字且长度在约定范围内', () => {
    const nonce = randomFeedbackNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(8);
    expect(nonce.length).toBeLessThanOrEqual(32);
    expect(nonce).toMatch(/^[0-9a-z]+$/);
  });
});
