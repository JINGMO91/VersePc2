import { API as API } from '../../core/api.js';
import { escapeHtml as escapeHtml, formatDate as formatDate } from '../../core/utils.js';
import { getCustomSelectValue as getCustomSelectValue } from '../misc/custom-select.js';
import { formatNumber as formatNumber } from '../misc/ui-components.js';
import { getLoaderFileIcon as getLoaderFileIcon } from './mod-install.js';
import { modDetailState as modDetailState } from './detail-state.js';
import { appState as appState } from '../../core/app-state.js';
import { actionAttrs as actionAttrs, actionAttrsStop as actionAttrsStop } from '../../core/actions.js';
import { S } from './mod-detail-state.js';
import { _versionToExact, _versionToMajor, _sortVersionsByNumber } from './mod-version-utils.js';
import { loadModDependencies } from './mod-detail-deps.js';

function preloadModVersions(projectId, source) {
  if (S._versionPreloadCache.has(projectId) || S._versionPreloadInFlight.has(projectId)) return;
  S._versionPreloadInFlight.add(projectId);
  API.getModVersions(projectId, source || 'modrinth').then(data => {
    S._versionPreloadCache.set(projectId, data);
    S._versionPreloadInFlight.delete(projectId);
  }).catch(() => { S._versionPreloadInFlight.delete(projectId); });
}

function _renderVersionTabs(mode, tabMap, sortedKeys) {
  const tabsContainer = document.getElementById('md-version-tabs');
  let tabsHtml = '<button class="md-vtab active" data-ver=""' + actionAttrs('switchMdVersionTab', '') + '>全部</button>';
  sortedKeys.forEach(key => {
    tabsHtml += `<button class="md-vtab" data-group="${mode}" data-ver="${escapeHtml(key)}"${actionAttrs('switchMdVersionTab', key, mode)}>${escapeHtml(key)} (${tabMap.get(key)})</button>`;
  });
  if (tabsContainer) tabsContainer.innerHTML = tabsHtml;
}

function renderMdVersionTabs(detailSeq) {
  if (detailSeq !== undefined && detailSeq !== modDetailState.seq) { return; }

  const tabsContainer = document.getElementById('md-version-tabs');

  // 详情页默认展示该模组的全部版本，不被列表页筛选条件自动过滤；
  // 用户可通过版本标签手动筛选，或点击"全部"查看全部版本
  const exactMap = new Map();
  const majorMap = new Map();
  let hasSnapshot = false;
  modDetailState.allVersions.forEach(v => {
    (v.gameVersions || []).forEach(gv => {
      if (gv.includes('w') || gv.includes('snapshot')) { hasSnapshot = true; return; }
      const exact = _versionToExact(gv);
      const major = _versionToMajor(gv);
      if (exact) exactMap.set(exact, (exactMap.get(exact) || 0) + 1);
      if (major) majorMap.set(major, (majorMap.get(major) || 0) + 1);
    });
  });

  const MAX_TABS = 9;
  let mode = 'exact';
  let tabMap = exactMap;
  if (tabMap.size > MAX_TABS) { mode = 'major'; tabMap = majorMap; }
  if (tabMap.size > MAX_TABS) { mode = 'major'; tabMap = majorMap; }

  const sortFn = (a, b) => {
    if (a === '快照版') return -1;
    if (b === '快照版') return 1;
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    if (pa[0] !== pb[0]) return pb[0] - pa[0];
    return (pb[1] || 0) - (pa[1] || 0);
  };
  const sortedKeys = [...tabMap.keys()].sort(sortFn);

  if (tabsContainer) {
    let tabsHtml = '<button class="md-vtab active" data-ver=""' + actionAttrs('switchMdVersionTab', '') + '>全部</button>';
    sortedKeys.forEach(key => {
      tabsHtml += `<button class="md-vtab" data-group="${mode}" data-ver="${escapeHtml(key)}"${actionAttrs('switchMdVersionTab', key, mode)}>${escapeHtml(key)}</button>`;
    });
    tabsContainer.innerHTML = tabsHtml;
  }
  S.mdTabMode = mode;
  modDetailState.tab = '';
  renderMdVersionList(modDetailState.allVersions);
}

async function loadMdVersions(projectId, source, detailSeq) {
  try {
    const data = await API.getModVersions(projectId, source);
    if (detailSeq !== undefined && detailSeq !== modDetailState.seq) { return; }
    modDetailState.allVersions = data.versions || [];
    if (!Array.isArray(modDetailState.allVersions)) modDetailState.allVersions = [];

    loadModDependencies();
    await renderMdVersionTabs(detailSeq);
  } catch (e) {
    console.error('[MDVersions] Error:', e);
    document.getElementById('md-version-list').innerHTML = '<p class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">加载版本列表失败</p>';
  }
}

function switchMdVersionTab(ver, mode) {
  modDetailState.tab = ver;
  
  document.querySelectorAll('.md-vtab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.ver === ver);
  });

  let filtered = modDetailState.allVersions;
  if (ver && ver !== '') {
    if (ver === '_filtered') {
      const currentGameVersion = getCustomSelectValue('mod-filter-version');
      const currentLoader = getCustomSelectValue('mod-filter-loader');
      filtered = modDetailState.allVersions.filter(v => {
        const gv = v.gameVersions || [];
        const loaders = (v.loaders || []).map(l => l.toLowerCase());
        let match = true;
        if (currentGameVersion && !gv.includes(currentGameVersion)) match = false;
        if (currentLoader && !loaders.includes(currentLoader.toLowerCase())) match = false;
        return match;
      });
    } else {
      const useMode = mode || S.mdTabMode || 'major';
      filtered = modDetailState.allVersions.filter(v => {
        return (v.gameVersions || []).some(gv => {
          if (useMode === 'exact') return _versionToExact(gv) === ver;
          return _versionToMajor(gv) === ver;
        });
      });
    }
  }

  renderMdVersionList(filtered);
}

function _buildVersionItemHtml(v, idx) {
  const verNum = v.versionNumber || v.versionName || v.id.substring(0, 12);
  const gvs = (v.gameVersions || []).slice(0, 3).join(', ');
  const releaseType = v.releaseType === 'release' ? '' : (v.releaseType === 'beta' ? '测试版' : '');
  const files = v.files || [];
  const fileCount = files.length;
  
  const loaders = v.loaders || [];
  const loaderBadges = loaders.map(l => {
    const ll = l.toLowerCase();
    let color = '#888', bg = 'rgba(136,136,136,0.15)';
    if (ll === 'fabric') { color = '#dbb07c'; bg = 'rgba(219,176,124,0.15)'; }
    else if (ll === 'forge') { color = '#4a6b8a'; bg = 'rgba(74,107,138,0.15)'; }
    else if (ll === 'neoforge') { color = '#f47733'; bg = 'rgba(244,119,51,0.15)'; }
    else if (ll === 'quilt') { color = '#9b59b6'; bg = 'rgba(155,89,182,0.15)'; }
    return `<span class="loader-badge" style="background:${bg};color:${color}">${escapeHtml(l)}</span>`;
  }).join('');

  const safeVid = btoa(encodeURIComponent(v.id || ''));
  const primaryFile = files[0] || {};
  const safeFid = btoa(encodeURIComponent(primaryFile.id || ''));
  const isMod = modDetailState.type === 'mod';
  const isModpack = modDetailState.type === 'modpack';
  const hasMultipleFiles = fileCount > 1;

  let primaryBtnHtml;
  if (appState.modMultiSelectMode && isMod) {
    const alreadySelected = appState.modSelectedIds.has(appState.currentModDetailId);
    primaryBtnHtml = `<button class="btn ${alreadySelected ? 'btn-secondary' : 'btn-primary'} btn-sm mdv-install-btn mdv-header-btn" data-vid="${safeVid}" data-fid="${safeFid}"${actionAttrsStop('addModFromDetail', appState.currentModDetailId, appState.currentModDetailSource, safeVid, safeFid)}>${alreadySelected ? '已添加' : '添加'}</button>`;
  } else if (isModpack) {
    primaryBtnHtml = `<button class="btn btn-primary btn-sm mdv-header-btn"${actionAttrsStop('installModpackVersion', appState.currentModDetailId, v.id)}>下载</button>`;
  } else if (isMod) {
    primaryBtnHtml = `<button class="btn btn-primary btn-sm mdv-header-btn"${actionAttrsStop('installModFile', appState.currentModDetailId, appState.currentModDetailSource, v.id, primaryFile.id || '')}>安装</button>`;
  } else {
    primaryBtnHtml = `<button class="btn btn-primary btn-sm mdv-header-btn"${actionAttrsStop('quickInstallResourceVersion', appState.currentModDetailId, modDetailState.type, v.id)}>安装</button>`;
  }

  const sizeText = fileCount > 0 ? formatNumber(Math.round((primaryFile.size || 1024) / 1024)) + ' KB' : '';

  return `<div class="mdv-group${hasMultipleFiles ? '' : ' single-file'}" id="mdvg-${idx}">
    <div class="mdv-group-header"${hasMultipleFiles ? actionAttrs('toggleMdvGroup', idx) : ''}>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="mdv-group-title">${escapeHtml(verNum)}</span>
        ${loaderBadges}
        <span style="font-size:11px;color:var(--text-muted)">${gvs}</span>
        ${releaseType ? `<span class="lver-badge" style="margin-left:4px">${releaseType}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        ${hasMultipleFiles ? `<span style="font-size:11px;color:var(--text-muted)">${fileCount} 个文件</span>` : (sizeText ? `<span style="font-size:11px;color:var(--text-muted)">${sizeText}</span>` : '')}
        ${primaryBtnHtml}
        ${hasMultipleFiles ? '<svg class="mdv-expand-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' : ''}
      </div>
    </div>
    ${hasMultipleFiles ? `<div class="mdv-files">
      ${files.map(f => {
        const fname = f.filename || f.name || f.id;
        const size = formatNumber(Math.round((f.size || 1024) / 1024)) + ' KB';
        const dateStr = f.datePublished ? formatDate(f.datePublished).split(' ')[0] : '';
        const stableBadge = f.releaseType === 'release' ? '<span class="lver-badge">稳定</span>' : 
                 (f.releaseType === 'beta' ? '<span class="lver-badge">测试版</span>' : '');
        const loaderIcon = getLoaderFileIcon(fname);
        const safeFid2 = btoa(encodeURIComponent(f.id || ''));
        let addBtn, rowOnclick;
        if (appState.modMultiSelectMode && isMod) {
          const alreadySelected = appState.modSelectedIds.has(appState.currentModDetailId);
          addBtn = `<button class="btn ${alreadySelected ? 'btn-secondary' : 'btn-primary'} btn-sm mdv-install-btn"${actionAttrsStop('addModFromDetail', appState.currentModDetailId, appState.currentModDetailSource, safeVid, safeFid2)}>${alreadySelected ? '已添加' : '添加'}</button>`;
          rowOnclick = actionAttrs('addModFromDetail', appState.currentModDetailId, appState.currentModDetailSource, safeVid, safeFid2);
        } else {
          addBtn = isModpack
             ? `<button class="btn btn-primary btn-sm mdv-install-btn"${actionAttrsStop('installModpackVersionRow')}>下载</button>`
             : (isMod
               ? `<button class="btn btn-primary btn-sm mdv-install-btn"${actionAttrsStop('installModFileRow')}>安装</button>`
               : `<button class="btn btn-primary btn-sm mdv-install-btn"${actionAttrsStop('installResourceVersionRow')}>安装</button>`);
          rowOnclick = isModpack ? actionAttrs('installModpackVersionRow') : (isMod ? actionAttrs('installModFileRow') : actionAttrs('installResourceVersionRow'));
        }
        return `<div class="mdv-file-item" data-vid="${safeVid}" data-fid="${safeFid2}"${rowOnclick}>
          <div class="mdv-file-icon">${loaderIcon}</div>
          <div class="mdv-file-info">
            <div class="mdv-file-name">${escapeHtml(fname)}</div>
            <div class="mdv-file-meta">${size}${dateStr ? ' · ' + dateStr : ''}${stableBadge ? ' · ' + stableBadge : ''}</div>
          </div>
          ${addBtn}
        </div>`;
      }).join('')}
    </div>` : ''}
  </div>`;
}

function renderMdVersionList(versions) {
  const container = document.getElementById('md-version-list');
  if (!container) return;

  // 加载器筛选：只保留 loaders 中包含目标加载器的版本
  if (modDetailState.loaderFilter) {
    versions = (versions || []).filter(v =>
      (v.loaders || []).some(l => l.toLowerCase() === modDetailState.loaderFilter));
  }

  if (!versions || versions.length === 0) {
    container.innerHTML = `<p class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">${modDetailState.loaderFilter ? '该加载器下无匹配版本' : '无匹配版本'}</p>`;
    return;
  }

  const sorted = _sortVersionsByNumber(versions);
  modDetailState.currentVersions = sorted;
  modDetailState.renderedCount = 0;
  const initial = sorted.slice(0, S.MDV_INITIAL_RENDER);
  container.innerHTML = initial.map((v, i) => _buildVersionItemHtml(v, i)).join('');
  modDetailState.renderedCount = initial.length;

  if (versions.length > S.MDV_INITIAL_RENDER) {
    container.insertAdjacentHTML('beforeend', `<div id="mdv-load-more" style="text-align:center;padding:16px 0">
      <button class="btn btn-secondary"${actionAttrs('renderMdVersionListMore')}>加载更多 (${versions.length - S.MDV_INITIAL_RENDER} 个版本)</button>
    </div>`);
  }
}

function renderMdVersionListMore() {
  const container = document.getElementById('md-version-list');
  const loadMoreBtn = document.getElementById('mdv-load-more');
  if (loadMoreBtn) loadMoreBtn.remove();

  const batch = modDetailState.currentVersions.slice(modDetailState.renderedCount, modDetailState.renderedCount + S.MDV_INITIAL_RENDER);
  const fragment = document.createDocumentFragment();
  const temp = document.createElement('div');
  temp.innerHTML = batch.map((v, i) => _buildVersionItemHtml(v, modDetailState.renderedCount + i)).join('');
  while (temp.firstChild) fragment.appendChild(temp.firstChild);
  container.appendChild(fragment);
  modDetailState.renderedCount += batch.length;

  if (modDetailState.renderedCount < modDetailState.currentVersions.length) {
    container.insertAdjacentHTML('beforeend', `<div id="mdv-load-more" style="text-align:center;padding:16px 0">
      <button class="btn btn-secondary"${actionAttrs('renderMdVersionListMore')}>加载更多 (${modDetailState.currentVersions.length - modDetailState.renderedCount} 个版本)</button>
    </div>`);
  }
}

export { preloadModVersions, _renderVersionTabs, renderMdVersionTabs, loadMdVersions, switchMdVersionTab, _buildVersionItemHtml, renderMdVersionList, renderMdVersionListMore };
