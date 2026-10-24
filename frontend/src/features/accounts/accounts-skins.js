// accounts-skins.js — 皮肤选择、上传与应用
import { showToast as showToast } from '../misc/ui-components.js';
import { accountsState as S } from './accounts-state.js';
import { _tauriFetch, _fetchDataUrl, _fetchAccountSkinTexture, _reloadSkinViewer, _invalidateAvatarCache, _refreshAccountAvatars } from './accounts-avatar.js';
import { _createSkinCard } from './accounts-detail.js';
import { requestLazyLoad } from '../../core/lazy-loaders.js';

// 皮肤操作后刷新账户列表
function loadAccounts() {
  requestLazyLoad('accounts:reload');
}

async function loadSkinSelector(acc) {
  const container = document.getElementById('acct-skin-grid');
  const section = document.getElementById('acct-detail-skins');
  if (!container || !section) return;
  if (acc.type !== 'offline' && acc.type !== 'microsoft') {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  container.innerHTML = '';

  // 微软账户：只显示本地导入的皮肤库
  if (acc.type === 'microsoft') {
    try {
      const resp = await _tauriFetch(`/api/ms-skins/local?accountId=${encodeURIComponent(acc.id)}`);
      const data = await resp.json();
      if (data.success && data.skins && data.skins.length > 0) {
        data.skins.forEach(skin => {
          container.appendChild(_createSkinCard({
            title: `${skin.name}（点击应用到账户）`,
            model: skin.model || 'default',
            onClick: () => applyMsSkin(skin.id),
            // 长按或右键删除
            onContextMenu: (e) => { e.preventDefault(); deleteMsSkin(skin.id, skin.name); },
            resolveTexture: () => _fetchDataUrl(
              `/api/ms-skins/file?accountId=${encodeURIComponent(acc.id)}&skinId=${encodeURIComponent(skin.id)}&_=${Date.now()}`
            )
          }));
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'acct-skin-empty';
        empty.style.cssText = 'grid-column:1/-1;padding:12px;text-align:center;color:var(--text-muted);font-size:12px;';
        empty.textContent = '暂无本地皮肤，点击下方按钮导入';
        container.appendChild(empty);
      }
    } catch (e) {}
    return;
  }

  // 离线账户：显示默认皮肤 + 自定义皮肤
  try {
    const resp = await _tauriFetch('/api/default-skins');
    const data = await resp.json();
    if (!data.success || !data.skins) return;
    const currentSkinFile = acc.skinFile || 'steve_skin.png';
    const allSkins = data.skins.slice();
    if (currentSkinFile && currentSkinFile.startsWith('custom_') && !allSkins.some(s => s.file === currentSkinFile)) {
      allSkins.push({ id: 'custom', name: '自定义', file: currentSkinFile, model: acc.skinModel || 'default' });
    }
    allSkins.forEach(skin => {
      const isCustom = skin.id === 'custom';
      container.appendChild(_createSkinCard({
        title: skin.name,
        model: skin.model || 'default',
        active: skin.file === currentSkinFile,
        onClick: () => selectSkin(skin.id, skin.file),
        // 内置皮肤直接读打包资源，自定义皮肤取账户当前纹理
        resolveTexture: () => isCustom
          ? _fetchAccountSkinTexture(acc)
          : Promise.resolve(`img/${skin.file}`)
      }));
    });
  } catch (e) {}
}

async function selectSkin(skinId, skinFile) {
  if (!S._currentDetailAccount) return;
  try {
    if (skinId === 'custom') {
      S._currentDetailAccount.skinFile = skinFile;
      await _reloadSkinViewer();
      loadSkinSelector(S._currentDetailAccount);
      _invalidateAvatarCache(S._currentDetailAccount);
      _refreshAccountAvatars();
      loadAccounts();
      return;
    }
    const resp = await _tauriFetch('/api/set-account-skin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: S._currentDetailAccount.id, skinId })
    });
    const result = await resp.json();
    if (!result.success) { showToast('更换失败', 'error'); return; }
    S._currentDetailAccount.skinFile = skinFile;
    await _reloadSkinViewer();
    loadSkinSelector(S._currentDetailAccount);
    _invalidateAvatarCache(S._currentDetailAccount);
    _refreshAccountAvatars();
    loadAccounts();
    showToast('皮肤已更换', 'success');
  } catch (e) {
    showToast('更换失败', 'error');
  }
}

async function handleSkinUpload(input) {
  if (!input.files || !input.files[0] || !S._currentDetailAccount) return;
  const file = input.files[0];
  if (!file.name.toLowerCase().endsWith('.png')) {
    showToast('请选择 PNG 格式的皮肤文件', 'error');
    input.value = '';
    return;
  }
  showToast('正在导入…', 'info');
  try {
    const fileBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const modelSelect = document.getElementById('skin-model-select') || document.querySelector('input[name="skin-model"]:checked');
    let modelValue = 'default';
    if (modelSelect) {
      modelValue = modelSelect.value || modelSelect.getAttribute('data-model') || 'default';
    }

    // 微软账户：导入到本地皮肤库
    if (S._currentDetailAccount.type === 'microsoft') {
      const resp = await _tauriFetch('/api/ms-skins/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: S._currentDetailAccount.id,
          model: modelValue,
          fileBase64: fileBase64,
          name: file.name.replace(/\.png$/i, '')
        })
      });
      const result = await resp.json();
      if (result.success) {
        loadSkinSelector(S._currentDetailAccount);
        showToast('皮肤已导入本地库，点击皮肤可应用到账户', 'success');
      } else {
        showToast(result.error || '导入失败', 'error');
      }
      input.value = '';
      return;
    }

    // 离线账户：直接应用
    const resp = await _tauriFetch('/api/upload-skin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: S._currentDetailAccount.id,
        model: modelValue,
        fileBase64: fileBase64
      })
    });
    const text = await resp.text();
    let result;
    try { result = JSON.parse(text); } catch (e) { showToast('上传失败: 服务器返回异常', 'error'); return; }
    if (result.success) {
      S._currentDetailAccount.skinFile = result.fileName;
      await _reloadSkinViewer();
      loadSkinSelector(S._currentDetailAccount);
      _invalidateAvatarCache(S._currentDetailAccount);
      _refreshAccountAvatars();
      loadAccounts();
      showToast('皮肤已导入', 'success');
    } else {
      showToast(result.error || '上传失败', 'error');
    }
  } catch (e) {
    showToast('上传失败', 'error');
  }
  input.value = '';
}

async function applyMsSkin(skinId) {
  if (!S._currentDetailAccount || S._currentDetailAccount.type !== 'microsoft') return;
  if (S._applyingMsSkin) return; // 防止重复点击导致连续请求触发 Mojang 429
  S._applyingMsSkin = true;
  showToast('正在上传到 Minecraft 官方…', 'info');
  try {
    const resp = await _tauriFetch('/api/ms-skins/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: S._currentDetailAccount.id,
        skinId: skinId
      })
    });
    const result = await resp.json();
    if (result.success) {
      await _reloadSkinViewer();
      _invalidateAvatarCache(S._currentDetailAccount);
      _refreshAccountAvatars();
      loadAccounts();
      showToast('皮肤已应用到账户', 'success');
    } else if (result.needRelogin) {
      showToast('登录已过期，请重新登录微软账户', 'error');
    } else if (result.rateLimited) {
      showToast(result.error, 'error', 5000);
    } else {
      showToast(result.error || '应用失败', 'error');
    }
  } catch (e) {
    showToast('应用失败', 'error');
  } finally {
    S._applyingMsSkin = false;
  }
}

async function deleteMsSkin(skinId, skinName) {
  if (!S._currentDetailAccount || S._currentDetailAccount.type !== 'microsoft') return;
  if (!confirm(`确定要删除皮肤「${skinName}」吗？`)) return;
  try {
    const resp = await _tauriFetch('/api/ms-skins/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: S._currentDetailAccount.id,
        skinId: skinId
      })
    });
    const result = await resp.json();
    if (result.success) {
      loadSkinSelector(S._currentDetailAccount);
      showToast('已删除', 'success');
    } else {
      showToast(result.error || '删除失败', 'error');
    }
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

export { loadSkinSelector, selectSkin, handleSkinUpload, applyMsSkin, deleteMsSkin };
