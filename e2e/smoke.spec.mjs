// e2e/smoke.spec.mjs — 静态模板与动作冒烟
// 通过 mock Tauri IPC 在普通 Chromium 中加载构建产物，验证启动注入与事件委托。
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd !== 'api_proxy') return null;
        const path = (args && args.path) || '';
        const body = (() => {
          if (path === '/api/settings') return {};
          if (path === '/api/versions') return { versions: [] };
          if (path === '/api/accounts') return { accounts: [], currentAccount: null };
          return {};
        })();
        return { status: 200, body };
      },
    };
  });
});

test('静态资源注入与弹窗动作', async ({ page }) => {
  const pageErrors = [];
  const actionWarnings = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && msg.text().includes('未注册的动作')) {
      actionWarnings.push(msg.text());
    }
  });

  await page.goto('/');
  await expect(page.locator('#static-icons-root #icon-home')).toHaveCount(1);
  await expect(page.locator('#support-modal')).toHaveCount(1);
  await expect(page.locator('#mod-translate-modal')).toHaveCount(1);

  // 支持弹窗：打开后点击“下次一定”
  await page.evaluate(() => {
    const m = document.getElementById('support-modal');
    m.style.display = 'flex';
    m.classList.add('modal-visible');
  });
  await page.locator('[data-action="dismissSupportModal"]').dispatchEvent('click');
  await expect
    .poll(() => page.evaluate(() => document.getElementById('support-modal').style.display))
    .toBe('none');

  // 汉化弹窗：打开后切换标签
  await page.evaluate(() => {
    const m = document.getElementById('mod-translate-modal');
    m.style.display = 'flex';
    m.classList.add('modal-visible');
  });
  await page.locator('[data-action="switchTranslateTab"][data-tab="auto"]').dispatchEvent('click');
  await expect
    .poll(() => page.evaluate(() => document.getElementById('mod-translate-tab-auto').style.display))
    .toBe('');

  expect(actionWarnings).toEqual([]);
  // 允许 mock 缺失导致的网络类错误，但禁止脚本引用/类型错误
  const fatal = pageErrors.filter((m) => /ReferenceError|TypeError|is not defined|is not a function/.test(m));
  expect(fatal).toEqual([]);
});
