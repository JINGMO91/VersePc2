import { API as API } from '../../core/api.js';
import { incrementLaunchCount as incrementLaunchCount, checkSupportMilestone as checkSupportMilestone } from '../misc/announcement.js';
import { navigateToPage as navigateToPage } from '../../core/navigation.js';
import { appState as appState } from '../../core/app-state.js';
import { S } from './launch-state.js';
import { refreshGameStatusAfterLaunch, _onGameRunning, startGameLogStream } from './launch-runtime.js';

function showLaunchModal() {
  const overlay = document.getElementById('game-launch-overlay');
  if (!overlay) {
    console.error('[Launch] game-launch-overlay element not found');
    return;
  }

  overlay.style.display = 'flex';

  const progressBar = document.getElementById('launch-splash-progress');
  if (progressBar) progressBar.style.width = '0%';

  const statusEl = document.getElementById('launch-splash-status');
  if (statusEl) {
    statusEl.textContent = '正在验证登录状态...';
    statusEl.style.color = '';
  }

  const logo = document.getElementById('launch-splash-logo');
  if (logo) {
    logo.style.animation = 'none';
    void logo.offsetWidth;
    logo.style.animation = '';
  }

  const errorSection = document.getElementById('launch-error-section');
  if (errorSection) errorSection.style.display = 'none';

  const logSection = document.getElementById('launch-log-section');
  if (logSection) logSection.style.display = 'none';

  const repairGuide = document.getElementById('launch-repair-guide');
  if (repairGuide) repairGuide.style.display = 'none';
}

function closeLaunchModal(name_fade) {
  const overlay = document.getElementById('game-launch-overlay');
  if (!overlay) return;

  if (name_fade) {
    overlay.style.transition = 'opacity 0.5s ease-out';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.style.opacity = '1';
      overlay.style.transition = '';
      navigateToPage('home');
    }, 500);
  } else {
    overlay.style.display = 'none';
  }

  hideLaunchError();
}

function updateLaunchProgress(pct) {
  const bar = document.getElementById('launch-splash-progress');
  if (bar) bar.style.width = pct + '%';
}

function setLaunchStep(stepName, status, desc) {
  const statusEl = document.getElementById('launch-splash-status');
  if (statusEl && desc) statusEl.textContent = desc;

  const progress = S.LAUNCH_STEP_PROGRESS[stepName] || 0;
  updateLaunchProgress(progress);

  if (statusEl) {
    if (status === 'error') {
      statusEl.style.color = '#dc2626';
    } else if (status === 'success' && stepName === 'S.launching') {
      updateLaunchProgress(100);
      statusEl.textContent = '启动成功！';
      statusEl.style.color = '#4ade80';
    } else {
      statusEl.style.color = '';
    }
  }
}

function completeAllPreviousSteps(_currentStepName) {
}

function showLaunchError(msg, details = null) {
  const errorSection = document.getElementById('launch-error-section');
  const errorMsg = document.getElementById('launch-error-msg');
  const repairGuide = document.getElementById('launch-repair-guide');
  if (errorSection) errorSection.style.display = 'flex';
  if (repairGuide) {
    repairGuide.style.display = 'flex';
    repairGuide.dataset.versionId = (details && details.versionId) || appState.currentSettingsVersionId || (appState.launchVersionCustomSelect ? appState.launchVersionCustomSelect.getValue() : '');
  }

  let fullMsg = msg || '未知错误';
  if (details) {
    console.error('[Launch] 详细错误信息:', details);
    try { console.error('[Launch] 详细错误信息(JSON):', JSON.stringify(details, null, 2)); } catch(_) {}
    if (details.versionId) fullMsg += `\n版本: ${details.versionId}`;
    if (details.mainClass) fullMsg += `\n主类: ${details.mainClass}`;
    if (details.externalVersionDir) fullMsg += `\n外部目录: ${details.externalVersionDir}`;
    if (details.error) fullMsg += `\n错误: ${details.error}`;
  }

  if (errorMsg) {
    errorMsg.innerHTML = (msg || '未知错误').replace(/\n/g, '<br>');
    errorMsg.title = fullMsg;
    // 绑定"前往 Java 管理页面"链接（避免依赖内联 onclick，兼容 CSP）
    const navLink = errorMsg.querySelector('#launch-nav-java');
    if (navLink) {
      navLink.addEventListener('click', (e) => {
        e.preventDefault();
        closeLaunchModal();
        navigateToPage('java');
      });
    }
  }

  const statusEl = document.getElementById('launch-splash-status');
  if (statusEl) {
    // 状态栏用纯文本，避免把 HTML 标签原样显示出来
    const cleanTmp = document.createElement('div');
    cleanTmp.innerHTML = msg || '启动失败';
    statusEl.textContent = cleanTmp.textContent || '启动失败';
    statusEl.style.color = '#dc2626';
  }
}

function hideLaunchError() {
  const errorSection = document.getElementById('launch-error-section');
  const repairGuide = document.getElementById('launch-repair-guide');
  if (errorSection) errorSection.style.display = 'none';
  if (repairGuide) repairGuide.style.display = 'none';

  const statusEl = document.getElementById('launch-splash-status');
  if (statusEl) statusEl.style.color = '';
}

function updateLaunchDownloadProgress(pct, msg, detailData) {
  const statusEl = document.getElementById('launch-splash-status');
  if (!statusEl) return;

  if (detailData) {
    const parts = [];
    if (detailData.completedFiles !== undefined && detailData.totalFiles !== undefined) {
      parts.push(detailData.completedFiles + '/' + detailData.totalFiles);
    }
    if (detailData.speed > 0) {
      const spd = detailData.speed;
      if (spd < 1024) parts.push(spd.toFixed(0) + ' B/s');
      else if (spd < 1024 * 1024) parts.push((spd / 1024).toFixed(1) + ' KB/s');
      else parts.push((spd / (1024 * 1024)).toFixed(1) + ' MB/s');
    }
    statusEl.textContent = (parts.length ? parts.join('  ') + ' - ' : '') + Math.round(pct) + '%';
  } else if (msg) {
    statusEl.textContent = msg;
  }
}

function toggleLaunchLog() {
  const content = document.getElementById('launch-log-content');
  if (content.style.maxHeight === '0px') {
    content.style.maxHeight = '150px';
  } else {
    content.style.maxHeight = '0px';
  }
}

async function pollLaunchDownload(sessionId, versionId, _requiredJava) {
  try {
    let lastPct = 0;
    let smoothPct = 0;
    
    const pollInterval = setInterval(async () => {
      S.launchDlPollInterval = pollInterval;
      try {
        const dlStatus = await API.getLaunchSessionStatus(sessionId);
        
        if (!dlStatus || dlStatus.status === 'error') {
          clearInterval(pollInterval);
          setLaunchStep('download', 'error', dlStatus?.message || '下载失败');
          showLaunchError(dlStatus?.message || '下载失败');
          const launchBtn = document.getElementById('launch-btn');
          const homeLaunchBtn = document.getElementById('home-launch-btn');
          if (launchBtn) launchBtn.disabled = false;
          if (homeLaunchBtn) homeLaunchBtn.disabled = false;
          return;
        }
        
        const rawPct = dlStatus.progress || 0;
        if (smoothPct <= 0 || rawPct < smoothPct) {
          smoothPct = rawPct;
        } else {
          smoothPct = smoothPct * 0.85 + rawPct * 0.15;
        }
        const pct = Math.min(95, Math.round(smoothPct));
        if (pct !== lastPct) {
          lastPct = pct;
          updateLaunchDownloadProgress(pct, `下载文件 (${dlStatus.completedFiles || 0}/${dlStatus.totalFiles || 0}): ${dlStatus.currentFile || ''}`, {
            completedFiles: dlStatus.completedFiles || 0,
            totalFiles: dlStatus.totalFiles || 0,
            currentFile: dlStatus.currentFile || '',
            speed: dlStatus.speed || 0,
            activeDownloads: dlStatus.activeDownloads || []
          });
          const baseProgress = 40;
          updateLaunchProgress(baseProgress + (pct / 100) * 50);
        }
        
        if (dlStatus.status === 'completed') {
          clearInterval(pollInterval);
          updateLaunchDownloadProgress(100, '下载完成', {
            completedFiles: dlStatus.totalFiles || 0,
            totalFiles: dlStatus.totalFiles || 0,
            currentFile: '',
            speed: 0,
            activeDownloads: []
          });
          setLaunchStep('download', 'success', '缺失文件下载完成');
          
          setTimeout(async () => {
            setLaunchStep('build-args', 'running', '正在构建启动参数...');
            await new Promise(r => setTimeout(r, 200));
            setLaunchStep('build-args', 'success', '启动参数构建完成');
            
            setLaunchStep('S.launching', 'running', '正在启动 Minecraft...');
            
            const result = await API.launchGame(versionId);
            
            if (result.success) {
              setLaunchStep('S.launching', 'success', '游戏进程已创建');
              updateLaunchProgress(100);
              document.getElementById('launch-log-section').style.display = '';
              const launchBtn = document.getElementById('launch-btn');
              const homeLaunchBtn = document.getElementById('home-launch-btn');
              launchBtn.classList.add('running');
              launchBtn.querySelector('span').textContent = '启动游戏';
              document.getElementById('status-indicator')?.classList.add('running');
              const _st4 = document.getElementById('status-text'); if (_st4) _st4.textContent = '游戏运行中';
              startGameLogStream();
              refreshGameStatusAfterLaunch();
              incrementLaunchCount();
              checkSupportMilestone();
              _onGameRunning();
              setTimeout(() => {
                closeLaunchModal('fade');
                launchBtn.disabled = false;
                homeLaunchBtn.disabled = false;
              }, 2000);
            } else {
              setLaunchStep('S.launching', 'error', result.error || '启动失败');
              showLaunchError(result.error || '启动失败');
              const launchBtn = document.getElementById('launch-btn');
              const homeLaunchBtn = document.getElementById('home-launch-btn');
              if (launchBtn) launchBtn.disabled = false;
              if (homeLaunchBtn) homeLaunchBtn.disabled = false;
            }
          }, 500);
        }
      } catch (e) {
        console.warn('[Launch] 启动轮询回调异常:', e);
      }
    }, 800);
  } catch (e) {
    console.error('[Launch] 轮询失败:', e);
  }
}

function openVersionSettingsForRepair() {
  const repairGuide = document.getElementById('launch-repair-guide');
  const versionId = (repairGuide && repairGuide.dataset.versionId) || (appState.launchVersionCustomSelect ? appState.launchVersionCustomSelect.getValue() : '');
  if (versionId) {
    import('../versions/version-settings.js')
      .then((m) => m.openVersionSettings(versionId))
      .catch((e) => console.error('[launch] 版本设置模块加载失败:', e));
  }
  closeLaunchModal();
}

export { showLaunchModal, closeLaunchModal, updateLaunchProgress, setLaunchStep, completeAllPreviousSteps, showLaunchError, hideLaunchError, updateLaunchDownloadProgress, toggleLaunchLog, pollLaunchDownload, openVersionSettingsForRepair };
