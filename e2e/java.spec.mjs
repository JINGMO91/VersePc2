// e2e/java.spec.mjs — Java 管理页空列表渲染
import { expect, test } from '@playwright/test';
import { activePageId, clickPage, installMockHost } from './fixtures/mock-host.mjs';

test.beforeEach(async ({ page }) => {
  await installMockHost(page, {
    apiRoutes: {
      '/api/java/installed': { java: [], currentJavaPath: '', detecting: false },
      '/api/java/download-sources': {},
    },
  });
});

test('Java 页可打开并显示未检测到 Java', async ({ page }) => {
  const fatal = [];
  page.on('pageerror', (error) => {
    if (/ReferenceError|TypeError|is not defined|is not a function/.test(error.message)) {
      fatal.push(error.message);
    }
  });

  await page.goto('/');
  await clickPage(page, 'java');
  await expect.poll(() => activePageId(page)).toBe('page-java');

  await expect(page.locator('#refresh-java-btn')).toBeVisible();
  await expect
    .poll(() => page.locator('#installed-java-list').innerText(), { timeout: 5000 })
    .toContain('未检测到已安装的Java');
  expect(fatal).toEqual([]);
});
