import { API as API } from '../../core/api.js';
import { bridge as bridge } from '../../core/tauri-bridge.js';
import { getCustomSelectValue as getCustomSelectValue } from '../misc/custom-select.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { dlManager as dlManager } from '../versions/custom-download.js';
import { modDetailState as modDetailState } from './detail-state.js';
import { appState as appState } from '../../core/app-state.js';
import { S } from './install-state.js';
import { S as modDetailS } from './mod-detail-state.js';
import { resolveModTarget, resolveModVersionTarget, resolveModSavePathWithConfirm } from './install-target.js';
import { resolveModSavePath } from './install-paths.js';
import { proceedModInstall, maybeShowPostInstallDeps } from './install-deps.js';
import { showModDownloadModal, updateModSelectUI } from './install-batch.js';

function installModFile(projectId, source, versionId, fileId) {
  // 捕获当前模组目标游戏版本/加载器，用于保存路径定位（Forge/Fabric 同版本号不混淆）
  try {
    const versions = (typeof modDetailState.allVersions !== 'undefined') ? modDetailState.allVersions : [];
    const v = versions.find(x => x && x.id === versionId);
    if (v) {
      const t = resolveModTarget(v.gameVersions, v.loaders);
      S._mdSaveGame = t.game || S._mdSaveGame;
      S._mdSaveLoader = t.loader || S._mdSaveLoader;
      console.warn('[mod-folder] 安装文件=', v.versionNumber || v.name, 'gvs=', JSON.stringify(v.gameVersions), 'loaders=', JSON.stringify(v.loaders), '目标=', t, '=>', S._mdSaveGame, S._mdSaveLoader, 'source=', source);
    } else {
      console.warn('[mod-folder] 未在 modDetailState.allVersions 找到版本 versionId=', versionId);
    }
  } catch (e) { console.warn('[mod-folder] 捕获异常', e); }
  showModInstallConfirm(projectId, source, versionId, fileId);
}

async function showModInstallConfirm(projectId, source, versionId, fileId) {
  // 未记录目标加载器/版本时，从当前模组版本数据中推导（避免误用页面筛选加载器）
  if (!S._mdSaveLoader && versionId) {
    try {
      const v = (typeof modDetailState.allVersions !== 'undefined' ? modDetailState.allVersions : []).find(x => x && x.id === versionId);
      if (v) {
        const t = resolveModTarget(v.gameVersions, v.loaders);
        if (t.game) S._mdSaveGame = t.game;
        if (t.loader) S._mdSaveLoader = t.loader;
      }
    } catch (e) {}
  }
  showToast('请选择保存文件夹...', 'info');
  try {
    const defaultPath = await resolveModSavePathWithConfirm();
    if (defaultPath === null) {
      showToast('已取消下载', 'info');
      return;
    }
    const folderResult = await API.selectSaveFolder(defaultPath);
    if (folderResult.cancelled) {
      if (folderResult.error) {
        showToast('文件夹选择失败: ' + folderResult.error, 'error');
      } else {
        showToast('已取消选择', 'info');
      }
      return;
    }
    const savePath = folderResult.path;
    if (!savePath) {
      showToast('未选择文件夹', 'error');
      return;
    }
    localStorage.setItem('lastModSavePath', savePath);

    proceedModInstall(projectId, source, versionId, fileId, savePath, true);
  } catch (e) {
    console.error('Mod install confirm error:', e);
    showToast('操作失败', 'error');
  }
}

function quickInstallCurrentMod() {
  if (!modDetailState.data) return;
  const versionId = modDetailState.data.selectedVersionId || modDetailState.data.versionId || '';
  showModInstallConfirm(modDetailState.data.id || appState.currentModDetailId, appState.currentModDetailSource, versionId);
}

async function quickInstallMod(projectId, source, versionId, fileId) {
  const pendingTaskId = 'mod-' + Date.now();
  const iconUrl = modDetailState.data?.icon || '';
  dlManager.add(pendingTaskId, '准备下载...', 'mod', '', iconUrl);
  dlManager.update(pendingTaskId, { progress: 0, status: 'downloading', message: '正在获取下载信息...' });
  try {
    const currentGameVersion = getCustomSelectValue('mod-filter-version') || '';
    const currentLoader = getCustomSelectValue('mod-filter-loader') || '';
    const savePath = await resolveModSavePath();
    const result = await API.downloadModVersion(versionId || '', projectId, source, fileId || '', currentGameVersion, currentLoader, savePath);
    if (result.success) {
      modDetailS.mdDepsCache.clear();
      dlManager.remove(pendingTaskId);
      showModDownloadModal(result.fileName, result.sessionId, savePath, iconUrl);
      maybeShowPostInstallDeps(projectId, source, versionId, savePath, currentGameVersion, currentLoader, iconUrl);
    } else {
      dlManager.update(pendingTaskId, { status: 'failed', message: result.error || '下载失败' });
      showToast(result.error || '下载失败', 'error');
    }
  } catch (e) {
    console.error('quickInstallMod error:', e);
    dlManager.update(pendingTaskId, { status: 'failed', message: e.message || '请求失败' });
    showToast('下载请求失败: ' + (e.message || '未知错误'), 'error');
  }
}

function copyModName() {
  if (!modDetailState.data) return;
  bridge.clipboard.writeText(modDetailState.data.title).then(() => showToast('已复制名称', 'success'));
}

function openModSourceUrl() {
  if (!modDetailState.data) return;
  let url = '';
  if (appState.currentModDetailSource === 'curseforge') {
    url = `https://www.curseforge.com/minecraft-mc-mods/${appState.currentModDetailId}`;
  } else {
    url = `https://modrinth.com/mod/${appState.currentModDetailId}`;
  }
  bridge.openExternal(url);
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

export { installModFile, installModFileSafe, addModFromDetail, showModInstallConfirm, quickInstallCurrentMod, quickInstallMod, copyModName, openModSourceUrl };
