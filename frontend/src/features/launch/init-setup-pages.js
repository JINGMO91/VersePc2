import { API as API } from '../../core/api.js';
import { loadAccounts as loadAccounts } from '../accounts/accounts-list.js';
import { startMsAuth as startMsAuth, closeOfflineModal as closeOfflineModal, verifyThirdPartyServer as verifyThirdPartyServer } from '../accounts/accounts-auth.js';
import { applyAccentColor as applyAccentColor } from './java.js';
import { showToast as showToast, showModal as showModal, hideModal as hideModal, showConfirmDialog as showConfirmDialog } from '../misc/ui-components.js';
import { getDOMElement as getDOMElement, throttle as throttle } from '../misc/utils.js';
import { loadSettings as loadSettings, saveCurrentSettings as saveCurrentSettings } from '../settings/settings-load-save.js';
import { appState as appState } from '../../core/app-state.js';

/// 模组列表按需加载，避免模组页模块进入启动包
function lazyLoadMods() {
  import('../mods/mod-browse.js')
    .then((m) => m.loadMods())
    .catch((e) => console.error('[setup] 模组模块加载失败:', e));
}

function setupModBrowse() {
  const modSearchBtn = document.getElementById('mod-search-btn');
  if (!modSearchBtn) return;
  const modSearchInput = document.getElementById('mod-search-input');
  modSearchBtn.addEventListener('click', () => {
    appState.modSearchQuery = modSearchInput ? modSearchInput.value.trim() : '';
    appState.modSearchOffset = 0;
    lazyLoadMods();
  });
  if (modSearchInput) modSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      appState.modSearchQuery = e.target.value.trim();
      appState.modSearchOffset = 0;
      lazyLoadMods();
    }
  });
  const modPrevBtn = document.getElementById('mod-prev-btn');
  if (modPrevBtn) modPrevBtn.addEventListener('click', () => {
    if (appState.modSearchOffset >= 15) {
      appState.modSearchOffset -= 15;
      lazyLoadMods();
    }
  });
  const modNextBtn = document.getElementById('mod-next-btn');
  if (modNextBtn) modNextBtn.addEventListener('click', () => {
    appState.modSearchOffset += 15;
    lazyLoadMods();
  });

  const bindFilter = (id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { appState.modSearchOffset = 0; lazyLoadMods(); });
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

  // 新版添加账号弹窗的三卡片已改为 Vue 模板事件（openMsAuthModal/openOfflineAccountModal/openThirdPartyAccountModal）
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

  // 外置登录按钮已改为 Vue 模板事件（submitThirdPartyLogin），这里只保留服务器地址联动
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
