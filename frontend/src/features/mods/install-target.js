import { API as API } from '../../core/api.js';
import { bridge as bridge } from '../../core/tauri-bridge.js';
import { getCustomSelectValue as getCustomSelectValue } from '../misc/custom-select.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { modDetailState as modDetailState } from './detail-state.js';
import { appState as appState } from '../../core/app-state.js';
import { createApp as createApp } from 'vue';
import { S } from './install-state.js';
import { installModFile } from './install-entry.js';
import { updateModSelectUI } from './install-batch.js';

function resolveModTarget(gameVersions, loaders) {
  const gvs = (gameVersions || []).map(String);
  const lds = (loaders || []).map(String).map(l => l.toLowerCase());
  const LD = ['forge', 'fabric', 'neoforge', 'quilt'];
  let loader = lds.find(l => LD.includes(l)) || '';
  if (!loader) {
    loader = gvs.find(g => LD.includes(g.toLowerCase())) || '';
  }
  let game = gvs.find(g => /^\d+(\.\d+)+$/.test(g)) || '';
  return { game, loader };
}

function resolveModVersionTarget(versionId) {
  try {
    const versions = (typeof modDetailState.allVersions !== 'undefined' ? modDetailState.allVersions : []);
    const v = versions.find(x => x && x.id === versionId);
    if (v) return resolveModTarget(v.gameVersions, v.loaders);
  } catch (e) {}
  return { game: '', loader: '' };
}

async function ensureInstalledVersions() {
  if (Array.isArray(appState.installedVersions) && appState.installedVersions.length > 0) return true;
  try {
    const data = await API.getVersions(false);
    appState.installedVersions = (data && data.installed) || [];
    if (!Array.isArray(appState.installedVersions)) appState.installedVersions = [];
    appState.allVersions = (data && data.versions) || [];
    if (!Array.isArray(appState.allVersions)) appState.allVersions = [];
    return appState.installedVersions.length > 0;
  } catch (e) {
    console.warn('[matchInstalledVersion] 拉取已安装版本失败:', e);
    return false;
  }
}

function matchInstalledVersion(game, loader) {
  const gl = String(game || '').toLowerCase();
  const lc = String(loader || '').toLowerCase();
  if (!Array.isArray(appState.installedVersions) || appState.installedVersions.length === 0) return '';
  const isL = v => {
    if (lc === 'forge') return !!v.isForge;
    if (lc === 'neoforge') return !!v.isNeoForge;
    if (lc === 'fabric') return !!v.isFabric;
    if (lc === 'quilt') return !!v.isFabric;
    return true;
  };
  const arr = appState.installedVersions.filter(v => v && isL(v));
  if (!arr.length) return '';
  // 优先精确匹配游戏版本；游戏版本未知时退化为仅按加载器匹配
  const glArr = gl ? arr.filter(v => (
    (v.baseVersion || '').toLowerCase() === gl ||
    (v.id || '').toLowerCase().includes(gl)
  )) : arr;
  const pool = glArr.length ? glArr : arr;
  const baseMatch = gl ? pool.filter(v => (v.baseVersion || '').toLowerCase() === gl) : [];
  const usePool = baseMatch.length ? baseMatch : pool;
  const pref = usePool.filter(v => (v.id || '').toLowerCase().startsWith(gl || (v.baseVersion || '').toLowerCase()));
  return (pref[0] || usePool[0]).id || '';
}

function installModFileSafe(el) {
  if (!el) return;
  const vid = decodeURIComponent(atob(el.dataset.vid || ''));
  const fid = decodeURIComponent(atob(el.dataset.fid || ''));
  installModFile(appState.currentModDetailId, appState.currentModDetailSource, vid, fid);
}

function addModFromDetail(projectId, source, safeVid, safeFid) {
  const vid = decodeURIComponent(atob(safeVid || ''));
  const fid = decodeURIComponent(atob(safeFid || ''));

  const t = resolveModVersionTarget(vid);

  if (appState.modSelectedIds.has(projectId)) {
    const existing = appState.modSelectedVersions.get(projectId);
    if (existing && existing.versionId === vid && existing.fileId === fid) {
      appState.modSelectedIds.delete(projectId);
      appState.modSelectedVersions.delete(projectId);
      showToast('已从选择中移除', 'info');
    } else {
      appState.modSelectedVersions.set(projectId, {
        versionId: vid,
        fileId: fid,
        source: source,
        gameVersion: t.game,
        loader: t.loader
      });
      showToast('已更新选择的版本', 'success');
    }
  } else {
    appState.modSelectedIds.add(projectId);
    appState.modSelectedVersions.set(projectId, {
      versionId: vid,
      fileId: fid,
      source: source,
      gameVersion: t.game,
      loader: t.loader
    });
    showToast('已添加到下载列表', 'success');
  }
  updateModSelectUI();

  const container = document.getElementById('md-version-list');
  if (container) {
    container.querySelectorAll('.mdv-file-item').forEach(item => {
      const btn = item.querySelector('.mdv-install-btn');
      if (!btn) return;
      const itemVid = decodeURIComponent(atob(item.dataset.vid || ''));
      const itemFid = decodeURIComponent(atob(item.dataset.fid || ''));
      const isSelected = appState.modSelectedIds.has(projectId);
      const isCurrentVersion = isSelected && appState.modSelectedVersions.get(projectId)?.versionId === itemVid;
      btn.textContent = isCurrentVersion ? '已添加' : '添加';
      btn.classList.toggle('btn-secondary', isCurrentVersion);
      btn.classList.toggle('btn-primary', !isCurrentVersion);
    });
    container.querySelectorAll('.mdv-header-btn.mdv-install-btn').forEach(btn => {
      const itemVid = decodeURIComponent(atob(btn.dataset.vid || ''));
      const isSelected = appState.modSelectedIds.has(projectId);
      const isCurrentVersion = isSelected && appState.modSelectedVersions.get(projectId)?.versionId === itemVid;
      btn.textContent = isCurrentVersion ? '已添加' : '添加';
      btn.classList.toggle('btn-secondary', isCurrentVersion);
      btn.classList.toggle('btn-primary', !isCurrentVersion);
    });
  }
}

async function resolveModSavePath(versionId) {
  try {
    const filterVersion = getCustomSelectValue('mod-filter-version');
    const filterLoader = getCustomSelectValue('mod-filter-loader');
    const targetGame = S._mdSaveGame || filterVersion || '';
    const targetLoader = S._mdSaveLoader || filterLoader || '';
    await ensureInstalledVersions();
    const matched = matchInstalledVersion(targetGame, targetLoader);
    const vid = matched || versionId || appState._modDownloadVersionId || filterVersion || '';
    console.warn('[resolveModSavePath] targetGame=', targetGame, 'targetLoader=', targetLoader,
      'installedCount=', (appState.installedVersions || []).length, 'matched=', matched, 'vid=', vid);
    // 版本感知解析：优先调用支持 versionId 的后端命令，目录以传入版本为准，
    // 避免 HTTP 路由回退到 selectedVersion 导致 Forge 模组落到其它目录
    let path = '';
    if (vid && bridge && typeof bridge.getDefaultModPath === 'function') {
      const r = await bridge.getDefaultModPath(vid).catch(() => null);
      if (typeof r === 'string' && r) path = r;
    }
    if (!path) {
      const res = await API.getDefaultModPath(vid).catch(e => { console.warn('[resolveModSavePath] getDefaultModPath error:', e); return null; });
      if (typeof res === 'string') {
        path = res;
      } else if (res && typeof res === 'object') {
        path = res.path || res.data || '';
      }
    }
    console.warn('[resolveModSavePath] path=', path);
    if (path) return path;
  } catch (e) {
    console.warn('[resolveModSavePath] error:', e);
  }
  const _fb = await getSelectedVersionModsPath();
  if (_fb) return _fb;
  return localStorage.getItem('lastModSavePath') || '';
}

async function resolveResourceSavePath(type) {
  const folderName = S.resourceFolderMap[type];
  if (!folderName) return '';
  const storageKey = 'lastResourceSavePath_' + type;
  try {
    const res = await API.getDefaultResourcePath(type).catch(() => null);
    let p = '';
    if (typeof res === 'string') {
      p = res;
    } else if (res && typeof res === 'object') {
      p = res.path || res.data || '';
    }
    if (p) return p;
  } catch (e) {}
  return localStorage.getItem(storageKey) || '';
}

async function getSelectedVersionModsPath() {
  try {
    let selVid = '';
    if (typeof appState.homeVersionCustomSelect !== 'undefined' && appState.homeVersionCustomSelect) {
      selVid = appState.homeVersionCustomSelect.getValue() || '';
    }
    if (!selVid) {
      const settings = await API.getSettings().catch(() => ({}));
      selVid = settings.selectedVersion || '';
    }
    if (selVid) {
      let p = '';
      if (bridge && typeof bridge.getDefaultModPath === 'function') {
        const r = await bridge.getDefaultModPath(selVid).catch(() => null);
        if (typeof r === 'string' && r) p = r;
      }
      if (!p) {
        const res = await API.getDefaultModPath(selVid).catch(() => null);
        if (typeof res === 'string') {
          p = res;
        } else if (res && typeof res === 'object') {
          p = res.path || res.data || '';
        }
      }
      if (p) return p;
    }
  } catch (e) {
    console.warn('[getSelectedVersionModsPath] error:', e);
  }
  return localStorage.getItem('lastModSavePath') || '';
}

async function resolveModSavePathWithConfirm() {
  const filterVersion = getCustomSelectValue('mod-filter-version') || '';
  const filterLoader = getCustomSelectValue('mod-filter-loader') || '';
  const targetGame = S._mdSaveGame || filterVersion || '';
  const targetLoader = S._mdSaveLoader || filterLoader || '';

  // 优先使用按常规逻辑解析的默认保存文件夹（选中版本兼容则用之，否则择优）
  let resolved = null;
  try {
    if (bridge && typeof bridge.getDefaultModSaveFolder === 'function') {
      resolved = await bridge.getDefaultModSaveFolder(targetGame, targetLoader);
      console.warn('[mod-folder] backend 入参=', targetGame, targetLoader, '返回=', JSON.stringify(resolved));
    }
  } catch (e) {
    console.warn('[resolveModSavePathWithConfirm] getDefaultModSaveFolder error:', e);
  }

  if (resolved && resolved.path) {
    if (resolved.selectedCompatible || resolved.compatible) {
      return resolved.path;
    }
    const ok = await showNoFolderConfirmCard('该版本没有对应的版本文件夹，将会打开已选择版本的 mod 文件夹');
    if (!ok) return null;
    return getSelectedVersionModsPath();
  }

  // 备选：命令不可用时的旧版匹配逻辑
  await ensureInstalledVersions();
  const matched = matchInstalledVersion(targetGame, targetLoader);
  if (matched) {
    return resolveModSavePath();
  }
  const ok = await showNoFolderConfirmCard('该版本没有对应的版本文件夹，将会打开已选择版本的 mod 文件夹');
  if (!ok) return null;
  return getSelectedVersionModsPath();
}

function showNoFolderConfirmCard(message) {
  return new Promise((resolve) => {
    if (S._noFolderApp) {
      try { S._noFolderApp.unmount(); } catch (e) {}
      S._noFolderApp = null;
    }
    let host = document.getElementById('mod-no-folder-card-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mod-no-folder-card-host';
      document.body.appendChild(host);
    } else {
      host.innerHTML = '';
    }
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (S._noFolderApp) {
        try { S._noFolderApp.unmount(); } catch (e) {}
        S._noFolderApp = null;
      }
      if (host) host.innerHTML = '';
      resolve(val);
    };
    const App = {
      data() {
        return {
          visible: false,
          message: message || '该版本没有对应的版本文件夹，将会打开已选择版本的 mod 文件夹',
          confirmText: '确定',
          cancelText: '取消'
        };
      },
      mounted() {
        this.visible = true;
      },
      methods: {
        confirm() { finish(true); },
        cancel() { finish(false); }
      },
      template: `
        <transition name="modnf-fade">
          <div class="modnf-overlay" v-if="visible" @click.self="cancel" role="presentation">
            <div class="modnf-card" role="dialog">
              <div class="modnf-icon">📂</div>
              <div class="modnf-title">提示</div>
              <p class="modnf-message">{{ message }}</p>
              <div class="modnf-actions">
                <button type="button" class="btn btn-secondary btn-sm" @click="cancel">{{ cancelText }}</button>
                <button type="button" class="btn btn-primary btn-sm" @click="confirm">{{ confirmText }}</button>
              </div>
            </div>
          </div>
        </transition>`
    };
    S._noFolderApp = createApp(App).mount(host);
  });
}

export { resolveModTarget, resolveModVersionTarget, ensureInstalledVersions, matchInstalledVersion, installModFileSafe, addModFromDetail, resolveModSavePath, resolveResourceSavePath, getSelectedVersionModsPath, resolveModSavePathWithConfirm, showNoFolderConfirmCard };
