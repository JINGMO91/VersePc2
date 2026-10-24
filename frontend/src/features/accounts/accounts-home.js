// accounts-home.js — 首页账户状态、下载与开服入口
import { API as API } from '../../core/api.js';
import { bridge as bridge } from '../../core/tauri-bridge.js';
import { showToast as showToast, showConfirmDialog as showConfirmDialog } from '../misc/ui-components.js';
import { requestLazyLoad } from '../../core/lazy-loaders.js';
import { accountsState as S } from './accounts-state.js';

// 模组列表由模组页模块维护，首页仅触发刷新
const loadInstalledMods = () => requestLazyLoad('mods:installed');

function accUpdateHeroBadge(statusType, text) {
  const badge = document.getElementById('acc-hero-badge');
  if (!badge) return;
  const textEl = document.getElementById('acc-badge-text');
  badge.className = 'acc-hero-status-badge';
  if (statusType === 'running') badge.classList.add('running');
  if (statusType === 'installed') badge.classList.add('installed');
  if (textEl) textEl.textContent = text;
}

async function accLoadStatus() {
  try {
    const status = await API.easytierStatus();
    const installPanel = document.getElementById('acc-install-panel');
    const controlPanel = document.getElementById('acc-control-panel');
    const joinPanel = document.getElementById('acc-join-panel');
    const peersPanel = document.getElementById('acc-peers-panel');
    const statusGrid = document.getElementById('acc-status-grid');
    const configSection = document.getElementById('acc-config-section');
    const startBtn = document.getElementById('acc-start-btn');
    const stopBtn = document.getElementById('acc-stop-btn');

    if (status.running) {
      installPanel.style.display = 'none';
      controlPanel.style.display = '';
      joinPanel.style.display = 'none';
      peersPanel.style.display = '';
      statusGrid.style.display = '';
      configSection.style.display = 'none';
      startBtn.style.display = 'none';
      stopBtn.style.display = '';

      accUpdateHeroBadge('running', '运行中');
      document.getElementById('acc-hero-desc').textContent = 'P2P 虚拟组网已启动';

      document.getElementById('acc-status-mode').textContent = status.mode === 'host' ? '主机模式' : '客户端模式';
      document.getElementById('acc-status-ip').textContent = status.virtualIP || '等待分配...';
      document.getElementById('acc-status-peers').textContent = '0';
      document.getElementById('acc-status-port').textContent = status.gamePort || 25565;

      if (status.mode === 'host') {
        document.getElementById('acc-card-invitation').style.display = '';
        document.getElementById('acc-card-connect').style.display = 'none';
        document.getElementById('acc-status-invitation').textContent = status.roomCode || '等待分配...';
      } else {
        document.getElementById('acc-card-invitation').style.display = 'none';
        document.getElementById('acc-card-connect').style.display = '';
        document.getElementById('acc-status-connect').textContent = status.virtualIP || '等待分配...';
      }

      if (status.state) {
        const stateType = status.state.state;
        if (stateType === 'host-ok' && status.state.room) {
          const roomVal = status.state.room;
          const roomStr = (typeof roomVal === 'object' && roomVal !== null) ? (roomVal.code || '') : roomVal;
          document.getElementById('acc-status-invitation').textContent = roomStr;
          document.getElementById('acc-status-peers').textContent = '1';
        } else if (stateType === 'guest-ok' && status.state.url) {
          document.getElementById('acc-status-connect').textContent = status.state.url;
          document.getElementById('acc-status-ip').textContent = status.state.url;
          document.getElementById('acc-status-peers').textContent = '1';
        }
      }

      if (S.accPollTimer) clearInterval(S.accPollTimer);
      S.accPollTimer = setInterval(accRefreshStatus, 3000);
    } else if (status.installed || status.downloading) {
      installPanel.style.display = status.downloading ? 'none' : '';
      controlPanel.style.display = '';
      joinPanel.style.display = '';
      peersPanel.style.display = 'none';
      statusGrid.style.display = 'none';
      configSection.style.display = 'none';
      startBtn.style.display = '';
      stopBtn.style.display = 'none';
      document.getElementById('acc-download-btn').style.display = 'none';
      document.getElementById('acc-download-progress').style.display = 'none';

      if (status.downloading) {
        accUpdateHeroBadge('installed', '下载中...');
      } else {
        accUpdateHeroBadge('installed', '已就绪');
      }
      document.getElementById('acc-hero-desc').textContent = 'P2P 虚拟组网加速，降低 Minecraft 联机延迟';
    } else {
      installPanel.style.display = '';
      controlPanel.style.display = 'none';
      joinPanel.style.display = 'none';
      peersPanel.style.display = 'none';
      document.getElementById('acc-download-btn').style.display = '';
      document.getElementById('acc-download-progress').style.display = 'none';
      accUpdateHeroBadge('', '未安装');
      document.getElementById('acc-hero-desc').textContent = 'P2P 虚拟组网加速，降低 Minecraft 联机延迟';
    }
  } catch (e) {
    console.error('[Acc] Load status error:', e);
  }
}

async function accRefreshStatus() {
  try {
    const status = await API.easytierStatus();
    if (!status.running) {
      if (S.accPollTimer) { clearInterval(S.accPollTimer); S.accPollTimer = null; }
      accLoadStatus();
      return;
    }

    if (status.state) {
      const stateType = status.state.state;
      if (stateType === 'host-ok') {
        const roomCode = status.state.room || status.roomCode || '';
        document.getElementById('acc-status-invitation').textContent = roomCode;
        document.getElementById('acc-status-peers').textContent = '1';
      } else if (stateType === 'guest-ok') {
        const connectUrl = status.state.url || status.virtualIP || '';
        document.getElementById('acc-status-connect').textContent = connectUrl;
        document.getElementById('acc-status-ip').textContent = connectUrl;
        document.getElementById('acc-status-peers').textContent = '1';
      } else if (stateType === 'host-scanning' || stateType === 'host-starting') {
        document.getElementById('acc-status-peers').textContent = '...';
      } else if (stateType === 'guest-connecting' || stateType === 'guest-starting') {
        document.getElementById('acc-status-peers').textContent = '...';
      } else if (stateType === 'exception') {
        document.getElementById('acc-status-peers').textContent = '!';
      }
    }

    const peersResult = await API.easytierPeers();
    if (peersResult.state && peersResult.state.state === 'host-ok' && peersResult.state.room) {
      document.getElementById('acc-status-invitation').textContent = peersResult.state.room;
    }
    if (peersResult.state && peersResult.state.state === 'guest-ok' && peersResult.state.url) {
      document.getElementById('acc-status-connect').textContent = peersResult.state.url;
      document.getElementById('acc-status-ip').textContent = peersResult.state.url;
    }
  } catch (e) {
    console.error('[Acc] Refresh status error:', e);
  }
}

async function accDownload() {
  const btn = document.getElementById('acc-download-btn');
  btn.disabled = true;
  btn.textContent = '准备下载...';
  document.getElementById('acc-download-progress').style.display = '';

  try {
    const result = await API.easytierDownload();
    S.accDlSessionId = result.sessionId;

    if (S.accDlPollTimer) clearInterval(S.accDlPollTimer);
    S.accDlPollTimer = setInterval(async () => {
      try {
        const status = await API.easytierDownloadStatus(S.accDlSessionId);
        document.getElementById('acc-progress-fill').style.width = status.progress + '%';
        document.getElementById('acc-progress-pct').textContent = status.progress + '%';
        document.getElementById('acc-progress-status').textContent = status.status === 'downloading' ? '下载中' : status.status === 'extracting' ? '解压中' : status.status;
        document.getElementById('acc-progress-msg').textContent = status.message || '';

        if (status.status === 'completed') {
          clearInterval(S.accDlPollTimer);
          S.accDlPollTimer = null;
          showToast('陶瓦联机安装完成！', 'success');
          await accLoadStatus();
        } else if (status.status === 'error') {
          clearInterval(S.accDlPollTimer);
          S.accDlPollTimer = null;
          showToast('安装失败: ' + (status.message || '未知错误'), 'error');
          btn.disabled = false;
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>重新下载';
        }
      } catch (e) {
        console.warn('[Terracotta] 安装进度轮询失败:', e);
      }
    }, 500);
  } catch (e) {
    showToast('启动下载失败: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '下载并安装';
  }
}

async function accStartHost() {
  const portEl = document.getElementById('acc-game-port');
  const gamePort = (portEl && parseInt(portEl.value, 10)) || 25565;
  try {
    showToast('正在初始化陶瓦联机...', 'info');
    document.getElementById('acc-start-btn').disabled = true;
    document.getElementById('acc-start-btn').textContent = '初始化中...';

    await API.easytierHost(gamePort);

    document.getElementById('acc-start-btn').style.display = 'none';
    document.getElementById('acc-stop-btn').style.display = '';
    document.getElementById('acc-status-grid').style.display = '';
    document.getElementById('acc-config-section').style.display = 'none';
    document.getElementById('acc-join-panel').style.display = 'none';

    accUpdateHeroBadge('running', '运行中');
    document.getElementById('acc-hero-desc').textContent = 'P2P 虚拟组网已启动';

    document.getElementById('acc-status-mode').textContent = '主机模式';
    document.getElementById('acc-status-ip').textContent = '等待分配...';
    document.getElementById('acc-status-peers').textContent = '0';
    document.getElementById('acc-status-port').textContent = gamePort;
    document.getElementById('acc-card-invitation').style.display = '';
    document.getElementById('acc-card-connect').style.display = 'none';
    document.getElementById('acc-status-invitation').textContent = '等待分配...';

    if (S.accPollTimer) clearInterval(S.accPollTimer);
    S.accPollTimer = setInterval(accRefreshStatus, 3000);

    showToast('陶瓦联机已启动', 'success');
  } catch (e) {
    showToast('启动失败: ' + e.message, 'error');
    document.getElementById('acc-start-btn').disabled = false;
    document.getElementById('acc-start-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polygon points="5 3 19 12 5 21 5 3"/></svg>启动加速';
  }
}

async function accJoin() {
  const codeText = document.getElementById('acc-join-code').value.trim();
  if (!codeText) {
    showToast('请输入房间码', 'error');
    return;
  }

  try {
    showToast('正在加入联机网络...', 'info');
    const joinBtn = document.querySelector('#acc-join-panel .btn-primary');
    joinBtn.disabled = true;
    joinBtn.textContent = '连接中...';

    await API.easytierGuest(codeText);

    document.getElementById('acc-control-panel').style.display = '';
    document.getElementById('acc-join-panel').style.display = 'none';
    document.getElementById('acc-install-panel').style.display = 'none';
    document.getElementById('acc-peers-panel').style.display = '';
    document.getElementById('acc-status-grid').style.display = '';
    document.getElementById('acc-config-section').style.display = 'none';
    document.getElementById('acc-start-btn').style.display = 'none';
    document.getElementById('acc-stop-btn').style.display = '';

    accUpdateHeroBadge('running', '运行中');
    document.getElementById('acc-hero-desc').textContent = '已加入 P2P 联机网络';

    document.getElementById('acc-status-mode').textContent = '客户端模式';
    document.getElementById('acc-status-ip').textContent = '等待分配...';
    document.getElementById('acc-status-peers').textContent = '0';
    document.getElementById('acc-status-port').textContent = '--';
    document.getElementById('acc-card-invitation').style.display = 'none';
    document.getElementById('acc-card-connect').style.display = '';
    document.getElementById('acc-status-connect').textContent = '等待分配...';

    if (S.accPollTimer) clearInterval(S.accPollTimer);
    S.accPollTimer = setInterval(accRefreshStatus, 3000);

    showToast('已加入联机网络，正在连接...', 'success');
  } catch (e) {
    showToast('加入失败: ' + e.message, 'error');
    const joinBtn = document.querySelector('#acc-join-panel .btn-primary');
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>加入联机网络';
    }
  }
}

async function accStop() {
  if (S.accPollTimer) { clearInterval(S.accPollTimer); S.accPollTimer = null; }
  try {
    await API.easytierStop();
    showToast('加速器已停止', 'info');
  } catch (e) {
    console.warn('[Acc] 停止加速器失败:', e);
  }
  await accLoadStatus();
}

function accCopyInvitation() {
  const code = document.getElementById('acc-status-invitation').textContent;
  if (code && code !== '--' && code !== '等待分配...') {
    bridge.clipboard.writeText(code).then(() => {
      showToast('房间码已复制', 'success');
    });
  }
}

function accCopyConnect() {
  const addr = document.getElementById('acc-status-connect').textContent;
  if (addr && addr !== '--' && addr !== '等待分配...') {
    bridge.clipboard.writeText(addr).then(() => {
      showToast('连接地址已复制', 'success');
    });
  }
}

async function loadSettingsFromLocal() {
  try {
    const raw = await bridge.store.get('versepc_settings');
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  } catch (e) { return null; }
}

async function toggleMod(modId, enabled) {
  try {
    await API.toggleMod(modId, enabled);
    await loadInstalledMods();
    showToast(enabled ? '模组已启用' : '模组已禁用', 'info');
  } catch (e) { showToast('操作失败', 'error'); }
}

async function deleteMod(modId) {
  const confirmed = await showConfirmDialog('删除模组', '确定要删除此模组吗？', '删除', '取消');
  if (!confirmed) return;
  try {
    await API.deleteMod(modId);
    showToast('模组已删除', 'success');
    await loadInstalledMods();
  } catch (e) { showToast('删除失败', 'error'); }
}

export { accUpdateHeroBadge, accLoadStatus, accRefreshStatus, accDownload, accStartHost, accJoin, accStop, accCopyInvitation, accCopyConnect, loadSettingsFromLocal, toggleMod, deleteMod };
