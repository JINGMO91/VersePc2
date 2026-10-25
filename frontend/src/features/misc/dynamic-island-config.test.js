// @vitest-environment jsdom
// dynamic-island-config.test.js — V 岛 AI 配置与请求体构造单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _buildBody,
  _extractReply,
  _friendlyError,
  _getAIConfig,
  _saveAIConfig,
} from './dynamic-island-config.js';

beforeEach(() => {
  localStorage.clear();
});

describe('AI 配置读写', () => {
  it('无配置或非法 JSON 返回空对象', () => {
    expect(_getAIConfig()).toEqual({});
    localStorage.setItem('v-island-ai-config', '{bad');
    expect(_getAIConfig()).toEqual({});
  });

  it('保存后可读回', () => {
    expect(_saveAIConfig({ provider: 'deepseek', apiKey: 'k', model: 'm' })).toBe(true);
    expect(_getAIConfig()).toEqual({ provider: 'deepseek', apiKey: 'k', model: 'm' });
  });
});

describe('_buildBody', () => {
  const messages = [{ role: 'user', content: '你好' }];

  it('OpenAI 格式包含 stream=false', () => {
    expect(_buildBody('openai', 'gpt', messages)).toEqual({
      model: 'gpt',
      messages,
      stream: false,
    });
  });

  it('Anthropic 格式使用 max_tokens', () => {
    expect(_buildBody('anthropic', 'claude', messages)).toEqual({
      model: 'claude',
      messages,
      max_tokens: 1024,
    });
  });

  it('Google 格式把 assistant 映射为 model', () => {
    const body = _buildBody('google', 'gemini', [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'model', parts: [{ text: 'b' }] },
    ]);
  });
});

describe('_extractReply', () => {
  it('解析三种供应商回复', () => {
    expect(_extractReply('openai', { choices: [{ message: { content: 'hi' } }] })).toBe('hi');
    expect(_extractReply('anthropic', { content: [{ text: 'a' }, { text: 'b' }] })).toBe('ab');
    expect(
      _extractReply('google', { candidates: [{ content: { parts: [{ text: 'g' }] } }] }),
    ).toBe('g');
  });

  it('空回复与解析失败有兜底文案', () => {
    expect(_extractReply('openai', { choices: [{ message: { content: '' } }] })).toBe('(空回复)');
    expect(_extractReply('openai', {})).toBe('(解析回复失败)');
  });
});

describe('_friendlyError', () => {
  it('常见状态码映射为可读提示', () => {
    expect(_friendlyError(402, '')).toContain('余额不足');
    expect(_friendlyError(401, '')).toContain('API Key 无效');
    expect(_friendlyError(403, '')).toContain('权限不足');
    expect(_friendlyError(429, '')).toContain('请求过于频繁');
    expect(_friendlyError(404, '')).toContain('接口地址或模型名称');
    expect(_friendlyError(413, '')).toContain('对话内容过长');
    expect(_friendlyError(500, '')).toContain('暂时不可用');
  });

  it('通过错误正文识别额度与限流', () => {
    expect(_friendlyError(0, 'insufficient_quota')).toContain('余额不足');
    expect(_friendlyError(0, 'rate limit exceeded')).toContain('限流');
    expect(_friendlyError(418, 'teapot')).toContain('418');
  });
});
