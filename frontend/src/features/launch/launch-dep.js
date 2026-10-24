import { API as API } from '../../core/api.js';
import { incrementLaunchCount as incrementLaunchCount, checkSupportMilestone as checkSupportMilestone } from '../misc/announcement.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { appState as appState } from '../../core/app-state.js';
import { setLaunchStep, updateLaunchDownloadProgress, closeLaunchModal, updateLaunchProgress, showLaunchError } from './launch-modal.js';
import { refreshGameStatusAfterLaunch, _onGameRunning, startGameLogStream } from './launch-runtime.js';

function showLaunchDepModal(versionId, sessionId, missingCount, _depCheck) {
  setLaunchStep('download', 'running', `发现 ${missingCount} 个缺失文件，需要下载...`);
  updateLaunchDownloadProgress(0, `0/${missingCount} 文件`, {
    completedFiles: 0,
    totalFiles: missingCount,
    currentFile: '准备下载...',
    speed: 0,
    activeDownloads: []
  });

  startLaunchDepDownload(versionId, sessionId);
}

function closeLaunchDepModal() {
  if (appState.launchDepPollTimer) { clearInterval(appState.launchDepPollTimer); appState.launchDepPollTimer = null; }
  const modal = document.getElementById('launch-dep-modal');
  if (modal) {
    modal.classList.remove('modal-visible');
    setTimeout(() => modal.remove(), 300);
  }
}

async function startLaunchDepDownload(versionId, sessionId) {
  setLaunchStep('download', 'running', '正在下载缺失文件...');

  try {
    const result = await API.downloadLaunchDeps(versionId, sessionId, 180000);

    if (result.failed > 0) {
      const failedNames = (result.failedFiles || []).map(f => String(f).split('/').pop() || f).join('、');
      const failMsg = `仍有 ${result.failed} 个文件下载失败${failedNames ? '：' + failedNames : ''}`;
      setLaunchStep('download', 'error', failMsg);
      showLaunchError(failMsg);
    } else if (result.success) {
      setLaunchStep('download', 'success', '缺失文件已补全');
      setLaunchStep('build-args', 'running', '正在构建启动参数...');
      await new Promise(r => setTimeout(r, 200));
      setLaunchStep('build-args', 'success', '启动参数构建完成');
      setLaunchStep('S.launching', 'running', '正在启动 Minecraft...');
      const launchBtn = document.getElementById('launch-btn');
      const homeLaunchBtn = document.getElementById('home-launch-btn');
      try {
        const launchResult = await API.launchGame(versionId);
        if (launchResult.success) {
          setLaunchStep('S.launching', 'success', '游戏进程已创建');
          updateLaunchProgress(100);
          showToast('游戏启动成功', 'success');
          launchBtn.classList.add('running');
          launchBtn.querySelector('span').textContent = '启动游戏';
          document.getElementById('status-indicator')?.classList.add('running');
          const _st2 = document.getElementById('status-text'); if (_st2) _st2.textContent = '游戏运行中';
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
          setLaunchStep('S.launching', 'error', launchResult.error || '启动失败');
          showLaunchError(launchResult.error || '启动失败', launchResult.details || launchResult);
        }
      } catch (e) {
        setLaunchStep('S.launching', 'error', '启动失败');
        showLaunchError('启动失败', { error: e.message });
      }
      launchBtn.disabled = false;
      if (homeLaunchBtn) homeLaunchBtn.disabled = false;
    } else {
      setLaunchStep('download', 'error', '下载请求失败');
      showLaunchError('下载请求失败');
    }
  } catch (e) {
    setLaunchStep('download', 'error', '下载请求失败: ' + e.message);
    showLaunchError('下载请求失败: ' + e.message, { error: e.message });
  }
}

function pollLaunchDepProgress(sessionId, _versionId) {
  if (appState.launchDepPollTimer) clearInterval(appState.launchDepPollTimer);
  let depSmoothPct = 0;

  appState.launchDepPollTimer = setInterval(async () => {
    try {
      const status = await API.getLaunchSessionStatus(sessionId);

      const detailData = {
        completedFiles: status.completedFiles || 0,
        totalFiles: status.totalFiles || 0,
        currentFile: status.currentFile || '',
        speed: status.speed || 0,
        activeDownloads: status.activeDownloads || []
      };

      const rawDepPct = status.progress || 0;
      if (depSmoothPct <= 0 || rawDepPct < depSmoothPct) {
        depSmoothPct = rawDepPct;
      } else {
        depSmoothPct = depSmoothPct * 0.85 + rawDepPct * 0.15;
      }
      const smoothDepPct = Math.round(depSmoothPct);
      updateLaunchDownloadProgress(smoothDepPct, status.message || '', detailData);
      const baseProgress = 40;
      updateLaunchProgress(baseProgress + (smoothDepPct / 100) * 50);

      if (status.status === 'launched') {
        clearInterval(appState.launchDepPollTimer);
        appState.launchDepPollTimer = null;
        setLaunchStep('download', 'success', '缺失文件下载完成');
        setLaunchStep('build-args', 'success', '启动参数构建完成');
        setLaunchStep('S.launching', 'success', '游戏进程已创建');
        updateLaunchProgress(100);
        showToast('游戏启动成功', 'success');
        const launchBtn = document.getElementById('launch-btn');
        const homeLaunchBtn = document.getElementById('home-launch-btn');
        launchBtn.classList.add('running');
        launchBtn.querySelector('span').textContent = '启动游戏';
        document.getElementById('status-indicator')?.classList.add('running');
        const _st3 = document.getElementById('status-text'); if (_st3) _st3.textContent = '游戏运行中';
        startGameLogStream();
        incrementLaunchCount();
        checkSupportMilestone();
        _onGameRunning();
        setTimeout(() => {
          closeLaunchModal('fade');
          launchBtn.disabled = false;
          if (homeLaunchBtn) homeLaunchBtn.disabled = false;
        }, 2000);
      } else if (status.status === 'launch_failed') {
        clearInterval(appState.launchDepPollTimer);
        appState.launchDepPollTimer = null;
        setLaunchStep('S.launching', 'error', status.message || '启动失败');
        showLaunchError(status.message || '启动失败', status.launchResult || status);
      } else if (status.status === 'failed') {
        clearInterval(appState.launchDepPollTimer);
        appState.launchDepPollTimer = null;
        setLaunchStep('download', 'error', status.message || '下载失败');
        showLaunchError(status.message || '下载失败', { failedFiles: status.failedFiles });
      } else if (status.status === 'completed' && status.failed > 0) {
        setLaunchStep('download', 'warning', `${status.failed} 个文件下载失败`);
      } else if (status.status === 'completed') {
        clearInterval(appState.launchDepPollTimer);
        appState.launchDepPollTimer = null;
        updateLaunchDownloadProgress(100, '下载完成', {
          completedFiles: status.totalFiles || 0,
          totalFiles: status.totalFiles || 0,
          currentFile: '',
          speed: 0,
          activeDownloads: []
        });
        setLaunchStep('download', 'success', '缺失文件下载完成');
        showToast(`下载完成: ${status.completedFiles || 0} 个文件`, 'success');
      }
    } catch (e) {
      console.error('[Launch Poll] Error:', e);
    }
  }, 200);
}

async function retryLaunchDepDownload(versionId, sessionId) {
  setLaunchStep('download', 'running', '正在重试下载...');

  try {
    const result = await API.downloadLaunchDeps(versionId, sessionId);
    if (result.success && result.sessionId) {
      pollLaunchDepProgress(result.sessionId, versionId);
    } else {
      setLaunchStep('download', 'error', '重试失败');
      showLaunchError('重试失败', result);
    }
  } catch (e) {
    setLaunchStep('download', 'error', '重试请求失败');
    showLaunchError('重试请求失败', { error: e.message });
  }
}

export { showLaunchDepModal, closeLaunchDepModal, startLaunchDepDownload, pollLaunchDepProgress, retryLaunchDepDownload };
