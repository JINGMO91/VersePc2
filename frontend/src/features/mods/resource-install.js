// 资源安装：整合包创建版本安装、其他资源选择保存目录安装与目标版本选择弹窗。
import { API } from '../../core/api.js';
import { showToast } from '../misc/ui-components.js';
import { showModpackInstallModal, resolveResourceSavePath, showModDownloadModal } from './mod-install.js';
import { modDetailState } from './detail-state.js';
import { appState } from '../../core/app-state.js';
import { typeNames } from './resource-state.js';
import { showImportNameModal } from './resource-import-modal.js';

async function quickInstallResource(projectId, type) {
  if (type === 'modpack') {
    // 整合包需要创建新版本，先弹窗让用户自定义版本名
    const defaultName = (typeof modDetailState.data !== 'undefined' && (modDetailState.data?.title || modDetailState.data?.name)) || projectId;
    showImportNameModal(defaultName, async function(customName) {
      showToast('正在下载整合包，将创建为新版本...', 'info');
      try {
        const result = await API.downloadResource('', projectId, type, '', '', customName, appState.currentModDetailSource);
        if (result.success) {
          showModpackInstallModal(result.fileName, result.sessionId);
        } else {
          showToast(result.error || '安装失败', 'error');
        }
      } catch (e) {
        showToast('安装失败', 'error');
      }
    });
  } else {
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
      showToast(`正在安装${typeNames[type]}...`, 'info');
      const result = await API.downloadResource('', projectId, type, '', savePath, '', appState.currentModDetailSource);
      if (result.success) {
        showModDownloadModal(result.fileName, result.sessionId);
      } else {
        showToast(result.error || '安装失败', 'error');
      }
    } catch (e) {
      showToast('安装失败', 'error');
    }
  }
}

// 显示版本选择对话框
async function showVersionSelectDialog() {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';

    modal.innerHTML = `
      <div style="background:var(--bg-secondary,#1a1a2e);border-radius:12px;padding:24px;min-width:320px;max-width:400px;border:1px solid var(--border,rgba(255,255,255,0.1));">
        <h3 style="margin:0 0 16px;color:var(--text-primary,#fff);">选择目标版本</h3>
        <p style="margin:0 0 16px;color:var(--text-muted,#aaa);font-size:13px;">整合包将安装到所选版本中</p>
        <select id="version-select-dialog" style="width:100%;padding:10px 12px;background:var(--bg-input,#252540);border:1px solid var(--border,rgba(255,255,255,0.15));border-radius:8px;color:var(--text-primary,#fff);font-size:14px;">
          <option value="">加载中...</option>
        </select>
        <div style="display:flex;gap:12px;margin-top:20px;justify-content:flex-end;">
          <button id="version-select-cancel" style="padding:8px 16px;background:transparent;border:1px solid var(--border,rgba(255,255,255,0.2));border-radius:6px;color:var(--text-secondary,#ccc);cursor:pointer;">取消</button>
          <button id="version-select-confirm" style="padding:8px 16px;background:var(--accent,#60a5fa);border:none;border-radius:6px;color:var(--accent-text,#fff);cursor:pointer;font-weight:500;">确认安装</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const select = modal.querySelector('#version-select-dialog');
    const cancelBtn = modal.querySelector('#version-select-cancel');
    const confirmBtn = modal.querySelector('#version-select-confirm');

    API.getVersions(true).then(data => {
      select.innerHTML = '';
      const installed = (data?.installed || []).filter(v => v.id && v.type !== '(old)');
      if (installed.length === 0) {
        select.innerHTML = '<option value="">没有已安装的版本</option>';
      } else {
        installed.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.id;
          let label = v.id;
          if (v.isModpack) label += ` [${v.modpackLoader || '整合包'}]`;
          else if (v.isFabric) label += ' [Fabric]';
          else if (v.isForge) label += ' [Forge]';
          else if (v.isNeoForge) label += ' [NeoForge]';
          else if (v.isOptiFine) label += ' [OptiFine]';
          opt.textContent = label;
          select.appendChild(opt);
        });
      }
    }).catch(() => {
      select.innerHTML = '<option value="">加载失败</option>';
    });

    const close = (result) => {
      document.body.removeChild(modal);
      resolve(result);
    };

    cancelBtn.addEventListener('click', () => close(''));
    confirmBtn.addEventListener('click', () => close(select.value));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close('');
    });
  });
}

export { quickInstallResource, showVersionSelectDialog };
