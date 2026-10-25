// e2e/mods.spec.mjs — 模组页基础渲染与搜索框
import { expect, test } from '@playwright/test';
import { activePageId, clickPage, installMockHost } from './fixtures/mock-host.mjs';

test.beforeEach(async ({ page }) => {
  await installMockHost(page, {
    apiRoutes: {
      '/api/mods': [],
      '/api/mods/search': {
        mods: [
          { id: 'sodium', slug: 'sodium', title: 'Sodium', description: '渲染优化', downloads: 1000 },
        ],
        total: 1,
        offset: 0,
      },
    },
  });
});

test('模组页可打开并展示搜索入口', async ({ page }) => {
  const fatal = [];
  page.on('pageerror', (error) => {
    if (/ReferenceError|TypeError|is not defined|is not a function/.test(error.message)) {
      fatal.push(error.message);
    }
  });

  await page.goto('/');
  await clickPage(page, 'mods');
  await expect.poll(() => activePageId(page)).toBe('page-mods');

  const search = page.locator('#mod-search-input');
  await expect(search).toBeVisible();
  await search.fill('sodium');
  await search.dispatchEvent('input');

  expect(fatal).toEqual([]);
});
