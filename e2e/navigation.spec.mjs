// e2e/navigation.spec.mjs — 全页面导航冒烟
// 验证每个导航入口都能切换到对应页面，且没有引用/类型级脚本错误。
import { expect, test } from '@playwright/test';
import { activePageId, clickPage, installMockHost } from './fixtures/mock-host.mjs';

const PAGES = [
  'home',
  'versions',
  'mods',
  'modpacks',
  'datapacks',
  'resourcepacks',
  'shaders',
  'lan-terracotta',
  'lan-portmap',
  'lan-enderlink',
  'private-server',
  'toolbox',
  'accounts',
  'settings-launch',
  'settings-personalize',
  'settings-other',
  'java',
  'plugins',
  'cloud',
  'feedback',
];

test.beforeEach(async ({ page }) => {
  await installMockHost(page);
});

test('全部导航页面可打开且无致命脚本错误', async ({ page }) => {
  const fatal = [];
  page.on('pageerror', (error) => {
    if (/ReferenceError|TypeError|is not defined|is not a function/.test(error.message)) {
      fatal.push(error.message);
    }
  });

  await page.goto('/');
  await expect(page.locator('#static-icons-root')).toHaveCount(1);

  for (const name of PAGES) {
    await clickPage(page, name);
    await expect
      .poll(() => activePageId(page), { timeout: 5000, message: `页面 ${name} 未激活` })
      .toBe(`page-${name}`);
  }

  // 回到主页：布局应在可见后应用完成，控件不能被布局占位类隐藏
  await clickPage(page, 'home');
  await expect(page.locator('.home-page')).not.toHaveClass(/home-layout-pending/, { timeout: 5000 });
  await expect(page.locator('#home-launch-btn')).toBeVisible();

  expect(fatal).toEqual([]);
});
