// accounts-capes.js — 披风选择、上传与获取
import { showToast as showToast, showConfirmDialog as showConfirmDialog } from '../misc/ui-components.js';
import { accountsState as S } from './accounts-state.js';
import { _tauriFetch } from './accounts-avatar.js';

function _capeFileUrl(accId, file) {
  return '/api/capes/file?accountId=' + encodeURIComponent(accId) + '&file=' + encodeURIComponent(file) + '&_=' + Date.now();
}

async function _applyCapeToViewer(acc, file) {
  if (!S._skinViewer) return;
  try {
    const url = file ? _capeFileUrl(acc.id, file) : null;
    await S._skinViewer.loadCape(url);
    if (file && S._skinViewer.backEquipment !== undefined) S._skinViewer.backEquipment = 'cape';
    if (!file) S._skinViewer.backEquipment = null;
  } catch (e) {
    console.warn('[Cape] apply to viewer failed:', e);
  }
}

async function loadCapeSelector(acc) {
  const section = document.getElementById('acct-detail-capes');
  const container = document.getElementById('acct-cape-grid');
  const fetchBtn = document.getElementById('cape-fetch-session-btn');
  if (!section || !container) return;
  if (acc.type !== 'offline' && acc.type !== 'microsoft') {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  if (fetchBtn) fetchBtn.style.display = (acc.type === 'microsoft') ? '' : 'none';
  container.innerHTML = '';
  let capes = [];
  try {
    const resp = await _tauriFetch('/api/capes/local?accountId=' + encodeURIComponent(acc.id));
    const data = await resp.json();
    capes = (data.success && data.capes) || [];
  } catch (e) {}
  if (!capes.length) {
    const empty = document.createElement('div');
    empty.className = 'acct-skin-empty';
    empty.style.cssText = 'grid-column:1/-1;padding:12px;text-align:center;color:var(--text-muted);font-size:12px;';
    empty.textContent = '暂无披风，可导入披风纹理（64/92 宽 PNG），微软账户可一键获取官方披风';
    container.appendChild(empty);
    return;
  }
  const selected = (acc.capeFile || '').replace(/\.png$/i, '');
  capes.forEach(cape => {
    const id = String(cape.id || '');
    const display = /^[0-9]{13}_(.+)$/.exec(id) ? id.replace(/^[0-9]{13}_/, '') : id;
    const card = document.createElement('div');
    card.className = 'acct-skin-item' + (cape.file === acc.capeFile ? ' active' : '');
    card.title = display + '（点击披上，右键删除）';
    card.onclick = () => selectCape(cape.id);
    card.oncontextmenu = (e) => { e.preventDefault(); deleteCape(cape.id, display); };
    const img = document.createElement('img');
    img.alt = display;
    img.decoding = 'async';
    img.src = _capeFileUrl(acc.id, cape.file);
    card.appendChild(img);
    if (cape.file === acc.capeFile) {
      const check = document.createElement('span');
      check.className = 'acct-skin-check';
      check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      card.appendChild(check);
    }
    container.appendChild(card);
  });
  void selected;
}

async function selectCape(capeId) {
  if (!S._currentDetailAccount) return;
  try {
    const resp = await _tauriFetch('/api/capes/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: S._currentDetailAccount.id, capeId })
    });
    const result = await resp.json();
    if (!result.success) { showToast('披风切换失败', 'error'); return; }
    S._currentDetailAccount.capeFile = capeId ? (capeId + '.png') : '';
    await _applyCapeToViewer(S._currentDetailAccount, S._currentDetailAccount.capeFile);
    loadCapeSelector(S._currentDetailAccount);
    showToast('披风已更新', 'success');
  } catch (e) {
    showToast('披风切换失败', 'error');
  }
}

async function unselectCape() {
  if (!S._currentDetailAccount) return;
  await selectCape('');
}

async function deleteCape(capeId, name) {
  if (!S._currentDetailAccount) return;
  const ok = await showConfirmDialog('删除披风', '确定删除「' + (name || capeId) + '」吗？', '删除', '取消');
  if (!ok) return;
  try {
    const resp = await _tauriFetch('/api/capes/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: S._currentDetailAccount.id, capeId })
    });
    const result = await resp.json();
    if (!result.success) { showToast('删除失败', 'error'); return; }
    if (S._currentDetailAccount.capeFile === capeId + '.png') {
      S._currentDetailAccount.capeFile = '';
      await _applyCapeToViewer(S._currentDetailAccount, '');
    }
    loadCapeSelector(S._currentDetailAccount);
    showToast('披风已删除', 'success');
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

async function handleCapeUpload(input) {
  if (!input.files || !input.files[0] || !S._currentDetailAccount) return;
  const file = input.files[0];
  if (!file.name.toLowerCase().endsWith('.png')) {
    showToast('请选择 PNG 格式的披风纹理', 'error');
    input.value = '';
    return;
  }
  showToast('正在导入披风…', 'info');
  try {
    const fileBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const resp = await _tauriFetch('/api/capes/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: S._currentDetailAccount.id,
        fileBase64: fileBase64,
        name: file.name.replace(/\.png$/i, '')
      })
    });
    const result = await resp.json();
    if (result.success) {
      loadCapeSelector(S._currentDetailAccount);
      showToast('披风已导入，点击即可披上', 'success');
    } else {
      showToast(result.error || '导入失败', 'error');
    }
  } catch (e) {
    showToast('导入失败', 'error');
  }
  input.value = '';
}

async function fetchSessionCape() {
  if (!S._currentDetailAccount || S._currentDetailAccount.type !== 'microsoft') return;
  showToast('正在获取官方披风…', 'info');
  try {
    const resp = await _tauriFetch('/api/capes/fetch-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: S._currentDetailAccount.id })
    });
    const result = await resp.json();
    if (result.success) {
      loadCapeSelector(S._currentDetailAccount);
      showToast('官方披风已获取，点击即可披上', 'success');
    } else if (result.error === 'no-cape') {
      showToast('该账户当前没有官方披风', 'info');
    } else {
      showToast(result.error || '获取失败', 'error');
    }
  } catch (e) {
    showToast('获取失败', 'error');
  }
}

export { _capeFileUrl, _applyCapeToViewer, loadCapeSelector, selectCape, unselectCape, deleteCape, handleCapeUpload, fetchSessionCape };
