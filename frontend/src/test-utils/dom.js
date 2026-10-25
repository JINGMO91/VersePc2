// test-utils/dom.js — jsdom 测试辅助
// 统一挂载 fixture 并清理 DOM/localStorage，避免测试之间互相污染。

/// 挂载 HTML 片段并返回 body
export function mountFixture(html) {
  document.body.innerHTML = html;
  return document.body;
}

/// 清理 DOM 与本地存储
export function resetDom() {
  document.body.innerHTML = '';
  localStorage.clear();
}
