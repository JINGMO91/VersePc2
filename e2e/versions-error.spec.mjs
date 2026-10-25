// e2e/versions-error.spec.mjs — 版本列表接口失败的可恢复提示
import { expect, test } from '@playwright/test';
import { clickPage, installMockHost } from './fixtures/mock-host.mjs';

test.beforeEach(async ({ page }) => {
  await installMockHost(page, {
    apiRoutes: {
      '/api/versions': { status: 500, body: { error: 'mock failure' } },
    },
  });
});

test('版本接口失败时显示重试入口且不产生致命错误', async ({ page }) => {
  const fatal = [];
  page.on('pageerror', (error) => {
    if (/ReferenceError|TypeError|is not defined|is not a function/.test(error.message)) {
      fatal.push(error.message);
    }
  });

  await page.goto('/');
  await clickPage(page, 'versions');

  await expect(page.locator('#versions-list')).toContainText('加载版本列表失败');
  await expect(page.locator('#versions-list button')).toBeVisible();
  expect(fatal).toEqual([]);
});
