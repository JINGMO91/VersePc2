// accounts-auth.js — 微软登录、离线与第三方认证
import { API as API } from '../../core/api.js';
import { bridge as bridge } from '../../core/tauri-bridge.js';
import { escapeHtml as escapeHtml } from '../../core/utils.js';
import { showToast as showToast, showModal as showModal, hideModal as hideModal } from '../misc/ui-components.js';
import { appState as appState } from '../../core/app-state.js';
import { actionAttrs as actionAttrs } from '../../core/actions.js';
import { accountsState as S } from './accounts-state.js';
import { loadAccounts } from './accounts-list.js';

async function startMsAuth() {
  showModal('msauth-modal');
  document.getElementById('msauth-status-text').textContent = '获取设备码中...';
  try {
    const result = await API.getMsDeviceCode();
    if (result.success) {
      const verifyUrl = result.verificationUriComplete || result.verificationUri;
      document.getElementById('msauth-url').href = verifyUrl;
      document.getElementById('msauth-url').textContent = verifyUrl;
      document.getElementById('msauth-code-text').textContent = result.userCode;
      document.getElementById('msauth-status-text').textContent = '等待登录...';

      try {
        await bridge?.clipboard?.writeText(result.userCode);
      } catch (e) {}

      setTimeout(async () => {
        try {
          await bridge?.openExternal?.(verifyUrl);
        } catch (e) {
          console.warn('[Auth] 自动打开浏览器失败:', e);
        }
      }, 500);

      if (appState.msAuthPollInterval) clearInterval(appState.msAuthPollInterval);
      let _msAuthRetryCount = 0;
      const _msAuthMaxRetry = 2;
      const _msAuthStartPoll = async (deviceCode, userCode) => {
        appState.msAuthPollInterval = setInterval(async () => {
        try {
          const pollResult = await API.pollMsAuth(deviceCode);
          if (pollResult.success) {
            clearInterval(appState.msAuthPollInterval);
            appState.msAuthPollInterval = null;
            document.getElementById('msauth-status-text').textContent = '登录成功！';
            showToast(`欢迎，${pollResult.account.username}！`, 'success');
            setTimeout(() => closeMsAuthModal(), 1500);
            await loadAccounts();
          } else if (pollResult.pending) {
            document.getElementById('msauth-status-text').textContent = '等待验证...';
          } else {
            const isCodeUsed = pollResult.errorCode === 'invalid_grant' && pollResult.error && pollResult.error.includes('device_code');
            if (isCodeUsed && _msAuthRetryCount < _msAuthMaxRetry) {
              _msAuthRetryCount++;
              clearInterval(appState.msAuthPollInterval);
              appState.msAuthPollInterval = null;
              document.getElementById('msauth-status-text').textContent = '授权码已过期，正在重新获取...';
              try {
                const newResult = await API.getMsDeviceCode();
                if (newResult.success) {
                  const newVerifyUrl = newResult.verificationUriComplete || newResult.verificationUri;
                  document.getElementById('msauth-url').href = newVerifyUrl;
                  document.getElementById('msauth-url').textContent = newVerifyUrl;
                  document.getElementById('msauth-code-text').textContent = newResult.userCode;
                  document.getElementById('msauth-status-text').textContent = '新的授权码已获取，请重新登录...';
                  try { await bridge?.clipboard?.writeText(newResult.userCode); } catch (e) {}
                  try { await bridge?.openExternal?.(newVerifyUrl); } catch (e) {}
                  _msAuthStartPoll(newResult.deviceCode, newResult.userCode);
                  return;
                }
              } catch (retryErr) {
                console.warn('[Auth] 重新获取设备码失败:', retryErr);
              }
              document.getElementById('msauth-status-text').textContent = '获取新授权码失败，请点击重新登录';
              return;
            }
            let errMsg = pollResult.error || '验证失败';
            if (pollResult.needPurchase) errMsg = '❌ 该账号未购买Minecraft，请先购买游戏';
            else if (pollResult.needCreateProfile) errMsg = '❌ 未找到档案，请先在 Minecraft.net 创建角色名';
            else if (pollResult.isRateLimit) errMsg = `⏳ 请求过于频繁，请等待 ${pollResult.retryAfter || 5} 秒后重试`;
            else if (pollResult.xerr) errMsg = `❌ Xbox认证失败 (${pollResult.xerr})`;
            else if (isCodeUsed) errMsg = '授权码已过期或已被使用，请点击重新登录';
            document.getElementById('msauth-status-text').textContent = errMsg;
            if (pollResult.needPurchase || pollResult.needCreateProfile || pollResult.errorCode === 'invalid_grant') {
              clearInterval(appState.msAuthPollInterval);
              appState.msAuthPollInterval = null;
            }
          }
        } catch (e) {
          console.warn('[Auth] 微软登录轮询失败:', e);
        }
      }, (result.interval || 5) * 1000);
      };
      _msAuthStartPoll(result.deviceCode, result.userCode);
    } else {
      const errMsg = result.error || '获取设备码失败';
      document.getElementById('msauth-status-text').textContent = errMsg;
    }
  } catch (e) {
    const msg = e?.message || e?.error || '请求失败';
    document.getElementById('msauth-status-text').textContent = msg.includes('网络') || msg.includes('超时') ? '网络连接失败，请检查网络后重试' : msg;
  }
}

function closeMsAuthModal() {
  hideModal('msauth-modal');
  if (appState.msAuthPollInterval) { clearInterval(appState.msAuthPollInterval); appState.msAuthPollInterval = null; }
}

function closeOfflineModal() {
  hideModal('offline-account-modal');
  document.getElementById('offline-username-input').value = '';
}

function copyMsCode() {
  const code = document.getElementById('msauth-code-text').textContent;
  bridge.clipboard.writeText(code).then(() => showToast('代码已复制', 'success'));
}

async function reopenMsAuthPage() {
  if (appState.msAuthPollInterval) { clearInterval(appState.msAuthPollInterval); appState.msAuthPollInterval = null; }
  startMsAuth();
}

function closeThirdPartyModal() {
  hideModal('thirdparty-account-modal');
  document.getElementById('tp-username-input').value = '';
  document.getElementById('tp-password-input').value = '';
  document.getElementById('tp-server-info').style.display = 'none';
}

async function verifyThirdPartyServer(url) {
  const infoDiv = document.getElementById('tp-server-info');
  try {
    const result = await API.verifyThirdPartyServer(url);
    if (result.success) {
      document.getElementById('tp-server-name').textContent = result.meta?.serverName || '未知服务器';
      document.getElementById('tp-server-desc').textContent = result.meta?.implementationName || url;
      if (result.meta?.serverIcon) {
        document.getElementById('tp-server-icon').src = result.meta.serverIcon;
        document.getElementById('tp-server-icon').style.display = '';
      }
      infoDiv.style.display = '';
    } else {
      infoDiv.style.display = 'none';
    }
  } catch (e) {
    infoDiv.style.display = 'none';
  }
}

function cropSkinHeadCanvas(imgElement, outputSize = 64) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const sw = imgElement.naturalWidth || imgElement.width;
    const sh = imgElement.naturalHeight || imgElement.height;
    if (sw < 64 || sh < 32) return null;
    const scale = sw / 64;
    canvas.width = outputSize;
    canvas.height = outputSize;
    ctx.imageSmoothingEnabled = false;
    // 双图层：脸部放大约 0.75，帽子层放大约 0.875（帽子比脸大，完整显示帽子像素块，不被脸的正方形裁剪）
    const faceSize = Math.round(outputSize * 0.75);
    const hatSize = Math.round(outputSize * 0.875);
    const faceOffset = Math.round((outputSize - faceSize) / 2);
    const hatOffset = Math.round((outputSize - hatSize) / 2);
    // 脸部（居中背景）
    ctx.drawImage(imgElement, 8 * scale, 8 * scale, 8 * scale, 8 * scale, faceOffset, faceOffset, faceSize, faceSize);
    // 帽子层（更大、居中前景，透明像素露出脸部）
    if (sh >= 64) {
      const hatCanvas = document.createElement('canvas');
      hatCanvas.width = outputSize;
      hatCanvas.height = outputSize;
      const hatCtx = hatCanvas.getContext('2d');
      hatCtx.imageSmoothingEnabled = false;
      hatCtx.drawImage(imgElement, 40 * scale, 8 * scale, 8 * scale, 8 * scale, hatOffset, hatOffset, hatSize, hatSize);
      const hatData = hatCtx.getImageData(0, 0, outputSize, outputSize);
      const faceData = ctx.getImageData(0, 0, outputSize, outputSize);
      for (let i = 0; i < hatData.data.length; i += 4) {
        const ha = hatData.data[i + 3];
        if (ha > 0) {
          // 帽子不透明像素直接覆盖脸部，透明像素保留脸部
          faceData.data[i] = hatData.data[i];
          faceData.data[i + 1] = hatData.data[i + 1];
          faceData.data[i + 2] = hatData.data[i + 2];
          faceData.data[i + 3] = ha;
        }
      }
      ctx.putImageData(faceData, 0, 0);
    }
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('[cropSkinHeadCanvas] error:', e);
    return null;
  }
}

function showProfileSelectModal(accessToken, clientToken, serverUrl, profiles) {
  S.tpPendingAuth = { accessToken, clientToken, serverUrl };
  const container = document.getElementById('tp-profile-list');
  container.innerHTML = profiles.map(p => {
    const pUuid = (p.id || '').replace(/-/g, '');
    const pServerParam = serverUrl ? `&serverUrl=${encodeURIComponent(serverUrl)}` : '';
    const pUsernameParam = p.name ? `&username=${encodeURIComponent(p.name)}` : '';
    const pSkinUrl = `/api/avatar?uuid=${pUuid}${pServerParam}${pUsernameParam}`;
    return `
    <div class="profile-select-item"${actionAttrs('selectThirdPartyProfile', p.id, p.name)}>
      <img src="${escapeHtml(pSkinUrl)}" alt="" class="profile-select-avatar" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <div class="profile-select-avatar-fallback" style="display:none;width:40px;height:40px;background:var(--bg-tertiary);border-radius:6px;align-items:center;justify-content:center;font-size:18px;color:var(--text-secondary);">${p.name.charAt(0).toUpperCase()}</div>
      <div class="profile-select-info">
        <div class="profile-select-name">${escapeHtml(p.name)}</div>
        <div class="profile-select-uuid">${p.id}</div>
      </div>
      <button class="btn btn-primary btn-sm">选择</button>
    </div>
  `;
  }).join('');
  container.querySelectorAll('.profile-select-avatar').forEach(img => {
    img.onload = function() {
      const w = this.naturalWidth || this.width;
      const h = this.naturalHeight || this.height;
      const isFullSkin = (w === 64 && h === 32) || w === 128 || w === 256;
      if (isFullSkin) {
        const cropped = cropSkinHeadCanvas(this, 64);
        if (cropped) {
          this.onload = null;
          this.src = cropped;
        }
      }
    };
  });
  showModal('tp-profile-select-modal');
}

function closeProfileSelectModal() {
  hideModal('tp-profile-select-modal');
  S.tpPendingAuth = null;
}

async function selectThirdPartyProfile(profileId, profileName) {
  if (!S.tpPendingAuth) return;
  showToast('正在选择角色...', 'info');
  try {
    const result = await API.selectThirdPartyProfile(
      S.tpPendingAuth.accessToken,
      S.tpPendingAuth.clientToken,
      S.tpPendingAuth.serverUrl,
      profileId,
      profileName
    );
    if (result.success) {
      showToast(`欢迎，${result.account.username}！`, 'success');
      closeProfileSelectModal();
      await loadAccounts();
    } else {
      showToast(result.error || '角色选择失败', 'error');
    }
  } catch (e) {
    showToast('角色选择失败', 'error');
  }
}

export { startMsAuth, closeMsAuthModal, closeOfflineModal, copyMsCode, reopenMsAuthPage, closeThirdPartyModal, verifyThirdPartyServer, cropSkinHeadCanvas, showProfileSelectModal, closeProfileSelectModal, selectThirdPartyProfile };
