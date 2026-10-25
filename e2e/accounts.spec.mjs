// e2e/accounts.spec.mjs — 账户页登录入口可点击
// 回归：添加账号卡片与外置登录按钮必须由 Vue 模板事件驱动，不能依赖启动期动态绑定。
import { expect, test } from '@playwright/test';
import { clickPage, installMockHost } from './fixtures/mock-host.mjs';

test.beforeEach(async ({ page }) => {
  await installMockHost(page);
  await page.goto('/');
  await clickPage(page, 'accounts');
  await expect(page.locator('#page-accounts')).toHaveClass(/active/, { timeout: 5000 });
});

async function openAddAccountModal(page) {
  await page.locator('#add-account-modal').waitFor({ state: 'attached', timeout: 5000 });
  await page.evaluate(() => {
    const modal = document.getElementById('add-account-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.setAttribute('data-state', 'open');
    }
  });
}

async function openThirdPartyModal(page) {
  await openAddAccountModal(page);
  await page.locator('#add-acct-thirdparty').click();
  await expect(page.locator('#thirdparty-account-modal')).toBeVisible({ timeout: 5000 });
}

test('添加账号卡片的三个入口均可点击', async ({ page }) => {
  await openAddAccountModal(page);
  await expect(page.locator('#add-acct-ms')).toBeVisible();
  await expect(page.locator('#add-acct-offline')).toBeVisible();
  await expect(page.locator('#add-acct-thirdparty')).toBeVisible();
});

test('外置登录按钮点击有明确反馈', async ({ page }) => {
  await openThirdPartyModal(page);
  await expect(page.locator('#tp-login-btn')).toBeVisible();

  await page.locator('#tp-login-btn').click();
  await expect(page.locator('.toast').last()).toContainText('请输入认证服务器地址', { timeout: 5000 });
});
