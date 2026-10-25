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

test('主页布局编辑需要显式进入并确认，默认不再显示存档卡片', async ({ page }) => {
  await page.goto('/');
  await clickPage(page, 'home');
  await expect(page.locator('.home-page')).not.toHaveClass(/home-layout-pending/, { timeout: 5000 });

  // 存档卡片已从主页移除
  await expect(page.locator('.home-save-dock')).toHaveCount(0);

  // 默认只能看到「编辑布局」，启动按钮可用
  await expect(page.locator('#home-edit-layout-btn')).toBeVisible();
  await expect(page.locator('#home-launch-btn')).not.toHaveClass(/home-launch-btn-locked/);

  await page.locator('#home-edit-layout-btn').click();
  await expect(page.locator('.home-page')).toHaveClass(/home-editing/);
  await expect(page.locator('#home-edit-confirm-btn')).toBeVisible();
  await expect(page.locator('#home-edit-cancel-btn')).toBeVisible();
  await expect(page.locator('#home-launch-btn')).toHaveClass(/home-launch-btn-locked/);
  await expect(page.locator('#home-launch-btn')).toHaveAttribute('aria-disabled', 'true');

  // 取消后回到普通模式，编辑按钮重新出现
  await page.locator('#home-edit-cancel-btn').click();
  await expect(page.locator('.home-page')).not.toHaveClass(/home-editing/);
  await expect(page.locator('#home-edit-layout-btn')).toBeVisible();

  // 普通模式下启动按钮不能因为鼠标靠近而移动（原“避让鼠标”问题回归）
  const staticBefore = await page.locator('#home-launch-btn').boundingBox();
  await page.mouse.move(staticBefore.x + staticBefore.width / 2 - 60, staticBefore.y + staticBefore.height / 2);
  await page.waitForTimeout(250);
  const staticAfter = await page.locator('#home-launch-btn').boundingBox();
  expect(Math.hypot(staticAfter.x - staticBefore.x, staticAfter.y - staticBefore.y)).toBeLessThan(1);

  // 按下启动按钮时中心不能横向跳走（原“避让鼠标”问题回归）
  const downBefore = await page.locator('#home-launch-btn').boundingBox();
  await page.mouse.move(downBefore.x + downBefore.width / 2, downBefore.y + downBefore.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  const downDuring = await page.locator('#home-launch-btn').boundingBox();
  // 移到按钮外再松开，避免真正触发启动
  await page.mouse.move(downBefore.x - 30, downBefore.y - 30);
  await page.mouse.up();
  const beforeCenter = downBefore.x + downBefore.width / 2;
  const duringCenter = downDuring.x + downDuring.width / 2;
  expect(Math.abs(duringCenter - beforeCenter)).toBeLessThan(3);

  // 重新进入并确认，启动按钮恢复可用
  await page.locator('#home-edit-layout-btn').click();
  await page.locator('#home-edit-confirm-btn').click();
  await expect(page.locator('.home-page')).not.toHaveClass(/home-editing/);
  await expect(page.locator('#home-launch-btn')).not.toHaveClass(/home-launch-btn-locked/);
});

test('主页布局拖动只有确认后才写入存储，取消会还原', async ({ page }) => {
  await page.goto('/');
  await clickPage(page, 'home');
  await expect(page.locator('.home-page')).not.toHaveClass(/home-layout-pending/, { timeout: 5000 });

  const before = await page.evaluate(() => localStorage.getItem('versepc_home_layout_v1'));

  // 编辑模式下拖动头像
  const dragAvatar = async () => {
    const box = await page.locator('.home-avatar-widget').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2 + 32, { steps: 6 });
    await page.mouse.up();
  };

  await page.locator('#home-edit-layout-btn').click();
  await dragAvatar();
  // 未确认：存储不变
  expect(await page.evaluate(() => localStorage.getItem('versepc_home_layout_v1'))).toBe(before);
  await page.locator('#home-edit-cancel-btn').click();
  expect(await page.evaluate(() => localStorage.getItem('versepc_home_layout_v1'))).toBe(before);

  // 再次编辑并确认：位置写入存储
  await page.locator('#home-edit-layout-btn').click();
  await dragAvatar();
  await page.locator('#home-edit-confirm-btn').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('versepc_home_layout_v1') || '{}'));
  expect(saved.avatar).toBeTruthy();
  expect(Number.isFinite(saved.avatar.x)).toBe(true);
  expect(Number.isFinite(saved.avatar.y)).toBe(true);
});
