// 安装路径解析：只依赖状态与后端接口，供安装各阶段共用，
// 避免路径解析与安装编排相互依赖。
import { API } from '../../core/api.js';
import { bridge } from '../../core/tauri-bridge.js';
import { getCustomSelectValue } from '../misc/custom-select.js';
import { appState } from '../../core/app-state.js';
import { S } from './install-state.js';

export async function ensureInstalledVersions() {
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

export function matchInstalledVersion(game, loader) {
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

export async function getSelectedVersionModsPath() {
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

export async function resolveModSavePath(versionId) {
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

export async function resolveResourceSavePath(type) {
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
