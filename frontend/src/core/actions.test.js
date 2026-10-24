// @vitest-environment jsdom
// core/actions.test.js — data-action 事件委托单元测试
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  actionAttrs,
  actionAttrsStop,
  installActionDelegation,
  registerActions,
} from './actions.js';

const received = [];
let stopped = false;

beforeAll(() => {
  registerActions({
    'test-basic': (event, el, ...args) => {
      received.push({ id: el.id, args });
    },
    'test-stop': () => {
      stopped = true;
    },
  });
  installActionDelegation();
});

describe('actionAttrs', () => {
  it('无参数时只输出 data-action', () => {
    expect(actionAttrs('foo')).toBe(' data-action="foo"');
  });

  it('参数序列化为 data-args 并可解析回原值', () => {
    const holder = document.createElement('div');
    holder.innerHTML = `<button id="args-btn" ${actionAttrs('test-basic', 1, 'a"<b').trim()}></button>`;
    const btn = holder.firstElementChild;
    expect(JSON.parse(btn.getAttribute('data-args'))).toEqual([1, 'a"<b']);
  });

  it('actionAttrsStop 同时带上 data-stop', () => {
    const attrs = actionAttrsStop('test-stop');
    expect(attrs).toContain(' data-stop="1"');
    expect(attrs).toContain(' data-action="test-stop"');
  });
});

describe('installActionDelegation', () => {
  it('点击带 data-action 的元素会调用注册函数并传入参数', () => {
    const holder = document.createElement('div');
    holder.innerHTML = `<button id="basic-btn" ${actionAttrs('test-basic', 'x', 2).trim()}></button>`;
    document.body.appendChild(holder);
    holder.querySelector('#basic-btn').click();
    expect(received).toEqual([{ id: 'basic-btn', args: ['x', 2] }]);
    holder.remove();
  });

  it('data-stop 会阻止事件继续冒泡', () => {
    stopped = false;
    const holder = document.createElement('div');
    holder.innerHTML = `<div ${actionAttrsStop('test-stop').trim()}><span id="inner"></span></div>`;
    document.body.appendChild(holder);
    const evt = new MouseEvent('click', { bubbles: true });
    const spy = vi.spyOn(evt, 'stopPropagation');
    holder.querySelector('#inner').dispatchEvent(evt);
    expect(stopped).toBe(true);
    expect(spy).toHaveBeenCalled();
    holder.remove();
  });

  it('未注册动作只警告、不抛错', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const holder = document.createElement('div');
    holder.innerHTML = `<button id="missing-btn" ${actionAttrs('missing-action').trim()}></button>`;
    document.body.appendChild(holder);
    expect(() => holder.querySelector('#missing-btn').click()).not.toThrow();
    expect(warn).toHaveBeenCalledWith('[actions] 未注册的动作: missing-action');
    warn.mockRestore();
    holder.remove();
  });
});
