// core/actions.js — 事件委托动作表
// 动态生成的 HTML 不再写内联 onclick，而是标记 data-action / data-args，
// 由这里统一分发到各模块注册的处理函数，避免依赖 window 全局函数。

const registry = new Map();

// 注册动作：name -> 处理函数
// 处理函数签名统一为 (event, el, ...args)；需要元素的动作先声明 data-el="1"
export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) {
    if (typeof fn === 'function') registry.set(name, fn);
  }
}

// 生成动作属性，供模板字符串拼接使用
export function actionAttrs(name, ...args) {
  let attrs = ` data-action="${name}"`;
  if (args.length) {
    attrs += ` data-args="${escapeHtml(JSON.stringify(args))}"`;
  }
  return attrs;
}

// 同上，附带阻止事件冒泡
export function actionAttrsStop(name, ...args) {
  return ` data-stop="1"` + actionAttrs(name, ...args);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseArgs(el) {
  const raw = el.getAttribute('data-args');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 安装全局 click 委托；只在 document 上监听一次
export function installActionDelegation() {
  document.addEventListener('click', (event) => {
    const el = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!el) return;
    if (el.hasAttribute('data-stop')) event.stopPropagation();
    const name = el.getAttribute('data-action');
    const fn = registry.get(name);
    if (!fn) {
      console.warn(`[actions] 未注册的动作: ${name}`);
      return;
    }
    fn(event, el, ...parseArgs(el));
  });
}
