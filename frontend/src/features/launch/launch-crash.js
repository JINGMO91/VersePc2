import { API as API } from '../../core/api.js';
import { escapeHtml as escapeHtml } from '../../core/utils.js';
import { showToast as showToast } from '../misc/ui-components.js';

async function showCrashAnalysis(versionId) {
  try {
    const result = await API.analyzeCrash(versionId);
    if (result.found) {
      showCrashAnalysisDialog(result, versionId);
    } else {
      showToast('游戏已退出，未检测到崩溃日志', 'info');
    }
  } catch (e) {
    showToast('崩溃分析失败: ' + (e.message || e), 'error');
  }
}

function showCrashAnalysisDialog(result, versionId) {
  const existing = document.getElementById('crash-analysis-dialog');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'crash-analysis-dialog';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);animation:crashFadeIn 0.2s ease';

  const severityLabels = { high: '严重', medium: '中等', low: '轻微' };
  const sevLabel = severityLabels[result.severity] || '中等';

  const logExcerptHtml = (result.logExcerpt && result.logExcerpt.length > 0)
    ? result.logExcerpt.map(item => {
        const sourceLabel = item.source === 'crash-report' ? '崩溃报告' : item.source === 'hs_err' ? 'JVM崩溃' : item.source === 'launcher' ? '启动器' : '游戏日志';
        return `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.5">
          <span style="font-size:10px;flex-shrink:0;margin-top:2px;padding:1px 4px;border-radius:3px;border:1px solid var(--border);color:var(--text-muted);white-space:nowrap">${sourceLabel}</span>
          <span style="color:var(--text-secondary);word-break:break-all">${escapeHtml(item.line)}</span>
        </div>`;
      }).join('')
    : '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px">未提取到关键日志信息</div>';

  const dialog = document.createElement('div');
  dialog.style.cssText = `width:92%;max-width:680px;max-height:88vh;background:var(--bg-secondary);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,0.6);overflow:hidden;display:flex;flex-direction:column;animation:crashSlideUp 0.25s ease`;

  dialog.innerHTML = `
    <style>
      @keyframes crashFadeIn { from { opacity:0 } to { opacity:1 } }
      @keyframes crashSlideUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
      #crash-dialog-body::-webkit-scrollbar { width:6px }
      #crash-dialog-body::-webkit-scrollbar-thumb { background:var(--border);border-radius:3px }
      #crash-dialog-body::-webkit-scrollbar-track { background:transparent }
      .crash-btn { transition:all 0.15s ease }
      .crash-btn:hover { transform:translateY(-1px) }
      .crash-btn:active { transform:translateY(0) }
    </style>
    <div style="padding:18px 24px;display:flex;align-items:flex-start;gap:8px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <h3 style="margin:0;font-size:15px;font-weight:700;color:var(--text-primary)">游戏崩溃</h3>
          <span style="font-size:10px;padding:1px 6px;border-radius:8px;border:1px solid var(--border);color:var(--text-muted);font-weight:500">${sevLabel}</span>
        </div>
        <div style="font-size:13px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(result.reason)}</div>
      </div>
      <button id="crash-dialog-close" class="crash-btn" style="width:28px;height:28px;border:none;background:transparent;color:var(--text-muted);font-size:16px;cursor:pointer;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center">×</button>
    </div>
    <div id="crash-dialog-body" style="flex:1;overflow-y:auto;padding:20px 24px">
      ${result.modName ? `
      <div style="margin-bottom:14px">
        <div style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px">相关模组</div>
        <div style="padding:8px 12px;background:var(--bg-primary);border-radius:6px;font-size:12px;color:var(--text-primary);font-family:Consolas,Monaco,monospace">${escapeHtml(result.modName)}</div>
      </div>` : ''}
      ${result.crashDescription ? `
      <div style="margin-bottom:14px">
        <div style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px">崩溃描述</div>
        <div style="padding:10px 12px;background:var(--bg-primary);border-radius:6px;font-size:12px;color:var(--text-secondary);font-family:Consolas,Monaco,monospace;line-height:1.5;white-space:pre-wrap;word-break:break-all">${escapeHtml(result.crashDescription)}</div>
      </div>` : ''}
      <div style="margin-bottom:14px">
        <div style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px">解决方案</div>
        <div style="padding:10px 12px;background:var(--bg-primary);border-radius:6px;font-size:12px;color:var(--text-primary);line-height:1.7">${escapeHtml(result.solution)}</div>
      </div>
      <div style="margin-bottom:14px;padding:10px 12px;background:var(--bg-primary);border-radius:6px;border:1px solid var(--border)">
        <div style="font-size:11px;color:var(--text-muted);line-height:1.6">
          请勿截图,建议导出完整日志文件以便获得更准确的分析结果。
        </div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px;display:flex;align-items:center;justify-content:space-between">
          <span>错误日志摘要 (${result.logExcerpt ? result.logExcerpt.length : 0} 条)</span>
          ${result.logFile ? `<span style="font-size:10px;color:var(--text-muted);font-weight:400;text-transform:none;letter-spacing:0">${escapeHtml(result.logFile)}</span>` : ''}
        </div>
        <div style="padding:10px 12px;background:var(--bg-primary);border-radius:6px;max-height:240px;overflow-y:auto">
          ${logExcerptHtml}
        </div>
      </div>
    </div>
    <div style="padding:12px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;background:var(--bg-secondary);flex-wrap:wrap">
      ${result.fixType ? `
      <button id="crash-dialog-vfix" class="crash-btn" style="padding:7px 14px;border:none;background:var(--text-primary);color:var(--bg-primary);border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">
        用V岛帮我修
      </button>` : ''}
      <button id="crash-dialog-export" class="crash-btn" style="padding:7px 14px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text-primary);border-radius:6px;font-size:12px;cursor:pointer">
        导出完整日志
      </button>
      <button id="crash-dialog-copy" class="crash-btn" style="padding:7px 14px;border:1px solid var(--border);background:transparent;color:var(--text-primary);border-radius:6px;font-size:12px;cursor:pointer">
        复制报告
      </button>
      <button id="crash-dialog-repair" class="crash-btn" style="padding:7px 14px;border:1px solid var(--border);background:transparent;color:var(--text-primary);border-radius:6px;font-size:12px;cursor:pointer">
        文件修复
      </button>
      <button id="crash-dialog-ok" class="crash-btn" style="padding:7px 20px;border:none;background:var(--text-primary);color:var(--bg-primary);border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">知道了</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const closeDialog = () => { overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(); });
  dialog.querySelector('#crash-dialog-close').addEventListener('click', closeDialog);
  dialog.querySelector('#crash-dialog-ok').addEventListener('click', closeDialog);

  dialog.querySelector('#crash-dialog-export').addEventListener('click', () => {
    if (typeof API !== 'undefined' && API.exportCrashLog) {
      API.exportCrashLog(versionId);
      showToast('正在导出日志文件...', 'info');
    } else {
      showToast('导出功能暂不可用', 'error');
    }
  });

  dialog.querySelector('#crash-dialog-copy').addEventListener('click', () => {
    const report = `=== VersePC2 崩溃报告 ===\n崩溃原因: ${result.reason}\n严重程度: ${sevLabel}\n${result.modName ? '相关模组: ' + result.modName + '\n' : ''}解决方案: ${result.solution}\n${result.logFile ? '日志文件: ' + result.logFile + '\n' : ''}${result.crashDescription ? '\n崩溃描述:\n' + result.crashDescription + '\n' : ''}${result.logExcerpt && result.logExcerpt.length > 0 ? '\n错误日志摘要:\n' + result.logExcerpt.map(i => '[' + i.source + '] ' + i.line).join('\n') : ''}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(report).then(() => {
        showToast('崩溃报告已复制到剪贴板', 'success');
      }).catch(() => {
        showToast('复制失败，请手动选择文本', 'error');
      });
    } else {
      showToast('复制失败，请手动选择文本', 'error');
    }
  });

  dialog.querySelector('#crash-dialog-repair').addEventListener('click', () => {
    closeDialog();
    if (versionId) {
      import('../versions/version-settings.js')
        .then((m) => {
          m.openVersionSettings(versionId);
          document.querySelectorAll('.vset-nav-item[data-tab="overview"]').forEach(b => b.click());
          setTimeout(() => { if (typeof m.repairFiles === 'function') m.repairFiles(); }, 500);
        })
        .catch((e) => console.error('[crash] 版本设置模块加载失败:', e));
    }
  });

  // "用V岛帮我修"按钮：把崩溃信息交给V岛，让V岛通过CDP操控启动器自动修复
  const vfixBtn = dialog.querySelector('#crash-dialog-vfix');
  if (vfixBtn) {
    vfixBtn.addEventListener('click', () => {
      closeDialog();
      if (window.DynamicIsland && typeof window.DynamicIsland.fixCrash === 'function') {
        window.DynamicIsland.fixCrash({
          versionId: versionId,
          reason: result.reason,
          solution: result.solution,
          fixType: result.fixType,
          fixDesc: result.fixDesc,
          modName: result.modName,
          logExcerpt: result.logExcerpt ? result.logExcerpt.slice(0, 10).map(i => i.line).join('\n') : ''
        });
      } else {
        showToast('V岛功能未启用，请先在设置中开启', 'warning');
      }
    });
  }

  setTimeout(() => { dialog.querySelector('#crash-dialog-ok').focus(); }, 100);
}

export { showCrashAnalysis, showCrashAnalysisDialog };
