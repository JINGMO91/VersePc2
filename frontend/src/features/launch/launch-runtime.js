import { API as API } from '../../core/api.js';
import { gameStore as gameStore } from '../../core/game-store.js';
import { bridge as bridge } from '../../core/tauri-bridge.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { getWallpaperEngine as getWallpaperEngine } from '../settings/wallpaper-engine.js';
import { appState as appState } from '../../core/app-state.js';
import { actionAttrs as actionAttrs } from '../../core/actions.js';
import { S } from './launch-state.js';
import { showCrashAnalysis } from './launch-crash.js';

function refreshGameStatusAfterLaunch() {
  S._gameWasRunning = true;
  try { updateGameStatus(); } catch (e) {}
  setTimeout(function() {
    try { updateGameStatus(); } catch (e) {}
  }, 1500);
}

async function updateGameStatus() {
  try {
    const status = await API.getGameStatus();
    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const launchBtn = document.getElementById('launch-btn');

    if (status.running) {
      if (indicator) indicator.classList.add('running');
      const count = status.instances ? status.instances.length : 1;
      if (statusText) statusText.textContent = count > 1 ? `${count} 个游戏运行中` : '游戏运行中';
      if (launchBtn) {
        launchBtn.classList.add('running');
        const sp = launchBtn.querySelector('span');
        if (sp) sp.textContent = '启动游戏';
      }

      // 无论主页/启动栏元素是否存在，都必须写入运行实例，驱动主页"启动任务"卡片
      updateGameInstanceList(status.instances || []);
      S._gameWasRunning = true;
    } else {
      // 用 DOM 状态判断（indicator 是否有 running 类），比 S._gameWasRunning 变量更可靠
      // 场景：游戏启动成功后秒崩，S._gameWasRunning 还没设为 true，但 indicator 已有 running 类
      const wasRunning = indicator ? indicator.classList.contains('running') : S._gameWasRunning;
      if (indicator) indicator.classList.remove('running');
      if (statusText) statusText.textContent = '就绪';
      if (launchBtn) {
        launchBtn.classList.remove('running');
        const sp = launchBtn.querySelector('span');
        if (sp) sp.textContent = '启动游戏';
      }

      updateGameInstanceList([]);
      S._gameWasRunning = false;

      if (wasRunning) {
        // 后端 gameProcess.on('exit') 设置 lastGameExitAnalysis 可能有延迟，重试几次
        let analysis = null;
        for (let i = 0; i < 4; i++) {
          try {
            const analysisResult = await API.getExitAnalysis();
            analysis = analysisResult.analysis;
            if (analysis) break;
          } catch (e) {
            console.warn(`[Launch] 退出分析失败(尝试 ${i+1}/4):`, e);
          }
          await new Promise(r => setTimeout(r, 600));
        }

        if (analysis && analysis.isCrash) {
          // versionId 存在 launchInfo 里，不是 analysis 顶层
          const crashVid = analysis.launchInfo?.versionId || analysis.launchInfo?.fullVersionId || status.lastVersionId;
          if (crashVid) {
            showCrashAnalysis(crashVid);
          } else {
            showToast(`游戏崩溃: ${analysis.reason}`, 'error');
          }
        }
      }
    }
  } catch (e) {
    S._gameStatusErrorCount++;
    if (S._gameStatusErrorCount <= S.MAX_STATUS_ERRORS) {
      console.warn(`[Launch] 更新游戏状态失败(${S._gameStatusErrorCount}/${S.MAX_STATUS_ERRORS}):`, e.message);
    } else {
      console.error('[Launch] 游戏状态轮询已停止（连续失败超过限制）');
    }
  } finally {
    // 动态调整轮询间隔：游戏运行时 3 秒，空闲时 15 秒
    if (S._gameStatusTimer) clearTimeout(S._gameStatusTimer);
    // 连续报错时放慢到 60 秒重试，而不是永久停止：
    // 否则 store 不再更新，联机页"创建房间"按钮会一直保持禁用且无法恢复
    if (S._gameStatusErrorCount <= S.MAX_STATUS_ERRORS) {
      S._gameStatusTimer = setTimeout(updateGameStatus, S._gameWasRunning ? 3000 : 15000);
    } else {
      S._gameStatusTimer = setTimeout(updateGameStatus, 60000);
      S._gameStatusErrorCount = 0;
    }
  }
}

function updateGameInstanceList(instances) {
  instances = instances || [];

  // 写入共享响应式 store，由主页 Vue 卡片渲染（优先）
  if (gameStore) {
    gameStore.instances = instances;
    gameStore.running = instances.length > 0;
  }

  // 兼容旧的悬浮任务卡片（若存在则不重复渲染）
  let container = document.getElementById('game-instance-list');
  if (!container) return;
  if (instances.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = instances.map(inst => {
    const elapsed = Math.floor((Date.now() - inst.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
    return `
      <div class="game-instance-card" data-session="${inst.sessionId}" style="
        background:var(--card-bg);border:1px solid var(--border);border-radius:8px;
        padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:12px;
        box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:default;
      ">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${inst.versionId}</div>
          <div style="color:var(--text-secondary);font-size:11px;">PID: ${inst.pid} · ${timeStr}${inst.lanPort ? ' · LAN:' + inst.lanPort : ''}</div>
        </div>
        <button${actionAttrs('stopGameInstance', inst.sessionId)} style="
          background:var(--red);color:white;border:none;border-radius:4px;
          padding:2px 8px;cursor:pointer;font-size:11px;flex-shrink:0;
        ">停止</button>
      </div>
    `;
  }).join('');
}

async function stopGameInstance(sessionId) {
  try {
    const result = await API.stopGameInstance(sessionId);
    if (result.success) {
      showToast('游戏实例已停止', 'info');
      updateGameStatus();
    } else {
      showToast(result.error || '停止失败', 'error');
    }
  } catch (e) {
    showToast('停止请求失败', 'error');
  }
}

function _onGameRunning() {
  try { document.body.classList.add('game-running'); } catch (e) {}
  try {
    if (typeof getWallpaperEngine() !== 'undefined' && getWallpaperEngine() && typeof getWallpaperEngine().suspend === 'function') {
      getWallpaperEngine().suspend();
    }
  } catch (e) {}
  try {
    if (bridge && bridge.store && bridge.windowMinimize) {
      bridge.store.get('minimizeOnGameRun').then((val) => {
        // 默认开启：undefined/null 视为 true
        if (val === undefined || val === null || val === true) {
          setTimeout(() => {
            try { bridge.windowMinimize(); } catch (e) {}
          }, 5000);
        }
      }).catch(() => {});
    }
  } catch (e) {}
}

function _onGameExited() {
  try { document.body.classList.remove('game-running'); } catch (e) {}
  try {
    if (typeof getWallpaperEngine() !== 'undefined' && getWallpaperEngine() && typeof getWallpaperEngine().resume === 'function') {
      getWallpaperEngine().resume();
    }
  } catch (e) {}
  try {
    if (bridge && bridge.windowRestore) {
      bridge.windowRestore();
    }
  } catch (e) {}
  // 刷新运行状态，让主页"启动任务"卡片及时消失
  try { updateGameStatus(); } catch (e) {}
}

function startGameLogStream() {
  if (appState.gameLogEventSource) { try { appState.gameLogEventSource.close(); } catch(_) {} appState.gameLogEventSource = null; }
  // 清理之前的 Tauri 事件监听器
  if (S.gameLogUnlisten) { try { S.gameLogUnlisten(); } catch(_) {} S.gameLogUnlisten = null; }
  if (S.gameExitUnlisten) { try { S.gameExitUnlisten(); } catch(_) {} S.gameExitUnlisten = null; }

  const consoleOutput = document.getElementById('console-output');
  if (consoleOutput) consoleOutput.innerHTML = '';

  // 处理单行日志的通用函数
  function handleLogLine(line) {
    let type = '';
    if (line.includes('ERROR') || line.includes('FATAL') || line.includes('Exception')) type = 'error';
    else if (line.includes('WARN')) type = 'warn';
    else if (line.includes('[VersePC]')) type = 'info';
    appendConsoleLine(line, type);
  }

  // Tauri 环境：用事件监听替代 SSE
  if (window.__TAURI__ || window.__TAURI_INTERNALS__) {
    try {
      var evt = (window.__TAURI__ && window.__TAURI__.event) || window.__TAURI_INTERNALS__;
      if (evt && evt.listen) {
        // 监听 game-log 事件
        S.gameLogUnlisten = (function() {
          var disposed = false;
          var unlisten = null;
          evt.listen('game-log', function(event) {
            if (disposed) return;
            try {
              var payload = event.payload || {};
              if (payload.line) {
                handleLogLine(payload.line);
              } else if (payload.batch && Array.isArray(payload.batch)) {
                for (var i = 0; i < payload.batch.length; i++) {
                  handleLogLine(payload.batch[i]);
                }
              }
            } catch (e) { console.warn('[GameLog] 解析日志失败:', e); }
          }).then(function(fn) {
            if (disposed) { try { fn(); } catch(_) {} } else { unlisten = fn; }
          }).catch(function(e) { console.warn('[GameLog] listen game-log failed:', e); });
          return function() { disposed = true; if (unlisten) { try { unlisten(); } catch(_) {} unlisten = null; } };
        })();

        // 监听 game-exit 事件
        S.gameExitUnlisten = (function() {
          var disposed = false;
          var unlisten = null;
          evt.listen('game-exit', function(event) {
            if (disposed) return;
            try {
              var payload = event.payload || {};
              appendConsoleLine('[VersePC] 游戏进程已退出 (code=' + (payload.code != null ? payload.code : '?') + ')', 'warn');
              if (payload.isCrash) {
                appendConsoleLine('[VersePC] 检测到崩溃: ' + (payload.reason || '未知原因'), 'error');
                if (payload.suggestion) {
                  appendConsoleLine('[VersePC] 建议: ' + payload.suggestion, 'info');
                }
              }
              _onGameExited();
            } catch (e) { console.warn('[GameLog] 处理退出事件失败:', e); }
          }).then(function(fn) {
            if (disposed) { try { fn(); } catch(_) {} } else { unlisten = fn; }
          }).catch(function(e) { console.warn('[GameLog] listen game-exit failed:', e); });
          return function() { disposed = true; if (unlisten) { try { unlisten(); } catch(_) {} unlisten = null; } };
        })();

        console.log('[GameLog] 使用 Tauri 事件监听游戏日志');
        return;
      }
    } catch (e) {
      console.warn('[GameLog] Tauri 事件监听初始化失败，回退到 SSE:', e);
    }
  }

  // 非 Tauri 环境：用 SSE
  try {
    appState.gameLogEventSource = new EventSource('/api/game/log/stream');
    appState.gameLogEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'exited') {
          appendConsoleLine('[VersePC] 游戏进程已退出', 'warn');
          _onGameExited();
          appState.gameLogEventSource.close();
          appState.gameLogEventSource = null;
          return;
        }
        if (data.batch && Array.isArray(data.batch)) {
          const frag = document.createDocumentFragment();
          const batchLen = data.batch.length;
          for (let i = 0; i < batchLen; i++) {
            const line = data.batch[i];
            let type = '';
            if (line.includes('ERROR') || line.includes('FATAL') || line.includes('Exception')) type = 'error';
            else if (line.includes('WARN')) type = 'warn';
            else if (line.includes('[VersePC]')) type = 'info';
            const el = document.createElement('div');
            el.className = 'console-line' + (type ? ' ' + type : '');
            el.textContent = line;
            frag.appendChild(el);
          }
          consoleOutput.appendChild(frag);
          while (consoleOutput.children.length > 500) consoleOutput.removeChild(consoleOutput.firstChild);
          consoleOutput.scrollTop = consoleOutput.scrollHeight;
        } else if (data.line) {
          handleLogLine(data.line);
        }
      } catch (e) {
        console.warn('[GameLog] 解析日志行失败:', e);
      }
    };
    appState.gameLogEventSource.onerror = () => { appState.gameLogEventSource.close(); appState.gameLogEventSource = null; };
  } catch (e) {
    console.warn('[GameLog] 创建日志流失败:', e);
  }
}

function appendConsoleLine(text, type = '') {
  const consoleOutput = document.getElementById('console-output');
  if (!consoleOutput) return;
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  line.textContent = text;
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
  while (consoleOutput.children.length > 500) consoleOutput.removeChild(consoleOutput.firstChild);
}

export { refreshGameStatusAfterLaunch, updateGameStatus, updateGameInstanceList, stopGameInstance, _onGameRunning, _onGameExited, startGameLogStream, appendConsoleLine };
