// e2e/cloud.spec.mjs — 云盘登录表单交互
import { expect, test } from '@playwright/test';
import { activePageId, clickPage, installMockHost } from './fixtures/mock-host.mjs';

test.beforeEach(async ({ page }) => {
  await installMockHost(page);
});

test('云盘未登录时展示登录表单并按输入启用按钮', async ({ page }) => {
  const fatal = [];
  page.on('pageerror', (error) => {
    if (/ReferenceError|TypeError|is not defined|is not a function/.test(error.message)) {
      fatal.push(error.message);
    }
  });

  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('verse-cloud-token');
    localStorage.removeItem('verse-cloud-name');
    localStorage.removeItem('verse-cloud-uid');
  });
  await clickPage(page, 'cloud');
  await expect.poll(() => activePageId(page)).toBe('page-cloud');

  await expect(page.locator('#cloud-login-card')).toBeVisible();
  const loginButton = page.locator('#cloud-login-btn');
  await expect(loginButton).toBeDisabled();

  await page.locator('#cloud-uid').fill('1234');
  await page.locator('#cloud-password').fill('secret');
  await expect(loginButton).toBeEnabled();
  expect(fatal).toEqual([]);
});
