// 资源详情：打开材质/光影/数据包/整合包详情并渲染版本列表。
import { API } from '../../core/api.js';
import { escapeHtml } from '../../core/utils.js';
import { formatNumber } from '../misc/ui-components.js';
import { setLocalImage, renderModDescription, renderModGallery, renderMdSidebar, resetMdDetailView, renderMdVersionList, _projectDataCache, _versionPreloadCache } from './mod-detail.js';
import { navigateToPage } from '../../core/navigation.js';
import { goBackFromDetail, pushModDetailHistory } from '../versions/versions-detail-history.js';
import { modDetailState } from './detail-state.js';
import { appState } from '../../core/app-state.js';
import { formatModNameWithChinese } from './chinese-names.js';
import { actionAttrs } from '../../core/actions.js';

async function openResourceDetail(projectId, type, source) {
  pushModDetailHistory();
  appState.currentModDetailId = projectId;
  appState.currentModDetailSource = source || 'modrinth';
  modDetailState.type = type;

  // 资源详情（材质/光影/数据包/整合包）不展示加载器/版本兼容卡片
  const compatSection = document.getElementById('md-compat-section');
  if (compatSection) compatSection.style.display = 'none';

  navigateToPage('mod-detail');
  resetMdDetailView();

  const depsSection = document.getElementById('md-deps-section');
  if (depsSection) depsSection.style.display = 'none';
  if (type !== 'mod' && appState.modMultiSelectMode) {
    appState.modMultiSelectMode = false;
  }
  modDetailState.deps = [];
  modDetailState.depsResolved = {};
  modDetailState.depsVersionInfo = {};

  const backBtn = document.querySelector('#page-mod-detail .moddetail-page-header .btn-icon');
  if (backBtn) backBtn.addEventListener('click', () => goBackFromDetail());

  const mdName = document.getElementById('md-name');
  const mdDesc = document.getElementById('md-desc');
  const mdIconImg = document.getElementById('md-icon-img');
  const mdIconFallback = document.getElementById('md-icon-fallback');
  const mdVersionList = document.getElementById('md-version-list');
  const mdVersionTabs = document.getElementById('md-version-tabs');

  if (!mdName || !mdVersionList) return;

  // 立即清空旧内容，防止切换整合包时短暂显示上一个整合包的版本列表
  mdVersionList.innerHTML = '';
  if (mdVersionTabs) mdVersionTabs.innerHTML = '';

  // 竞态保护：记录本次请求的 ID，API 返回时检查是否仍是最新的
  const _reqId = projectId;

  const typeNames = { mod: '模组', modpack: '整合包', resourcepack: '材质包', shader: '光影包', datapack: '数据包' };

  const cachedRaw = _projectDataCache.get(projectId);
  const cached = (cachedRaw && typeof cachedRaw.body === 'string') ? cachedRaw : null;
  if (cached) {
    modDetailState.data = cached;
    mdName.textContent = formatModNameWithChinese(cached.slug || cached.id, cached.title || typeNames[type] || '未知');
    if (mdDesc) mdDesc.textContent = (cached.description || '').substring(0, 200);
    if (cached.icon && mdIconImg && mdIconFallback) { mdIconImg.style.display = ''; mdIconFallback.style.display = 'none'; setLocalImage(mdIconImg, cached.icon, source); }
    const mdDownloads = document.getElementById('md-downloads');
    const mdFollowers = document.getElementById('md-followers');
    if (mdDownloads) mdDownloads.textContent = `⬇ ${formatNumber(cached.downloads || 0)}`;
    if (mdFollowers) mdFollowers.textContent = `❤ ${formatNumber(cached.followers || 0)}`;
    const srcBadge = document.getElementById('md-source-badge');
    if (srcBadge) { srcBadge.textContent = typeNames[type] || type; srcBadge.style.color = '#f59e0b'; srcBadge.style.background = 'rgba(245,158,11,0.12)'; }
    renderModDescription(cached);
    renderModGallery(cached);
    renderMdSidebar(cached);
  } else {
    mdName.textContent = '加载中...';
  }

  const _hasPreloaded = _versionPreloadCache.has(projectId);
  let _resLoadingTimer = null;
  if (!_hasPreloaded) {
    _resLoadingTimer = setTimeout(() => {
      if (mdVersionList && !mdVersionList.querySelector('.mdv-group')) {
        mdVersionList.innerHTML = '<p class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">加载版本列表...</p>';
      }
    }, 400);
  }
  if (mdVersionTabs) mdVersionTabs.innerHTML = '';

  try {
    const versionsPromise = _hasPreloaded
      ? Promise.resolve(_versionPreloadCache.get(projectId))
      : API.getResourceVersions(projectId, source || 'modrinth').catch(e => { console.error('[ResDetail] getResourceVersions failed:', e); return null; });
    _versionPreloadCache.delete(projectId);
    const detailPromise = cached ? Promise.resolve(cached) : API.getModDetail(projectId, source || 'modrinth').catch(e => { console.error('[ResDetail] getModDetail failed:', e); return null; });

    const [detail, data] = await Promise.all([detailPromise, versionsPromise]);
    if (_resLoadingTimer) { clearTimeout(_resLoadingTimer); _resLoadingTimer = null; }
    // 竞态保护：如果在等待 API 期间用户已经打开了另一个整合包，丢弃本次结果
    if (appState.currentModDetailId !== _reqId) { return; }
    if (!detail) {
      mdName.textContent = '加载失败';
      mdVersionList.innerHTML = `<p class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">无法加载详情: API请求失败，请检查网络连接</p>`;
      return;
    }
    if (!cached) {
      _projectDataCache.set(projectId, detail);
      modDetailState.data = detail;
      mdName.textContent = formatModNameWithChinese(detail.slug || detail.id, detail.title || typeNames[type] || '未知');
      if (mdDesc) mdDesc.textContent = (detail.description || '').substring(0, 200);
      if (detail.icon && mdIconImg && mdIconFallback) { mdIconImg.style.display = ''; mdIconFallback.style.display = 'none'; setLocalImage(mdIconImg, detail.icon, source); }
      const mdDownloads = document.getElementById('md-downloads');
      const mdFollowers = document.getElementById('md-followers');
      if (mdDownloads) mdDownloads.textContent = `⬇ ${formatNumber(detail.downloads || 0)}`;
      if (mdFollowers) mdFollowers.textContent = `❤ ${formatNumber(detail.followers || 0)}`;
      const srcBadge = document.getElementById('md-source-badge');
      if (srcBadge) { srcBadge.textContent = typeNames[type] || type; srcBadge.style.color = '#f59e0b'; srcBadge.style.background = 'rgba(245,158,11,0.12)'; }
      renderModDescription(detail);
      renderModGallery(detail);
      renderMdSidebar(detail);
    }

    modDetailState.allVersions = data ? (data.versions || []) : [];
    if (!Array.isArray(modDetailState.allVersions)) modDetailState.allVersions = [];
    console.error('[ResDetail][debug] projectId=', projectId, 'type=', type, 'source=', source, 'versions=', modDetailState.allVersions.length, 'first=', JSON.stringify(modDetailState.allVersions[0]));

    // 详情页优先展示该资源的全部版本，不被列表页筛选条件过滤
    const tabsContainer = document.getElementById('md-version-tabs');
    const gameVersions = new Set();
    modDetailState.allVersions.forEach(v => {
      (v.gameVersions || []).forEach(gv => gameVersions.add(gv));
    });

    let tabsHtml = '<button class="md-vtab active" data-ver=""' + actionAttrs('switchMdVersionTab', '') + '>全部</button>';
    [...gameVersions].sort().reverse().forEach(gv => {
      // 使用 exact 模式确保精确版本号匹配（如 1.20.1 不会被 _versionToMajor 转为 1.20）
      tabsHtml += `<button class="md-vtab" data-ver="${escapeHtml(gv)}"${actionAttrs('switchMdVersionTab', gv, 'exact')}>${escapeHtml(gv)}</button>`;
    });
    if (tabsContainer) tabsContainer.innerHTML = tabsHtml;

    renderMdVersionList(modDetailState.allVersions);
  } catch (e) {
    mdName.textContent = '加载失败';
    mdVersionList.innerHTML = `<p class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">无法加载详情: ${e.message || e}</p>`;
  }
}

export { openResourceDetail };
