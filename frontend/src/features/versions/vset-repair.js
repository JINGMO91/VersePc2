import { API as API } from '../../core/api.js';
import { getRepairStageText } from './vset-repair-stages.js';
import { showToast as showToast, showModal as showModal, hideModal as hideModal, showConfirmDialog as showConfirmDialog } from '../misc/ui-components.js';
import { loadVersions as loadVersions, renderInstalledVersionsInto as renderInstalledVersionsInto } from './versions.js';
import { appState as appState } from '../../core/app-state.js';
import { S } from './vset-state.js';
import { closeVersionSettings } from './vset-open.js';

function showRepairModal(versionId) {
  document.getElementById('repair-modal-title').textContent = `文件修复 - ${versionId}`;
  document.getElementById('repair-progress-fill').style.width = '0%';
  document.getElementById('repair-stage').textContent = '准备中...';
  document.getElementById('repair-percent').textContent = '0%';
  document.getElementById('repair-message').textContent = '';
  document.getElementById('repair-file-count').textContent = '';
  document.getElementById('repair-cancel-btn').style.display = '';
  showModal('repair-modal');
}

function closeRepairModal() {
  hideModal('repair-modal');
  if (S.repairPollTimer) { clearTimeout(S.repairPollTimer); S.repairPollTimer = null; }
  S.currentRepairSessionId = null;
}

function cancelRepair() {
  if (S.currentRepairSessionId) {
    API.repairCancel(S.currentRepairSessionId);
    S.currentRepairSessionId = null;
  }
  if (S.repairPollTimer) { clearTimeout(S.repairPollTimer); S.repairPollTimer = null; }
  document.getElementById('repair-stage').textContent = '修复已取消';
  document.getElementById('repair-cancel-btn').style.display = 'none';
  showToast('修复已取消', 'info');
  setTimeout(() => hideModal('repair-modal'), 1500);
}

function pollRepairProgress(sessionId) {
  const poll = async () => {
    try {
      const data = await API.repairProgress(sessionId);
      const fill = document.getElementById('repair-progress-fill');
      const stage = document.getElementById('repair-stage');
      const percent = document.getElementById('repair-percent');
      const message = document.getElementById('repair-message');
      const fileCount = document.getElementById('repair-file-count');

      if (fill) fill.style.width = `${data.progress || 0}%`;
      if (stage) stage.textContent = getRepairStageText(data.stage);
      if (percent) percent.textContent = `${Math.round(data.progress || 0)}%`;
      if (message) message.textContent = data.message || '';

      if (fileCount) {
        const parts = [];
        if (data.checkedFiles !== undefined && data.totalFiles !== undefined) {
          parts.push(`已检查: ${data.checkedFiles}/${data.totalFiles}`);
        }
        if (data.missingFiles !== undefined) {
          parts.push(`缺失: ${data.missingFiles}`);
        }
        if (data.repairedFiles !== undefined) {
          parts.push(`已修复: ${data.repairedFiles}`);
        }
        if (data.currentFile) {
          parts.push(`当前: ${data.currentFile}`);
        }
        fileCount.textContent = parts.join(' | ');
      }

      if (data.status === 'completed') {
        document.getElementById('repair-progress-fill').style.width = '100%';
        document.getElementById('repair-percent').textContent = '100%';
        document.getElementById('repair-cancel-btn').style.display = 'none';
        showToast(data.message || '文件修复完成！', 'success');
        S.currentRepairSessionId = null;
        setTimeout(() => hideModal('repair-modal'), 2000);
        return;
      }
      if (data.status === 'failed') {
        document.getElementById('repair-stage').textContent = '修复失败';
        document.getElementById('repair-cancel-btn').style.display = 'none';
        showToast(data.message || '文件修复失败', 'error');
        S.currentRepairSessionId = null;
        return;
      }
      if (data.status === 'cancelled') {
        S.currentRepairSessionId = null;
        return;
      }
      S.repairPollTimer = setTimeout(poll, 500);
    } catch (e) {
      S.repairPollTimer = setTimeout(poll, 1000);
    }
  };
  poll();
}

async function repairFiles() {
  if (!appState.currentSettingsVersionId) return;

  showRepairModal(appState.currentSettingsVersionId);

  try {
    const result = await API.repairStart(appState.currentSettingsVersionId);
    if (result.success && result.sessionId) {
      S.currentRepairSessionId = result.sessionId;
      pollRepairProgress(result.sessionId);
    } else {
      document.getElementById('repair-stage').textContent = '启动失败';
      document.getElementById('repair-message').textContent = result.error || '无法启动修复';
      document.getElementById('repair-cancel-btn').style.display = 'none';
      showToast(result.error || '启动修复失败', 'error');
    }
  } catch (e) {
    document.getElementById('repair-stage').textContent = '启动失败';
    document.getElementById('repair-message').textContent = '网络错误，请重试';
    document.getElementById('repair-cancel-btn').style.display = 'none';
    showToast('启动修复失败: ' + e.message, 'error');
  }
}

async function diagnoseVersion() {
  if (!appState.currentSettingsVersionId) {
    showToast('请先选择一个游戏版本', 'error');
    return;
  }

  try {
    const result = await API.diagnoseVersion(appState.currentSettingsVersionId);
    showDiagnoseDialog(result);
  } catch (e) {
    showToast('诊断失败: ' + e.message, 'error');
  }
}

function showDiagnoseDialog(result) {
  const issues = result.issues || [];
  const typeColors = { critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
  const typeLabels = { critical: '严重', warning: '警告', info: '信息' };

  let html = issues.map(issue => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:6px;background:var(--bg-active);margin-bottom:6px;">
      <span style="color:${typeColors[issue.type]};font-weight:600;min-width:36px;">${typeLabels[issue.type]}</span>
      <div>
        <div style="font-size:13px;">${issue.message}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${issue.solution}</div>
      </div>
    </div>
  `).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  overlay.innerHTML = `
    <div class="modal-content" style="width:520px;min-height:auto;max-height:80vh;">
      <div class="modal-header">
        <h3>版本诊断结果</h3>
        <button class="modal-close diagnose-close" aria-label="关闭对话框">&times;</button>
      </div>
      <div class="modal-body" style="overflow-y:auto;max-height:60vh;">
        ${html}
      </div>
      <div class="modal-footer">
        <button class="modal-btn modal-btn--secondary diagnose-close">关闭</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('modal-visible'));

  const close = () => {
    overlay.classList.add('modal-exiting');
    overlay.classList.remove('modal-visible');
    setTimeout(() => {
      if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
    }, 200);
  };

  overlay.querySelectorAll('.diagnose-close').forEach(btn => btn.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

async function deleteCurrentVersion() {
  if (!appState.currentSettingsVersionId) {
    showToast('未找到版本信息', 'error');
    return;
  }
  const isExternal = appState.currentSettingsVersionId.includes(' [外部');
  if (isExternal) {
    const confirmed = await showConfirmDialog('移除外部版本', '确定要从列表中移除此外部版本吗？（不会删除实际游戏文件）', '移除', '取消');
    if (!confirmed) return;
  } else {
    const ver = appState.installedVersions.find(v => v.id === appState.currentSettingsVersionId);
    let warningParts = [];
    if (ver?.hasMods) warningParts.push('模组');
    if (ver?.hasSaves) warningParts.push('存档');
    if (ver?.hasResourcepacks) warningParts.push('资源包');
    let confirmMsg = `确定要删除版本 ${appState.currentSettingsVersionId} 吗？此操作不可撤销！`;

    let chainInfo = '';
    try {
      const chainResult = await API.getDeleteChain(appState.currentSettingsVersionId);
      if (chainResult.success && chainResult.willDelete && chainResult.willDelete.length > 1) {
        const otherVersions = chainResult.willDelete.filter(id => id !== appState.currentSettingsVersionId);
        if (otherVersions.length > 0) {
          chainInfo = `\n\n同时将删除关联版本：\n${otherVersions.map(id => '• ' + id).join('\n')}`;
        }
      }
    } catch (_) {}

    if (warningParts.length > 0) {
      confirmMsg += `\n\n⚠ 由于该版本开启了版本隔离，删除版本时该版本对应的${warningParts.join('、')}等文件也将被一并删除！`;
    }
    if (chainInfo) confirmMsg += chainInfo;

    const confirmed = await showConfirmDialog('版本删除确认', confirmMsg, '删除', '取消');
    if (!confirmed) return;
  }
  const deletedVersionId = appState.currentSettingsVersionId;
  try {
    const r = await API.deleteVersion(deletedVersionId);
    if (r.success) {
      const deletedNames = r.deleted ? r.deleted.join('、') : deletedVersionId;
      showToast(`版本 ${deletedNames} 已删除`, 'success');
      closeVersionSettings();
      await loadVersions(true);
      const installedContainer = document.getElementById('installed-versions-list');
      if (installedContainer) renderInstalledVersionsInto(installedContainer);
    } else {
      showToast(r.error || '删除失败', 'error');
    }
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

export { showRepairModal, closeRepairModal, cancelRepair, getRepairStageText, pollRepairProgress, repairFiles, diagnoseVersion, showDiagnoseDialog, deleteCurrentVersion };
