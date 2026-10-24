// accounts-detail.js — 账户详情字段与背景
import { showToast as showToast } from '../misc/ui-components.js';
import { accountsState as S } from './accounts-state.js';
import { _reloadSkinViewer, _refreshAccountAvatars, getSkinFigureImage, _whenSkinCardVisible } from './accounts-avatar.js';
import { setSkinBg } from './accounts-skin-utils.js';
import { requestLazyLoad } from '../../core/lazy-loaders.js';

const selectAccount = (accountId) => requestLazyLoad('accounts:select', accountId);
const showAccountList = () => requestLazyLoad('accounts:show-list');
const deleteAccount = (accountId) => requestLazyLoad('accounts:delete', accountId);

async function detailSelectAccount() {
  if (!S._currentDetailAccount) return;
  await selectAccount(S._currentDetailAccount.id);
  showAccountList();
}

async function detailDeleteAccount() {
  if (!S._currentDetailAccount) return;
  await deleteAccount(S._currentDetailAccount.id);
  showAccountList();
}

async function detailRefreshSkin() {
  if (!S._currentDetailAccount || !S._skinViewer) return;
  const acc = S._currentDetailAccount;
  const accUuid = (acc.uuid || '').replace(/-/g, '');
  if (!accUuid) { showToast('无UUID', 'error'); return; }
  try {
    await _reloadSkinViewer();
    _refreshAccountAvatars();
    showToast('皮肤已刷新', 'success');
  } catch (e) {
    showToast('皮肤刷新失败', 'error');
  }
}

function copyDetailUuid() {
  const uuidEl = document.getElementById('detail-uuid');
  if (!uuidEl) return;
  const text = uuidEl.textContent;
  if (!text || text === '-') return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('UUID已复制', 'success'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('UUID已复制', 'success');
  }
}

function setAnim(type) {
  if (!S._skinViewer) return;
  const animMap = {
    idle: () => new skinview3d.IdleAnimation(),
    walk: () => new skinview3d.WalkingAnimation(),
    run: () => new skinview3d.RunningAnimation(),
    fly: () => new skinview3d.FlyingAnimation(),
    wave: () => new skinview3d.WaveAnimation(),
    crouch: () => new skinview3d.CrouchAnimation(),
    hit: () => new skinview3d.HitAnimation(),
    swim: () => new skinview3d.SwimAnimation()
  };
  const factory = animMap[type];
  if (!factory) return;
  S._skinViewer.animation = factory();
  const speedMap = { idle: 0.6, walk: 0.8, run: 0.6, fly: 0.8, wave: 0.8, crouch: 0.5, hit: 0.9, swim: 0.7 };
  S._skinViewer.animation.speed = speedMap[type] || 0.7;
  document.querySelectorAll('.acct-anim-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.anim === type);
  });
}

function _createSkinCard(opts) {
  const card = document.createElement('div');
  card.className = 'acct-skin-item is-loading' + (opts.active ? ' active' : '');
  card.title = opts.title || '';
  if (opts.onClick) card.onclick = opts.onClick;
  if (opts.onContextMenu) card.oncontextmenu = opts.onContextMenu;

  const img = document.createElement('img');
  img.alt = opts.title || '';
  img.decoding = 'async';
  card.appendChild(img);

  if (opts.active) {
    const check = document.createElement('span');
    check.className = 'acct-skin-check';
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    card.appendChild(check);
  }

  _whenSkinCardVisible(card, () => {
    Promise.resolve()
      .then(opts.resolveTexture)
      .then(textureUrl => {
        if (!textureUrl) return '';
        return getSkinFigureImage(textureUrl, opts.model);
      })
      .then(dataUrl => {
        if (dataUrl) img.src = dataUrl;
        card.classList.remove('is-loading');
      })
      .catch(() => { card.classList.remove('is-loading'); });
  });

  return card;
}

export { detailSelectAccount, detailDeleteAccount, detailRefreshSkin, copyDetailUuid, setAnim, setSkinBg, _createSkinCard };
