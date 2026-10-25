// e2e/settings.spec.mjs — 设置页面与个性化开关
import { expect, test } from '@playwright/test';
import { activePageId, clickPage, installMockHost } from './fixtures/mock-host.mjs';

test.beforeEach(async ({ page }) => {
  await installMockHost(page);
});

test('三个设置页面可切换，个性化开关可交互', async ({ page }) => {
  const fatal = [];
  page.on('pageerror', (error) => {
    if (/ReferenceError|TypeError|is not defined|is not a function/.test(error.message)) {
      fatal.push(error.message);
    }
  });

  await page.goto('/');

  for (const name of ['settings-launch', 'settings-personalize', 'settings-other']) {
    await clickPage(page, name);
    await expect.poll(() => activePageId(page)).toBe(`page-${name}`);
  }

  await clickPage(page, 'settings-personalize');
  // 导航栏名称开关只在简约导航模式下显示，先开启简约导航
  const minimalNav = page.locator('#setting-minimal-nav');
  await expect(minimalNav).toBeVisible();
  await minimalNav.check();

  const toggle = page.locator('#setting-nav-hide-labels');
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();

  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(['light', 'dark', 'custom']).toContain(theme);
  expect(fatal).toEqual([]);
});
