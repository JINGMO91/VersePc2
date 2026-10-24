// accounts-avatar.js — 头像与全身形象加载缓存
import { API as API } from '../../core/api.js';
import { bridge as bridge } from '../../core/tauri-bridge.js';
import { VerseSkinFigure as VerseSkinFigure } from './skin-figure.js';
import { accountsState as S } from './accounts-state.js';
import { cropSkinHeadCanvas } from './accounts-skin-utils.js';

async function _tauriFetch(url, options = {}) {
  // 非 Tauri 环境直接走原生 fetch
  if (!bridge.apiProxy) {
    return fetch(url, options);
  }
  // 只对 /api/ 路径走代理，外部 URL 仍走原生 fetch
  if (!url.startsWith('/api/')) {
    return fetch(url, options);
  }
  const method = (options.method || 'GET').toUpperCase();
  const u = new URL(url, window.location.origin);
  const params = {};
  u.searchParams.forEach((v, k) => { params[k] = v; });
  let body = null;
  if (options.body) {
    try { body = JSON.parse(options.body); } catch (e) { body = options.body; }
  }
  const result = await bridge.apiProxy(method, u.pathname, params, body);
  return {
    ok: result.ok,
    status: result.status,
    async json() { return result.json(); },
    async text() { const d = await result.json(); return JSON.stringify(d); },
    headers: { get: () => null }
  };
}

async function _fetchDataUrl(url) {
  try {
    const resp = await _tauriFetch(url);
    const data = await resp.json();
    if (data && data.success && data.dataUrl) return data.dataUrl;
    if (data && data.data_url) return data.data_url;
  } catch (e) {}
  return url;
}

async function _reloadSkinViewer() {
  if (!S._currentDetailAccount || !S._skinViewer) return;
  const acc = S._currentDetailAccount;
  const accUuid = (acc.uuid || '').replace(/-/g, '');
  try {
    if (window.__TAURI__ && window.__TAURI__.core) {
      const result = await window.__TAURI__.core.invoke('get_skin_texture', {
        uuid: accUuid,
        serverUrl: acc.serverUrl || undefined,
        username: acc.username || undefined
      });
      if (result && result.success && result.data_url) {
        const model = (result.model === 'slim' || result.model === 'default')
          ? result.model
          : (acc._resolvedSkinModel || 'default');
        await S._skinViewer.loadSkin(result.data_url, { model });
        acc._resolvedSkinModel = model;
        return;
      }
    }
  } catch (e) {}
  // 非 Tauri 或 invoke 失败：HTTP 回退（可能失败，静默）
  try {
    if (accUuid) {
      const skinUrl = `/api/skin-texture?uuid=${accUuid}&_=${Date.now()}`;
      await S._skinViewer.loadSkin(skinUrl);
    }
  } catch (e) {}
}

function getSkinFigureImage(textureUrl, model) {
  if (!textureUrl) return Promise.resolve('');
  const key = (model || 'default') + '|' + textureUrl;
  const cached = S._skinFigureCache.get(key);
  if (cached) return Promise.resolve(cached);
  const run = () => _renderSkinFigure(textureUrl, model, key);
  const task = S._skinFigureQueue.then(run, run);
  S._skinFigureQueue = task.then(() => {}, () => {});
  return task;
}

async function _renderSkinFigure(textureUrl, model, key) {
  const cached = S._skinFigureCache.get(key);
  if (cached) return cached;
  if (!VerseSkinFigure) throw new Error('VerseSkinFigure unavailable');
  const dataUrl = await VerseSkinFigure.render(textureUrl, model || 'default');
  S._skinFigureCache.set(key, dataUrl);
  return dataUrl;
}

async function _fetchAccountSkinTexture(acc) {
  const accUuid = (acc.uuid || '').replace(/-/g, '');
  if (!accUuid) return '';
  if (window.__TAURI__ && window.__TAURI__.core) {
    try {
      const r = await window.__TAURI__.core.invoke('get_skin_texture', {
        uuid: accUuid,
        serverUrl: acc.serverUrl || undefined,
        username: acc.username || undefined
      });
      if (r && r.success && r.data_url) return r.data_url;
    } catch (e) {}
  }
  return `/api/skin-texture?uuid=${accUuid}`
    + (acc.serverUrl ? '&serverUrl=' + encodeURIComponent(acc.serverUrl) : '')
    + (acc.username ? '&username=' + encodeURIComponent(acc.username) : '')
    + `&_=${Date.now()}`;
}

function _whenSkinCardVisible(card, run) {
  if (!('IntersectionObserver' in window)) { run(); return; }
  if (!S._skinCardObserver) {
    S._skinCardObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        obs.unobserve(entry.target);
        const task = S._skinCardTasks.get(entry.target);
        S._skinCardTasks.delete(entry.target);
        if (task) task();
      });
    }, { rootMargin: '140px' });
  }
  S._skinCardTasks.set(card, run);
  S._skinCardObserver.observe(card);
}

function _invalidateAvatarCache(acc) {
  if (!acc) return;
  const accUuid = (acc.uuid || '').replace(/-/g, '');
  const offline = (acc.type === 'offline' && !acc.serverUrl) ? '1' : '0';
  const prefix = `${offline}|${accUuid}|${acc.serverUrl || ''}|${acc.username || ''}`;
  try {
    S._avatarMemCache.forEach((_v, key) => {
      if (key === prefix || key.startsWith(prefix + '|')) S._avatarMemCache.delete(key);
    });
  } catch (e) {}
}

function _refreshAccountAvatars() {
  const ts = Date.now();
  document.querySelectorAll('.account-avatar-img').forEach(img => {
    const src = img.src;
    if (src && src.includes('/api/avatar')) {
      img.src = src.replace(/&_=\d+/, '') + '&_=' + ts;
    }
  });
  try {
    const selectedId = localStorage.getItem('versepc_selected_account');
    if (selectedId) {
      API.getAccounts().then(accounts => {
        const selected = accounts.find(a => a.id === selectedId);
        if (selected) {
          const accUuid = (selected.uuid || '').replace(/-/g, '');
          if (accUuid) {
            const serverParam = selected.serverUrl ? `&serverUrl=${encodeURIComponent(selected.serverUrl)}` : '';
            const usernameParam = selected.username ? `&username=${encodeURIComponent(selected.username)}` : '';
            const offlineParam = (selected.type === 'offline' && !selected.serverUrl) ? '&offline=1' : '';
            const newUrl = `/api/avatar?uuid=${accUuid}${serverParam}${usernameParam}${offlineParam}&_=${ts}`;
            const homeAvatar = document.getElementById('home-avatar');
            if (homeAvatar) {
              const existingImg = homeAvatar.querySelector('.account-avatar-img');
              if (existingImg && existingImg.src && existingImg.src.includes('/api/avatar')) {
                existingImg.src = newUrl;
              }
            }
            try { localStorage.setItem('cachedAvatarUrl', newUrl); } catch(e) {}
          }
        }
      }).catch(() => {});
    }
  } catch (e) {}
}

async function _loadAvatarImg(container, uuid, serverUrl, username, type, cacheVersion) {
  if (!container || !uuid) return;
  container.innerHTML = '';
  container.style.backgroundImage = '';
  const img = document.createElement('img');
  // 主页头像容器用独立类名 home-avatar-img，避免全局 .account-avatar-img 的 64px 限制
  const isHome = container && (container.classList.contains('home-avatar-img-wrap') || container.id === 'home-avatar');
  img.className = isHome ? 'home-avatar-img' : 'account-avatar-img';
  // 头像图必须跟随容器缩放，不能写死 64px，否则容器放大而图不变
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  img.style.imageRendering = 'pixelated';
  img.style.display = 'block';

  const offline = (type === 'offline' && !serverUrl) ? '1' : '0';
  const cacheKey = `${offline}|${uuid || ''}|${serverUrl || ''}|${username || ''}`;
  const cachedFinal = S._avatarMemCache.get(cacheKey);
  if (cachedFinal) {
    img.src = cachedFinal;
    container.appendChild(img);
    return;
  }

  if (window.__TAURI__ && window.__TAURI__.core) {
    try {
      const result = await window.__TAURI__.core.invoke('get_avatar', {
        uuid,
        serverUrl: serverUrl || undefined,
        username: username || undefined,
        offline: offline === '1'
      });
      if (result && result.success && result.data_url) {
        img.onload = function() {
          try {
            if (result.is_full_skin) {
              const cropped = cropSkinHeadCanvas(this, 64);
              if (cropped) { this.onload = null; try { S._avatarMemCache.set(cacheKey, cropped); } catch(e) {} this.src = cropped; return; }
            }
            try { S._avatarMemCache.set(cacheKey, result.data_url); } catch(e) {}
          } catch(e) {}
        };
        img.src = result.data_url;
        container.appendChild(img);
        return;
      }
    } catch(e) {
      // 回退到后续逻辑
    }
  }

  // 非 Tauri 或 invoke 失败：HTTP 回退
  const httpUrl = `/api/avatar?uuid=${uuid}${serverUrl ? '&serverUrl=' + encodeURIComponent(serverUrl) : ''}${username ? '&username=' + encodeURIComponent(username) : ''}${offline === '1' ? '&offline=1' : ''}&_=${cacheVersion || Date.now()}`;
  fetch(httpUrl).then(resp => {
    const isFullSkin = resp.headers.get('X-Is-Full-Skin') === 'true';
    return resp.blob().then(blob => ({ blob, isFullSkin }));
  }).then(({ blob, isFullSkin }) => {
    const objUrl = URL.createObjectURL(blob);
    img.onload = function() {
      try {
        if (isFullSkin) {
          const cropped = cropSkinHeadCanvas(this, 64);
          if (cropped) { this.onload = null; try { S._avatarMemCache.set(cacheKey, cropped); } catch(e) {} this.src = cropped; URL.revokeObjectURL(objUrl); return; }
        }
        URL.revokeObjectURL(objUrl);
        try { S._avatarMemCache.set(cacheKey, objUrl); } catch(e) {}
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this, 0, 0, 64, 64);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl && dataUrl.length > 100) {
          try { localStorage.setItem('cachedAvatarData', dataUrl); } catch(e) {}
        }
      } catch(e) {}
    };
    img.src = objUrl;
    container.appendChild(img);
  }).catch(() => {
    img.src = httpUrl;
    img.onerror = function() {
      img.style.display = 'none';
      setTimeout(() => {
        const retryImg = document.createElement('img');
        retryImg.src = httpUrl.split('&_=')[0] + '&_=' + Date.now();
        retryImg.className = isHome ? 'home-avatar-img' : 'account-avatar-img';
        retryImg.style.width = '100%';
        retryImg.style.height = '100%';
        retryImg.style.objectFit = 'contain';
        retryImg.style.imageRendering = 'pixelated';
        retryImg.style.display = 'block';
        retryImg.onload = function() {
          container.innerHTML = '';
          container.appendChild(retryImg);
        };
      }, 2000);
    };
    container.appendChild(img);
  });
}

async function _loadAvatarImgInto(img, uuid, serverUrl, username, type) {
  if (!img) return;
  const offline = (type === 'offline' && !serverUrl) ? '1' : '0';
  const cacheKey = `${offline}|${uuid || ''}|${serverUrl || ''}|${username || ''}`;
  const cached = S._avatarMemCache.get(cacheKey);
  if (cached) {
    img.src = cached;
    return;
  }
  // 空 uuid：离线账户后端会用 Steve 头像；无 uuid 且非离线则用占位图标
  if (!uuid) {
    if (offline !== '1') {
      img.src = 'img/icon.png';
      return;
    }
  }

  // 给定一个图片 URL（皮肤或纯头像），按 isFullSkin 决定是否裁剪，返回最终头像 dataURL
  const resolveFinal = (src, isFullSkin) => new Promise(resolve => {
    const probe = new Image();
    probe.onload = () => {
      try {
        // 后端已标记为整张皮肤（含 64x64 带帽层皮肤），统一裁剪出头盔
        if (isFullSkin && probe.width >= 64 && probe.height >= 32) {
          const cropped = cropSkinHeadCanvas(probe, Math.min(128, probe.width));
          if (cropped) { resolve(cropped); return; }
        }
        resolve(src);
      } catch(e) { resolve(src); }
    };
    probe.onerror = () => resolve(src);
    probe.src = src;
  });

  const applyFinal = (finalDataUrl) => {
    try { if (finalDataUrl) S._avatarMemCache.set(cacheKey, finalDataUrl); } catch(e) {}
    img.src = finalDataUrl;
  };

  if (window.__TAURI__ && window.__TAURI__.core) {
    try {
      const result = await window.__TAURI__.core.invoke('get_avatar', {
        uuid,
        serverUrl: serverUrl || undefined,
        username: username || undefined,
        offline: offline === '1'
      });
      if (result && result.success && result.data_url) {
        const final = await resolveFinal(result.data_url, !!result.is_full_skin);
        applyFinal(final);
        return;
      }
    } catch(e) {}
  }
  // 回退到 HTTP
  const httpUrl = `/api/avatar?uuid=${uuid}${serverUrl ? '&serverUrl=' + encodeURIComponent(serverUrl) : ''}${username ? '&username=' + encodeURIComponent(username) : ''}${offline === '1' ? '&offline=1' : ''}&_=${Date.now()}`;
  fetch(httpUrl).then(resp => {
    const isFullSkin = resp.headers.get('X-Is-Full-Skin') === 'true';
    return resp.blob().then(blob => ({ blob, isFullSkin }));
  }).then(({ blob, isFullSkin }) => {
    const objUrl = URL.createObjectURL(blob);
    resolveFinal(objUrl, isFullSkin).then(final => {
      applyFinal(final);
      URL.revokeObjectURL(objUrl);
    });
  }).catch(() => { img.src = httpUrl; });
}

export { _tauriFetch, _fetchDataUrl, _reloadSkinViewer, getSkinFigureImage, _renderSkinFigure, _fetchAccountSkinTexture, _whenSkinCardVisible, _invalidateAvatarCache, _refreshAccountAvatars, _loadAvatarImg, _loadAvatarImgInto };
