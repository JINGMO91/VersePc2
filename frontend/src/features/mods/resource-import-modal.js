// 资源导入：整合包命名弹窗、导入阶段文案与拖拽导入处理。
import { API } from '../../core/api.js';
import { bridge } from '../../core/tauri-bridge.js';
import { showToast } from '../misc/ui-components.js';
import { DynamicIsland } from '../misc/dynamic-island.js';
import { dlManager } from '../versions/custom-download.js';

let modpackImporting = false;

// 整合包命名弹窗：让用户自定义版本名称，与下载版本时的命名弹窗保持一致
// 支持回调形式和 Promise 形式（不传 onConfirm 时返回 Promise）
function showImportNameModal(defaultName, onConfirm) {
  const existing = document.getElementById('import-name-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'import-name-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';

  const card = document.createElement('div');
  card.style.cssText = 'max-width:420px;width:90%;background:var(--bg-secondary);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden;';

  card.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:15px;font-weight:600;color:var(--text-primary);">设置版本名称</span>
      <button id="inm-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px;">✕</button>
    </div>
    <div style="padding:20px;">
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:6px;">版本名称</label>
        <input id="inm-input" type="text" value="${defaultName.replace(/"/g, '&quot;')}"
          style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box;" />
        <div id="inm-hint" style="margin-top:6px;font-size:12px;color:var(--text-muted);"></div>
      </div>
      <div id="inm-warn" style="display:none;padding:10px 12px;border-radius:8px;background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);margin-bottom:12px;">
        <span style="font-size:13px;color:var(--warning);">⚠ 已有相同名称的版本</span>
      </div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;">
      <button id="inm-cancel" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;">取消</button>
      <button id="inm-confirm" style="padding:8px 20px;border-radius:8px;border:none;background:var(--accent);color:var(--accent-text);cursor:pointer;font-size:13px;font-weight:500;">确认安装</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const input = document.getElementById('inm-input');
  const hint = document.getElementById('inm-hint');
  const warn = document.getElementById('inm-warn');
  const confirmBtn = document.getElementById('inm-confirm');

  // 当未传 onConfirm 时，使用 Promise 模式
  const usePromise = typeof onConfirm !== 'function';
  let _resolve = null;

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

  function closeModal(result) {
    modal.remove();
    if (usePromise && _resolve) {
      _resolve(result);
    } else if (!usePromise && onConfirm) {
      onConfirm(result);
    }
  }

  document.getElementById('inm-close').onclick = () => closeModal(null);
  document.getElementById('inm-cancel').onclick = () => closeModal(null);
  modal.onclick = (e) => { if (e.target === modal) closeModal(null); };

  confirmBtn.onclick = async () => {
    const name = input.value.trim();
    if (!name || confirmBtn.disabled) return;
    closeModal(name);
  };

  checkName();
  input.focus();
  input.select();

  if (usePromise) {
    return new Promise((resolve) => { _resolve = resolve; });
  }
}

function getImportStageText(msg) {
  if (!msg) return '处理中...';
  if (msg.includes('download') || msg.includes('下载')) return '下载整合包内容...';
  if (msg.includes('read') || msg.includes('读取') || msg.includes('分析')) return '分析整合包...';
  if (msg.includes('mod') || msg.includes('模组')) return '下载整合包模组...';
  if (msg.includes('override') || msg.includes('配置')) return '解压整合包配置...';
  if (msg.includes('install') || msg.includes('安装')) return '安装整合包...';
  return msg;
}

const __resIsTauri = !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
// Tauri 环境下由 modpack-import.js 的 tauri://drag-drop 事件处理拖拽导入，
// 这里不能 preventDefault 默认拖拽行为，否则会阻止 Tauri 的拖拽事件触发。
document.addEventListener('dragover', (e) => {
  if (__resIsTauri) return;
  e.preventDefault(); e.stopPropagation();
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (__resIsTauri) return; // Tauri 环境交给 modpack-import.js 处理
  if (modpackImporting) return;
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const file = files[0];
  const name = (file.name || '').toLowerCase();
  const isModpackFile = name.endsWith('.mrpack') || name.endsWith('.cursemodpack') || name.endsWith('.zip');
  if (isModpackFile) {
    let filePath = file.path;
    if (!filePath && bridge?.getDroppedFilePath) {
      filePath = bridge.getDroppedFilePath(file);
    }
    if (filePath) {
      // 用文件名（去掉扩展名）作为默认版本名
      const fileBaseName = (file.name || '').replace(/\.(mrpack|zip|cursemodpack)$/i, '');
      showImportNameModal(fileBaseName, function(customName) {
        modpackImporting = true;
        var _vi = typeof DynamicIsland !== 'undefined' && DynamicIsland.isEnabled();
        var sessionId = 'local-modpack-' + Date.now();
        var taskId = 'modpack-' + sessionId;
        if (_vi) {
          DynamicIsland.show(name || '整合包导入');
        } else if (typeof dlManager !== 'undefined') {
          dlManager.add(taskId, name || '整合包导入', 'modpack', sessionId, '');
        }
        if (bridge?.onImportProgress) {
          if (bridge.removeImportProgressListener) bridge.removeImportProgressListener();
          // 节流控制：避免高频进度回调打爆主线程
          var _progThrottleTimer = null;
          var _progLastData = null;
          var _progLastTime = 0;
          var PROG_THROTTLE_MS = 250;
          function _doHandleProgress(data) {
            var stageText = getImportStageText(data.message);
            var pct = data.progress || 0;
            if (_vi) {
              var filesMapped = data.files ? data.files.map(function (f) { return { name: f.name || f.filename || f.n || '', status: f.status || f.s || 'pending', progress: f.progress || f.p || 0, speed: f.speed || f.sp || 0 }; }) : [];
              DynamicIsland.update({ progress: pct, status: 'downloading', message: stageText, name: name || '整合包导入', speed: data.speed || 0, files: filesMapped, stageHistory: data.stageHistory || [], currentFile: data.currentFile || '' });
            } else if (typeof dlManager !== 'undefined') {
              dlManager.update(taskId, { progress: pct, status: 'downloading', message: stageText, stageHistory: data.stageHistory || [], currentFile: data.currentFile || '' });
            }
          }
          bridge.onImportProgress(function (data) {
            var isTerminal = (data.status === 'completed' || data.status === 'failed' || (data.progress || 0) >= 100);
            if (isTerminal) {
              if (_progThrottleTimer) { clearTimeout(_progThrottleTimer); _progThrottleTimer = null; }
              _doHandleProgress(data);
              return;
            }
            _progLastData = data;
            var now = Date.now();
            if (now - _progLastTime >= PROG_THROTTLE_MS) {
              _progLastTime = now;
              _doHandleProgress(data);
            } else {
              if (!_progThrottleTimer) {
                _progThrottleTimer = setTimeout(function () {
                  _progThrottleTimer = null;
                  _progLastTime = Date.now();
                  if (_progLastData) _doHandleProgress(_progLastData);
                }, PROG_THROTTLE_MS);
              }
            }
          });
        }
        if (!_vi) showToast('正在导入整合包...', 'info');
        bridge.importModpack(filePath, customName).then(result => {
          modpackImporting = false;
          if (result && result.success) {
            if (_vi) { DynamicIsland.update({ progress: 100, status: 'completed', message: '导入完成' }); }
            else if (typeof dlManager !== 'undefined') { dlManager.update(taskId, { status: 'completed', progress: 100, message: '导入完成' }); }
            if (!_vi) showToast(`整合包 "${result.name || '未知'}" 导入成功！`, 'success');
          } else {
            var errMsg = result?.error || '未知错误';
            if (_vi) { DynamicIsland.update({ status: 'failed', message: errMsg }); }
            else if (typeof dlManager !== 'undefined') { dlManager.update(taskId, { status: 'error', message: errMsg }); }
            if (!_vi) showToast(`导入失败: ${errMsg}`, 'error');
          }
        }).catch(err => {
          modpackImporting = false;
          var catchMsg = err.message || '';
          if (_vi) { DynamicIsland.update({ status: 'failed', message: catchMsg }); }
          else if (typeof dlManager !== 'undefined') { dlManager.update(taskId, { status: 'error', message: catchMsg }); }
          if (!_vi) showToast('导入失败: ' + catchMsg, 'error');
        });
      });
    }
  }
});

export { showImportNameModal, getImportStageText, __resIsTauri };
