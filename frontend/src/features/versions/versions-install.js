// versions-install.js — 版本安装确认与进度轮询
import { API as API } from '../../core/api.js';
import { escapeHtml as escapeHtml, formatBytes as formatBytes } from '../../core/utils.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { dlManager as dlManager } from './custom-download.js';
import { appState as appState } from '../../core/app-state.js';
import { actionAttrs as actionAttrs } from '../../core/actions.js';
import { versionsState as S } from './versions-state.js';
import { navigateToPage } from '../../core/navigation.js';
import { loadVersions } from './versions-list.js';

async function loadLoaderVersions(versionId) {
  const loaders = ['forge', 'neoforge', 'fabric', 'optifine'];
  const mcMajor = parseInt(versionId.split('.')[0], 10);
  const isNewVersioning = mcMajor >= 25;
  for (const loader of loaders) {
    const descEl = document.getElementById(`loader-desc-${loader}`);
    if (!descEl) continue;
    try {
      const versions = await API.getModLoaderVersions(versionId, loader);
      if (versions && versions.length > 0) {
        const latestVer = versions[0].version || versions[0].id || versions[0] || '最新';
        const loaderNames = { forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric', optifine: 'OptiFine' };
        descEl.textContent = `${loaderNames[loader]} ${latestVer} 可用`;
      } else if (isNewVersioning && (loader === 'forge' || loader === 'neoforge')) {
        descEl.textContent = '此版本暂未适配';
      } else if (loader === 'optifine') {
        descEl.textContent = '暂不支持此版本';
      } else {
        descEl.textContent = '暂无可用版本';
      }
    } catch (e) {
      console.error(`[LoaderVersions] ${loader} error:`, e.message);
      if (descEl) descEl.textContent = '加载失败';
    }
  }
}

function selectLoaderCard(loaderType) {
  S.selectedLoaderType = loaderType;
  
  document.querySelectorAll('.loader-card').forEach(item => item.classList.remove('selected'));
  document.querySelector(`.loader-card[data-loader="${loaderType}"]`).classList.add('selected');
  
  if (loaderType) {
    populateLoaderVersionSelect(loaderType);
  } else {
    document.getElementById('loader-version-section').style.display = 'none';
    S.selectedLoaderVersion = '';
  }
  
  // Fabric 类型时显示 Fabric API 区域，其他类型隐藏
  const apiSection = document.getElementById('fabric-api-section-detail');
  if (apiSection) {
    if (loaderType === 'fabric' && S.currentVersionDetail) {
      apiSection.style.display = '';
      // 重置选择状态，点击卡片时懒加载版本列表
      S._fabricApiDetailId = '';
      S._fabricApiDetailText = '不安装';
      S._fabricApiDetailLoadedFor = '';
      S._fabricApiDetailVersions = [];
      const cardText = document.getElementById('fabric-api-card-text-detail');
      if (cardText) { cardText.textContent = '不安装'; cardText.style.color = 'var(--text-muted)'; }
    } else {
      apiSection.style.display = 'none';
    }
  }
  // 非 Fabric 或切换加载器时隐藏 picker 视图
  if (loaderType !== 'fabric') {
    const picker = document.getElementById('fabric-api-picker-detail');
    if (picker) {
      picker.style.display = 'none';
      const pageContainer = document.getElementById('page-version-detail');
      if (pageContainer && picker.parentElement !== pageContainer) {
        pageContainer.appendChild(picker);
      }
    }
    const body = document.getElementById('pvd-body');
    if (body) body.style.display = '';
    const main = document.getElementById('pvd-main');
    if (main) main.style.display = '';
    const footer = document.getElementById('pvd-footer');
    if (footer) footer.style.display = '';
  }
}

async function populateLoaderVersionSelect(loaderType) {
  const listContainer = document.getElementById('loader-version-list');
  const section = document.getElementById('loader-version-section');

  section.style.display = 'block';
  listContainer.innerHTML = '<p class="empty-text" style="padding:20px 0;text-align:center;color:var(--text-muted)">加载中...</p>';

  const loaderIcons = {
    forge: 'Anvil.png',
    neoforge: 'NeoForge.png',
    fabric: 'Fabric.png',
    optifine: 'OptiFabric.png'
  };
  const iconFile = loaderIcons[loaderType] || 'Grass.png';

  try {
    const versions = await API.getModLoaderVersions(S.currentVersionDetail.id, loaderType);
    
    if (versions && versions.length > 0) {
      const loaderNames = { forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric', optifine: 'OptiFine' };
      const loaderName = loaderNames[loaderType] || loaderType;

      listContainer.innerHTML = versions.map((v, i) => {
        const verStr = v.version || v.id || v;
        const verType = v.type || (i === 0 ? '推荐' : '');
        return `<div class="lver-item ${i === 0 ? 'selected' : ''}" data-version="${escapeHtml(verStr)}"${actionAttrs('selectLoaderVersion', verStr)}>
          <div class="lver-icon"><img src="img/${iconFile}" alt="" style="width:24px;height:24px;image-rendering:pixelated"></div>
          <div class="lver-info">
            <div class="lver-name">${loaderName} ${escapeHtml(verStr)}</div>
            <div class="lver-meta">${verType ? '<span class="lver-badge">' + escapeHtml(verType) + '</span>' : ''}</div>
          </div>
          <div class="lver-check">✓</div>
        </div>`;
      }).join('');

      S.selectedLoaderVersion = versions[0].version || versions[0].id || versions[0];
    } else {
      listContainer.innerHTML = '<p class="empty-text" style="padding:20px 0;text-align:center;color:var(--text-muted)">暂无可用版本</p>';
      S.selectedLoaderVersion = '';
    }
  } catch (e) {
    console.error('Loader version load error:', e);
    listContainer.innerHTML = '<p class="empty-text" style="padding:20px 0;text-align:center;color:var(--text-muted)">加载失败</p>';
    S.selectedLoaderVersion = '';
  }
}

function selectLoaderVersion(version) {
  S.selectedLoaderVersion = version;
  document.querySelectorAll('.lver-item').forEach(item => item.classList.remove('selected'));
  document.querySelector(`.lver-item[data-version="${version}"]`)?.classList.add('selected');
}

function confirmInstallVersion() {
  if (!S.currentVersionDetail) return;

  const downloadSource = document.querySelector('input[name="download-source"]:checked');
  const source = downloadSource ? downloadSource.value : 'mojang';

  let loaderInfo = null;
  if (S.selectedLoaderType) {
    if (!S.selectedLoaderVersion) {
      const loaderNames = { forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric', optifine: 'OptiFine' };
      const loaderName = loaderNames[S.selectedLoaderType] || S.selectedLoaderType;
      showToast(`获取${loaderName}版本失败，请重新点击${loaderName}卡片再试`, 'error');
      return;
    }
    loaderInfo = {
      type: S.selectedLoaderType,
      version: S.selectedLoaderVersion,
      fabricApiId: (S.selectedLoaderType === 'fabric' && S._fabricApiDetailId) ? S._fabricApiDetailId : '',
      fabricApiUrl: '',
      fabricApiFilename: ''
    };
    if (S.selectedLoaderType === 'fabric' && S._fabricApiDetailId) {
      const apiFile = S._fabricApiDetailVersions.find(v => v.versionId === S._fabricApiDetailId);
      if (apiFile) {
        loaderInfo.fabricApiUrl = apiFile.url || '';
        loaderInfo.fabricApiFilename = apiFile.filename || '';
      }
    }
  }
  
  let defaultName = S.currentVersionDetail.id;
  if (loaderInfo && loaderInfo.type && loaderInfo.version) {
    const loaderSuffix = loaderInfo.type === 'neoforge' ? 'NeoForge' : 
              loaderInfo.type.charAt(0).toUpperCase() + loaderInfo.type.slice(1);
    defaultName = `${S.currentVersionDetail.id}-${loaderSuffix}-${loaderInfo.version}`;
  }
  
  showVersionNameModal(defaultName, S.currentVersionDetail.url, S.currentVersionDetail.id, loaderInfo, source);
}

async function installVersionWithLoader(versionUrl, versionId, loaderInfo, downloadSource, customName = '') {
  try {
    const result = await API.installVersion(versionUrl, versionId, loaderInfo, downloadSource, customName);
    if (result.success) {
      appState.currentInstallSessionId = result.sessionId;
      // 如果有 Fabric API 待安装，保存信息供安装完成后使用
      if (loaderInfo && loaderInfo.fabricApiId) {
        S._pendingFabricApiAfterInstall = {
          gameVersion: versionId,
          apiId: loaderInfo.fabricApiId,
          url: loaderInfo.fabricApiUrl || '',
          filename: loaderInfo.fabricApiFilename || '',
          versionId: ''
        };
      } else {
        S._pendingFabricApiAfterInstall = null;
      }
      showInstallModal(versionId);
      pollInstallProgress(result.sessionId);
    } else if (result.alreadyInstalled) {
      showToast(result.message || `版本 ${versionId} 已安装`, 'info');
    } else {
      showToast(result.error || '安装失败', 'error');
    }
  } catch (e) {
    showToast('安装请求失败', 'error');
  }
}

async function installVersion(versionUrl, versionId) {
  try {
    const result = await API.installVersion(versionUrl, versionId);
    if (result.success) {
      appState.currentInstallSessionId = result.sessionId;
      showInstallModal(versionId);
      pollInstallProgress(result.sessionId);
    } else if (result.alreadyInstalled) {
      showToast(result.message || `版本 ${versionId} 已安装`, 'info');
    } else {
      showToast(result.error || '安装失败', 'error');
    }
  } catch (e) {
    showToast('安装请求失败', 'error');
  }
}

function showVersionNameModal(defaultName, versionUrl, versionId, loaderInfo, downloadSource) {
  const existing = document.getElementById('version-name-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'version-name-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';

  const card = document.createElement('div');
  card.style.cssText = 'max-width:420px;width:90%;background:var(--bg-secondary);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden;';

  card.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:15px;font-weight:600;color:var(--text-primary);">设置版本名称</span>
      <button id="vnm-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px;">✕</button>
    </div>
    <div style="padding:20px;">
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:6px;">版本名称</label>
        <input id="vnm-input" type="text" value="${defaultName.replace(/"/g, '&quot;')}" 
          style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box;" />
        <div id="vnm-hint" style="margin-top:6px;font-size:12px;color:var(--text-muted);"></div>
      </div>
      <div id="vnm-warn" style="display:none;padding:10px 12px;border-radius:8px;background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);margin-bottom:12px;">
        <span style="font-size:13px;color:var(--warning);">⚠ 已有相同名称的版本</span>
      </div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;">
      <button id="vnm-cancel" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;">取消</button>
      <button id="vnm-confirm" style="padding:8px 20px;border-radius:8px;border:none;background:var(--accent);color:var(--accent-text);cursor:pointer;font-size:13px;font-weight:500;">确认安装</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const input = document.getElementById('vnm-input');
  const hint = document.getElementById('vnm-hint');
  const warn = document.getElementById('vnm-warn');
  const confirmBtn = document.getElementById('vnm-confirm');
  let nameExists = false;

  async function checkName() {
    const name = input.value.trim();
    if (!name) {
      hint.textContent = '';
      warn.style.display = 'none';
      confirmBtn.disabled = true;
      return;
    }
    try {
      const result = await API.checkVersionName(name);
      nameExists = !result.available;
      if (nameExists) {
        warn.style.display = 'block';
        warn.textContent = '⚠ ' + (result.reason || '版本名称不可用');
        hint.textContent = '';
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
        confirmBtn.style.cursor = 'not-allowed';
      } else {
        warn.style.display = 'none';
        hint.textContent = '✓ 名称可用';
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
        confirmBtn.style.cursor = 'pointer';
      }
    } catch (e) {
      warn.style.display = 'none';
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      confirmBtn.style.cursor = 'pointer';
    }
  }

  input.addEventListener('input', checkName);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !confirmBtn.disabled) confirmBtn.click();
  });

  document.getElementById('vnm-close').onclick = () => modal.remove();
  document.getElementById('vnm-cancel').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  confirmBtn.onclick = async () => {
    const name = input.value.trim();
    if (!name || confirmBtn.disabled) return;
    
    modal.remove();
    navigateToPage('versions');
    
    setTimeout(() => {
      installVersionWithLoader(versionUrl, versionId, loaderInfo, downloadSource, name);
    }, 200);
  };

  checkName();
  input.focus();
  input.select();
}

function showInstallModal(versionId) {
  const taskId = 'version-' + appState.currentInstallSessionId;
  // 默认使用 API 图标地址，安装任务一出现就能显示对应版本图标
  let iconUrl = `/api/version-icon?id=${encodeURIComponent(versionId)}&type=release`;
  if (window.__TAURI__ && window.__TAURI__.core) {
    window.__TAURI__.core.invoke('get_version_icon', {
      id: versionId,
      versionType: 'release',
      forge: false, fabric: false, neoforge: false, modpack: false, extDir: undefined
    }).then(result => {
      if (result && result.success && result.data_url) {
        const task = dlManager.tasks.get(taskId);
        if (task) {
          task.iconUrl = result.data_url;
          dlManager.updateDom(taskId);
        }
      }
    }).catch(() => {});
  }
  dlManager.add(taskId, `安装 ${versionId}`, 'version', appState.currentInstallSessionId, iconUrl);
}

function closeInstallModal() {
  if (appState.currentInstallSessionId) {
    API.cancelInstall(appState.currentInstallSessionId);
    appState.currentInstallSessionId = null;
  }
}

function cancelInstall() {
  closeInstallModal();
  showToast('安装已取消', 'info');
}

async function pollInstallProgress(sessionId) {
  const taskId = 'version-' + sessionId;
  let smoothInstallPct = 0;
  let _pollErrorCount = 0;

  const poll = async () => {
    try {
      if (!dlManager.tasks.has(taskId)) return;
      const data = await API.getInstallProgress(sessionId);
      if (!data || !data.sessionId) return;
      _pollErrorCount = 0;

      const rawPct = data.progress || 0;
      if (rawPct > smoothInstallPct) {
        smoothInstallPct = smoothInstallPct * 0.85 + rawPct * 0.15;
      }
      const smoothPct = Math.round(smoothInstallPct);

      const downloadStatus = data.status === 'completed' ? 'completed' : data.status === 'failed' ? 'failed' : data.status === 'cancelled' ? 'failed' : 'downloading';
      const statusMessage = getStageText(data.stage) || data.message || '安装中...';

      var files = [];
      if (data.currentFile) {
        var speedText = data.speed ? formatBytes(data.speed) + '/s' : '';
        files.push({
          name: '当前文件: ' + data.currentFile,
          progress: downloadStatus === 'completed' ? 100 : (data.totalFiles ? Math.round(data.completedFiles / data.totalFiles * 100) : smoothPct),
          status: downloadStatus,
          size: speedText
        });
      }
      if (data.totalFiles > 0) {
        files.push({
          name: '文件进度: ' + data.completedFiles + ' / ' + data.totalFiles,
          progress: Math.round(data.completedFiles / data.totalFiles * 100),
          status: downloadStatus
        });
      }
      if (data.bytesDownloaded > 0 || data.totalBytes > 0) {
        var dlText = formatBytes(data.bytesDownloaded || 0);
        if (data.totalBytes) dlText += ' / ' + formatBytes(data.totalBytes);
        files.push({
          name: '下载量: ' + dlText,
          progress: data.totalBytes ? Math.round(data.bytesDownloaded / data.totalBytes * 100) : 0,
          status: downloadStatus
        });
      }
      if (data.stage) {
        files.push({
          name: '当前阶段: ' + (getStageText(data.stage) || data.stage),
          progress: downloadStatus === 'completed' ? 100 : smoothPct,
          status: data.stage === 'completed' ? 'completed' : downloadStatus
        });
      }

      dlManager.update(taskId, {
        progress: smoothPct,
        status: downloadStatus,
        message: statusMessage,
        files: files
      });

      if (data.status === 'completed') {
        showToast(data.versionId + ' 安装完成！', 'success');
        appState.currentInstallSessionId = null;
        // 安装完成后如果有待安装的 Fabric API，自动安装
        if (S._pendingFabricApiAfterInstall) {
          const fa = S._pendingFabricApiAfterInstall;
          S._pendingFabricApiAfterInstall = null;
          dlManager.update(taskId, { message: '正在安装 Fabric API...' });
          try {
            const installedId = data.versionId || fa.versionId || '';
            const apiResult = await API.installFabricApi(fa.gameVersion, fa.apiId, installedId, fa.url || '', fa.filename || '');
            if (apiResult.success) {
              showToast('Fabric API 已一并安装！', 'success');
            } else {
              showToast('Fabric API 安装失败：' + (apiResult.error || '未知错误'), 'warning', 5000);
            }
          } catch (e) {
            showToast('Fabric API 安装失败：' + e.message, 'warning', 5000);
          }
        }
        await loadVersions(true);
        return;
      }
      if (data.status === 'failed') {
        showToast('安装失败: ' + (data.message || '未知错误'), 'error');
        appState.currentInstallSessionId = null;
        dlManager.update(taskId, { status: 'failed', message: data.message || '安装失败', progress: smoothPct });
        return;
      }
      if (data.status === 'cancelled') { appState.currentInstallSessionId = null; dlManager.update(taskId, { status: 'failed', message: '已取消', progress: smoothPct }); return; }
      setTimeout(poll, 500);
    } catch (e) {
      _pollErrorCount++;
      if (_pollErrorCount > 5) {
        console.error('[Install] 进度查询多次失败，停止轮询:', e.message);
        dlManager.update(taskId, { status: 'failed', message: '进度查询失败' });
        appState.currentInstallSessionId = null;
        return;
      }
      if (dlManager.tasks.has(taskId)) setTimeout(poll, 1000);
    }
  };
  poll();
}

function getStageText(stage) {
  const map = {
    'preparing': '准备中...',
    'version_json': '下载版本信息...',
    'client_jar': '下载游戏客户端...',
    'libraries': '下载依赖库...',
    'assets': '下载资源文件...',
    'natives': '提取原生库...',
    'finalizing': '完成安装...',
    'loader': '安装模组加载器...',
    'fabric-api': '下载 Fabric API...',
    'completed': '安装完成',
    'failed': '安装失败',
    'cancelled': '已取消'
  };
  return map[stage] || stage || '';
}

export { loadLoaderVersions, selectLoaderCard, populateLoaderVersionSelect, selectLoaderVersion, confirmInstallVersion, installVersionWithLoader, installVersion, showVersionNameModal, showInstallModal, closeInstallModal, cancelInstall, pollInstallProgress, getStageText };
