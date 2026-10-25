import { API as API } from '../../core/api.js';
import { formatSize as formatSize } from '../../core/utils.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { dlManager as dlManager } from '../versions/custom-download.js';
import { loadVersions as loadVersions } from '../versions/versions-list.js';
import { modDetailState as modDetailState } from './detail-state.js';
import { appState as appState } from '../../core/app-state.js';
import { resolveResourceSavePath } from './install-target.js';
import { showModDownloadModal } from './install-batch.js';

function installModpackVersionSafe(el) {
  if (!el) return;
  const vid = decodeURIComponent(atob(el.dataset.vid || ''));
  installModpackVersion(appState.currentModDetailId, vid);
}

async function installModpackVersion(projectId, versionId) {
  const modpackTitle = modDetailState.data?.title || modDetailState.data?.name || projectId;
  showModpackNameModal(modpackTitle, projectId, versionId);
}

async function quickInstallModpack(projectId, versionId) {
  const modpackTitle = modDetailState.data?.title || modDetailState.data?.name || projectId;
  showModpackNameModal(modpackTitle, projectId, versionId);
}

function showModpackNameModal(defaultName, projectId, versionId) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';

  const card = document.createElement('div');
  card.style.cssText = 'max-width:420px;width:90%;background:var(--bg-secondary);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden;';

  card.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:15px;font-weight:600;color:var(--text-primary);">设置整合包名称</span>
      <button id="mpnm-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px;">✕</button>
    </div>
    <div style="padding:20px;">
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:6px;">版本名称</label>
        <input id="mpnm-input" type="text" value="${defaultName.replace(/"/g, '&quot;')}" 
          style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box;" />
        <div id="mpnm-hint" style="margin-top:6px;font-size:12px;color:var(--text-muted);"></div>
      </div>
      <div id="mpnm-warn" style="display:none;padding:10px 12px;border-radius:8px;background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);margin-bottom:12px;">
        <span style="font-size:13px;color:var(--warning);">⚠ 已有相同名称的版本</span>
      </div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;">
      <button id="mpnm-cancel" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;">取消</button>
      <button id="mpnm-confirm" style="padding:8px 20px;border-radius:8px;border:none;background:var(--accent);color:var(--accent-text);cursor:pointer;font-size:13px;font-weight:500;">确认安装</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const input = document.getElementById('mpnm-input');
  const hint = document.getElementById('mpnm-hint');
  const warn = document.getElementById('mpnm-warn');
  const confirmBtn = document.getElementById('mpnm-confirm');

  async function checkName() {
    const name = input.value.trim();
    if (!name) {
      hint.textContent = '';
      warn.style.display = 'none';
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.5';
      return;
    }
    try {
      const result = await API.checkVersionName(name);
      if (!result.available) {
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
      hint.textContent = '';
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      confirmBtn.style.cursor = 'pointer';
    }
  }

  input.addEventListener('input', checkName);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !confirmBtn.disabled) confirmBtn.click();
  });

  document.getElementById('mpnm-close').onclick = () => modal.remove();
  document.getElementById('mpnm-cancel').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  confirmBtn.onclick = async () => {
    const name = input.value.trim();
    if (!name || confirmBtn.disabled) return;
    modal.remove();
    _doInstallModpack(projectId, versionId, name);
  };

  checkName();
  input.focus();
  input.select();
}

function showModpackInstallModal(fileName, sessionId) {
  appState.currentInstallSessionId = sessionId;
  const taskId = 'modpack-' + sessionId;
  const iconUrl = modDetailState.data?.icon || '';
  dlManager.add(taskId, fileName || '整合包安装', 'modpack', sessionId, iconUrl);

  // 监听后端的 import-progress 事件，实时累积各阶段进度（stageHistory）与模组文件进度（files）
  let unlisten = null;
  let importActive = false; // 是否已从事件拿到实时阶段进度
  let currentProgress = 0; // 当前总进度（事件与轮询共用，避免被覆盖清零）
  const stageHistory = []; // 累积的各阶段进度 [{stage, progress, message}]

  const upsertStage = (stage, progress, message) => {
    if (!stage) return;
    const existing = stageHistory.find(s => s.stage === stage);
    if (existing) {
      existing.progress = Math.max(existing.progress || 0, progress || 0);
      if (message) existing.message = message;
    } else {
      stageHistory.push({ stage, progress: progress || 0, message: message || stage });
    }
  };

  const normalizeFiles = (list) => (list || []).map(f => ({
    name: f.name || f.filename || f.path || '',
    status: f.status || 'pending',
    progress: f.progress || 0,
    size: f.size ? formatSize(f.size) : ''
  }));

  const registerImportListener = () => {
    const tauriEvent = (window.__TAURI__ && window.__TAURI__.event)
      ? window.__TAURI__.event
      : window.__TAURI_INTERNALS__;
    if (!tauriEvent || !tauriEvent.listen) return;
    tauriEvent.listen('import-progress', function (event) {
      const p = (event && event.payload) || {};
      if (!p || !p.message) return;
      importActive = true;
      const update = { message: p.message, currentFile: p.currentFile || '' };
      if (typeof p.progress === 'number') {
        currentProgress = Math.max(currentProgress, p.progress);
        update.progress = currentProgress;
      }
      if (p.stage) upsertStage(p.stage, p.progress, p.message);
      if (Array.isArray(p.files) && p.files.length) update.files = normalizeFiles(p.files);
      if (stageHistory.length) update.stageHistory = stageHistory.slice();
      dlManager.update(taskId, update);
    }).then(fn => { unlisten = fn; }).catch(() => {});
  };
  registerImportListener();

  let unknownRetries = 0;
  const cleanup = () => {
    if (unlisten) { try { unlisten(); } catch (e) {} unlisten = null; }
    appState.modDownloadPollTimers.forEach(t => clearTimeout(t));
    appState.modDownloadPollTimers = [];
  };
  const poll = async () => {
    try {
      const data = await API.getModDownloadStatus(sessionId);
      const displayStatus = data.status === 'completed' ? 'completed' : data.status === 'failed' ? 'failed' : data.status === 'cancelled' ? 'failed' : 'downloading';
      // 导入阶段优先用 import-progress 事件推送的实时进度，避免被固定的"正在解析整合包"覆盖
      const update = { status: displayStatus, progress: currentProgress };
      if (!importActive) {
        // 整合包文件下载阶段：用轮询的 session 进度与单文件进度
        currentProgress = data.progress || 0;
        update.progress = currentProgress;
        update.message = data.phase === 'importing' ? '正在安装整合包...' : getDownloadStageText(data);
        update.files = normalizeFiles(data.files);
      } else {
        // 导入阶段：文件列表与进度都来自 import-progress 事件，轮询不覆盖
        update.progress = currentProgress;
      }
      // 仅当后端确实返回了阶段历史时才覆盖本地累积，避免用空数组清掉已累积的进度
      if (data.stageHistory && Array.isArray(data.stageHistory) && data.stageHistory.length) {
        update.stageHistory = data.stageHistory;
      }
      dlManager.update(taskId, update);
      if (data.status === 'completed') {
        cleanup();
        showToast('整合包安装完成', 'success');
        loadVersions(true);
        return;
      }
      if (data.status === 'failed') {
        cleanup();
        showToast(`安装失败: ${data.message}`, 'error');
        return;
      }
      if (data.status === 'cancelled') {
        cleanup();
        dlManager.update(taskId, { status: 'failed', message: '已取消' });
        return;
      }
      if (data.phase === 'importing') {
        const timer = setTimeout(poll, 500);
        appState.modDownloadPollTimers.push(timer);
        return;
      }
      if (data.status === 'unknown' || !data.status) {
        unknownRetries++;
        if (unknownRetries <= 1) {
          const timer = setTimeout(poll, 3000);
          appState.modDownloadPollTimers.push(timer);
          return;
        }
        cleanup();
        dlManager.update(taskId, { status: 'failed', message: '会话已失效' });
        return;
      }
      const timer = setTimeout(poll, 500);
      appState.modDownloadPollTimers.push(timer);
    } catch (e) {
      const timer = setTimeout(poll, 800);
      appState.modDownloadPollTimers.push(timer);
    }
  };
  appState.modDownloadPollTimers.push(setTimeout(poll, 300));
}

async function _doInstallModpack(projectId, versionId, customName) {
  showToast('正在下载整合包，将创建新版本...', 'info');
  try {
    const result = await API.downloadResource(versionId, projectId, 'modpack', '', '', customName, appState.currentModDetailSource);
    if (result.success) {
      showModpackInstallModal(result.fileName, result.sessionId);
    } else {
      console.error('[Modpack] downloadResource failed:', JSON.stringify(result));
      showToast(`整合包安装失败: ${result.error || '未知错误'}`, 'error');
    }
  } catch (e) {
    console.error('[Modpack] downloadResource error:', e);
    showToast(`整合包安装失败: ${e.message || e}`, 'error');
  }
}

function installResourceVersionSafe(el) {
  if (!el) return;
  const vid = decodeURIComponent(atob(el.dataset.vid || ''));
  quickInstallResourceVersion(appState.currentModDetailId, modDetailState.type, vid);
}

async function quickInstallResourceVersion(projectId, type, versionId) {
  const typeNames = { resourcepack: '材质包', shader: '光影包', datapack: '数据包' };
  const typeName = typeNames[type] || '资源';
  showToast('请选择保存文件夹...', 'info');
  try {
    const defaultPath = await resolveResourceSavePath(type);
    const folderResult = await API.selectSaveFolder(defaultPath);
    if (folderResult.cancelled) {
      if (folderResult.error) {
        showToast('文件夹选择失败: ' + folderResult.error, 'error');
      }
      return;
    }
    const savePath = folderResult.path;
    if (!savePath) {
      showToast('未选择文件夹', 'error');
      return;
    }
    localStorage.setItem('lastResourceSavePath_' + type, savePath);
    showToast(`正在安装${typeName}...`, 'info');
    const result = await API.downloadResource(versionId, projectId, type, '', savePath, '', appState.currentModDetailSource);
    if (result.success) {
      showModDownloadModal(result.fileName, result.sessionId);
    } else {
      showToast(result.error || '安装失败', 'error');
    }
  } catch (e) {
    showToast('安装失败', 'error');
  }
}

function getLoaderFileIcon(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('fabric')) return '<img src="img/Fabric.png" alt="" style="width:20px;height:20px;image-rendering:pixelated">';
  if (lower.includes('neoforge')) return '<img src="img/NeoForge.png" alt="" style="width:20px;height:20px;image-rendering:pixelated">';
  if (lower.includes('forge')) return '<img src="img/Anvil.png" alt="" style="width:20px;height:20px;image-rendering:pixelated">';
  if (lower.includes('optifine')) return '<img src="img/OptiFabric.png" alt="" style="width:20px;height:20px;image-rendering:pixelated">';
  return '<img src="img/Grass.png" alt="" style="width:20px;height:20px;image-rendering:pixelated">';
}

function getDownloadStageText(data) {
  if (!data) return '准备中...';
  if (data.status === 'completed') return '安装完成';
  if (data.status === 'failed') return data.message || '安装失败';
  if (data.status === 'cancelled') return '已取消';
  if (data.message && data.phase !== 'importing') return data.message;
  const phaseMap = {
    'download':        '下载整合包文件...',
    'read':            '正在读取整合包...',
    'base':            '正在准备基础版本...',
    'loader-install':  '正在安装模组加载器...',
    'loader-upgrade':  '正在升级模组加载器...',
    'version-config':  '正在创建版本配置...',
    'loader':          '模组加载器就绪',
    'download-mods':   '下载整合包模组...',
    'overrides':       '解压整合包配置...',
    'verify':          '正在验证整合包完整性...',
    'install':         '安装整合包内容...',
    'importing':       '正在安装整合包...',
  };
  if (data.phase && phaseMap[data.phase]) return phaseMap[data.phase];
  if (data.phase === 'install') return '安装整合包内容...';
  return data.message || '处理中...';
}

function toggleMdvGroup(idx) {
  const group = document.getElementById(`mdvg-${idx}`);
  group.classList.toggle('expanded');
}

export { installModpackVersionSafe, installModpackVersion, quickInstallModpack, showModpackNameModal, showModpackInstallModal, _doInstallModpack, installResourceVersionSafe, quickInstallResourceVersion, getLoaderFileIcon, getDownloadStageText, toggleMdvGroup };
