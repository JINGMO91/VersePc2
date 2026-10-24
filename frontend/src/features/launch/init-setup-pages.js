import { API as API } from '../../core/api.js';
import { loadAccounts as loadAccounts, startMsAuth as startMsAuth, closeOfflineModal as closeOfflineModal, closeThirdPartyModal as closeThirdPartyModal, verifyThirdPartyServer as verifyThirdPartyServer, showProfileSelectModal as showProfileSelectModal } from '../accounts/accounts.js';
import { applyAccentColor as applyAccentColor } from './java.js';
import { showToast as showToast, showModal as showModal, hideModal as hideModal, showConfirmDialog as showConfirmDialog } from '../misc/ui-components.js';
import { getDOMElement as getDOMElement, throttle as throttle } from '../misc/utils.js';
import { loadMods as loadMods } from '../mods/mod-browse.js';
import { loadSettings as loadSettings, saveCurrentSettings as saveCurrentSettings } from '../settings/settings-load-save.js';
import { appState as appState } from '../../core/app-state.js';

function setupModBrowse() {
  const modSearchBtn = document.getElementById('mod-search-btn');
  if (!modSearchBtn) return;
  const modSearchInput = document.getElementById('mod-search-input');
  modSearchBtn.addEventListener('click', () => {
    appState.modSearchQuery = modSearchInput ? modSearchInput.value.trim() : '';
    appState.modSearchOffset = 0;
    loadMods();
  });
  if (modSearchInput) modSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      appState.modSearchQuery = e.target.value.trim();
      appState.modSearchOffset = 0;
      loadMods();
    }
  });
  const modPrevBtn = document.getElementById('mod-prev-btn');
  if (modPrevBtn) modPrevBtn.addEventListener('click', () => {
    if (appState.modSearchOffset >= 15) {
      appState.modSearchOffset -= 15;
      loadMods();
    }
  });
  const modNextBtn = document.getElementById('mod-next-btn');
  if (modNextBtn) modNextBtn.addEventListener('click', () => {
    appState.modSearchOffset += 15;
    loadMods();
  });

  const bindFilter = (id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { appState.modSearchOffset = 0; loadMods(); });
  };
  bindFilter('mod-filter-loader');
  bindFilter('mod-filter-version');
  bindFilter('mod-filter-category');
  bindFilter('mod-filter-sort');
  bindFilter('mod-filter-source');
}

function setupAccountButtons() {
  // 旧顶部按钮（兼容旧模板）
  const addMsBtn = document.getElementById('add-ms-account-btn');
  if (addMsBtn) addMsBtn.addEventListener('click', startMsAuth);
  const addThirdPartyBtn = document.getElementById('add-thirdparty-account-btn');
  if (addThirdPartyBtn) addThirdPartyBtn.addEventListener('click', () => {
    showModal('thirdparty-account-modal');
  });
  const addOfflineBtn = document.getElementById('add-offline-account-btn');
  if (addOfflineBtn) addOfflineBtn.addEventListener('click', () => {
    showModal('offline-account-modal');
  });

  // 新版：左侧虚线添加按钮 → 打开添加账号弹窗
  const addCta = document.getElementById('add-account-cta');
  if (addCta) addCta.addEventListener('click', () => showModal('add-account-modal'));
  const closeAddModal = document.getElementById('close-add-account-modal');
  if (closeAddModal) closeAddModal.addEventListener('click', () => {
    // 必须走 hideModal 重置 data-state/.modal-visible；只设 display:none 会让
    // body:has(.modal[data-state="open"]) 持续匹配，导致侧边栏胶囊被永久隐藏
    hideModal('add-account-modal');
  });

  // 新版添加账号弹窗里的三卡片
  const addA = document.getElementById('add-acct-ms');
  if (addA) addA.addEventListener('click', () => {
    hideModal('add-account-modal');
    startMsAuth();
  });
  const addB = document.getElementById('add-acct-offline');
  if (addB) addB.addEventListener('click', () => {
    hideModal('add-account-modal');
    showModal('offline-account-modal');
  });
  const addC = document.getElementById('add-acct-thirdparty');
  if (addC) addC.addEventListener('click', () => {
    hideModal('add-account-modal');
    showModal('thirdparty-account-modal');
  });
  const createOfflineBtn = document.getElementById('create-offline-btn');
  if (createOfflineBtn) createOfflineBtn.addEventListener('click', async () => {
    const offlineUsernameInput = document.getElementById('offline-username-input');
    const username = offlineUsernameInput ? offlineUsernameInput.value.trim() : '';
    if (!username) { showToast('请输入玩家 ID', 'error'); return; }
    if (username.length < 3 || username.length > 16) {
      showToast('玩家 ID 长度需为 3 - 16 位', 'error'); return;
    }
    if (!/^[A-Za-z0-9_]+$/.test(username)) {
      if (!confirm(`你输入的玩家 ID「${username}」不符合标准（3 - 16 位，只可以包含英文字母、数字与下划线），可能导致部分版本的游戏无法启动或发生错误。\n\n强烈建议使用规范的玩家 ID！\n如果你坚持，仍然可以继续创建档案。`)) {
        return;
      }
    }
    try {
      const result = await API.addOfflineAccount(username);
      if (result.success) {
        showToast(`离线账户 ${username} 创建成功`, 'success');
        closeOfflineModal();
        await loadAccounts();
      } else {
        showToast(result.error || '创建失败', 'error');
      }
    } catch (e) {
      showToast('创建离线账户失败', 'error');
    }
  });

  const tpPreset = document.getElementById('tp-server-preset');
  const tpUrl = document.getElementById('tp-server-url');
  if (tpPreset) {
    tpPreset.addEventListener('change', () => {
      const val = tpPreset.value;
      if (val && val !== 'custom') {
        tpUrl.value = val;
        verifyThirdPartyServer(val);
      } else {
        tpUrl.value = '';
      }
    });
  }
  if (tpUrl) {
    tpUrl.addEventListener('blur', () => {
      const url = tpUrl.value.trim();
      if (url) verifyThirdPartyServer(url);
    });
  }

  const tpLoginBtn = document.getElementById('tp-login-btn');
  if (tpLoginBtn) tpLoginBtn.addEventListener('click', async () => {
    const tpServerUrl = document.getElementById('tp-server-url');
    const tpUsernameInput = document.getElementById('tp-username-input');
    const tpPasswordInput = document.getElementById('tp-password-input');
    const serverUrl = tpServerUrl ? tpServerUrl.value.trim() : '';
    const username = tpUsernameInput ? tpUsernameInput.value.trim() : '';
    const password = tpPasswordInput ? tpPasswordInput.value : '';
    if (!serverUrl) { showToast('请输入认证服务器地址', 'error'); return; }
    if (!username) { showToast('请输入邮箱或用户名', 'error'); return; }
    if (!password) { showToast('请输入密码', 'error'); return; }

    const btn = document.getElementById('tp-login-btn');
    btn.disabled = true;
    btn.textContent = '登录中...';
    try {
      const result = await API.loginThirdParty(serverUrl, username, password);
      if (result.success) {
        showToast(`欢迎，${result.account.username}！`, 'success');
        closeThirdPartyModal();
        await loadAccounts();
      } else if (result.needSelectProfile) {
        closeThirdPartyModal();
        showProfileSelectModal(result.accessToken, result.clientToken, result.serverUrl, result.availableProfiles);
      } else {
        showToast(result.error || '登录失败', 'error');
      }
    } catch (e) {
      showToast('登录失败: ' + (e.message || e.error || '未知错误'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '登录';
    }
  });
}

function setupSettingsPage() {
  const saveBtn = document.getElementById('save-settings-btn');
  if (!saveBtn) return;
  saveBtn.addEventListener('click', saveCurrentSettings);
  document.getElementById('reset-settings-btn').addEventListener('click', async () => {
    const confirmed = await showConfirmDialog('重置设置', '确定要重置所有设置为默认值吗？此操作不可恢复！', '重置', '取消');
    if (confirmed) {
      try {
        const result = await API.resetSettings();
        if (result.success) {
          document.documentElement.setAttribute('data-theme', 'light');
          document.querySelectorAll('.theme-option').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-theme') === 'light');
          });
          applyAccentColor('#1a1a1a');
          await loadSettings();
          showToast('设置已重置为默认值', 'success');
        } else {
          showToast('重置失败: ' + (result.error || '未知错误'), 'error');
        }
      } catch (e) {
        showToast('重置失败: ' + e.message, 'error');
      }
    }
  });

  const accentColorInput = getDOMElement('custom-accent-color');
  if (accentColorInput) {
    const accentColorValueEl = getDOMElement('custom-color-value');
    const colorPreviewDot = document.getElementById('color-preview-dot');
    accentColorInput.addEventListener('input', throttle((e) => {
      const color = e.target.value;
      if (accentColorValueEl) accentColorValueEl.textContent = color;
      if (colorPreviewDot) colorPreviewDot.style.background = color;
    }, 50));
  }
}

export { setupModBrowse, setupAccountButtons, setupSettingsPage };
