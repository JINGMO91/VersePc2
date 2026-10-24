import { bridge as bridge } from '../../core/tauri-bridge.js';
import { escapeHtml as escapeHtml } from '../../core/utils.js';
import { showToast as showToast } from './ui-components.js';
import { actionAttrs as actionAttrs } from '../../core/actions.js';
import { S } from './private-server-state.js';
import { requestLazyLoad } from '../../core/lazy-loaders.js';

async function ensureLobbyServers() {
  if (S.lobbyServerList.length === 0) {
    try {
      const result = await bridge.redstoneOnline.getServers();
      if (result && result.ok && Array.isArray(result.servers) && result.servers.length > 0) {
        S.lobbyServerList = result.servers;
      } else {
        S.lobbyServerList = [];
      }
    } catch (e) {
      console.error('[Lobby] load servers failed:', e);
      S.lobbyServerList = [];
    }
  }
  if (S.lobbyServerIdx >= S.lobbyServerList.length) S.lobbyServerIdx = 0;
  if (S.lobbyServerList.length > 0) {
    S.lobbyServerAddress = S.lobbyServerList[S.lobbyServerIdx].address;
  } else {
    S.lobbyServerAddress = '';
  }
}

async function lobbyCycleServer() {
  if (S.lobbyServerList.length === 0) {
    await ensureLobbyServers();
  }
  if (S.lobbyServerList.length === 0) {
    showToast('未获取到服务器节点', 'error');
    return;
  }
  S.lobbyServerIdx = (S.lobbyServerIdx + 1) % S.lobbyServerList.length;
  S.lobbyServerAddress = S.lobbyServerList[S.lobbyServerIdx].address;
  S.lobbyOffset = 0;
  await loadLobbyRooms();
}

async function loadLobbyRooms(resetOffset = false) {
  if (resetOffset) S.lobbyOffset = 0;
  await ensureLobbyServers();
  if (!S.lobbyServerAddress) {
    S.lobbyError = '未获取到服务器节点，无法加载公开房间';
    S.lobbyRooms = [];
    S.lobbyLoaded = true;
    requestLazyLoad('private-server:render');
    return;
  }
  S.lobbyLoading = true;
  S.lobbyError = '';
  requestLazyLoad('private-server:render');
  try {
    const result = await bridge.redstoneOnline.listPublicTunnels({
      serverAddress: S.lobbyServerAddress,
      offset: S.lobbyOffset,
    });
    if (result && result.ok) {
      S.lobbyRooms = Array.isArray(result.tunnels) ? result.tunnels : [];
      // 接口固定返回最多 10 条；等于页大小则可能还有更多
      S.lobbyHasMore = S.lobbyRooms.length >= S.LOBBY_PAGE_SIZE;
      S.lobbyError = '';
    } else {
      S.lobbyRooms = [];
      S.lobbyHasMore = false;
      S.lobbyError = (result && result.error) || '加载公开房间失败';
    }
  } catch (e) {
    console.error('[Lobby] load rooms failed:', e);
    S.lobbyRooms = [];
    S.lobbyHasMore = false;
    S.lobbyError = e.message || '加载公开房间失败';
  } finally {
    S.lobbyLoading = false;
    S.lobbyLoaded = true;
    requestLazyLoad('private-server:render');
  }
}

function renderLobbyInner() {
  // 节点信息
  const serverLabel = S.lobbyServerList[S.lobbyServerIdx]
    ? `${S.lobbyServerList[S.lobbyServerIdx].name || S.lobbyServerList[S.lobbyServerIdx].address}`
    : '未选择节点';

  // 工具栏：节点切换 + 刷新
  const toolbarHtml = `
    <div class="ps-toolbar">
      <div class="ps-tabs">
        <button class="ps-tab active" id="lobby-server-btn" title="点击切换节点">
          节点：${escapeHtml(serverLabel)}
        </button>
      </div>
      <div class="ps-toolbar-right">
        <button class="ps-refresh-btn" id="lobby-refresh-btn" title="刷新列表">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </div>
    </div>
  `;

  // 加载中
  if (S.lobbyLoading) {
    return toolbarHtml + `
      <div class="ps-empty"><p>正在加载公开房间...</p></div>
      ${getLobbyTipHtml()}
    `;
  }

  // 错误
  if (S.lobbyError) {
    return toolbarHtml + `
      <div class="ps-empty">
        <p>加载失败：${escapeHtml(S.lobbyError)}</p>
        <button class="btn btn-secondary btn-sm" style="margin-top:8px"${actionAttrs('loadLobbyRooms', true)}>重试</button>
      </div>
      ${getLobbyTipHtml()}
    `;
  }

  // 未加载或空
  if (!S.lobbyLoaded) {
    return toolbarHtml + `
      <div class="ps-empty"><p>点击下方刷新按钮加载公开房间</p></div>
      ${getLobbyTipHtml()}
    `;
  }

  if (S.lobbyRooms.length === 0) {
    return toolbarHtml + `
      <div class="ps-empty"><p>当前节点暂无公开房间</p></div>
      ${getLobbyTipHtml()}
    `;
  }

  // 房间卡片
  const cardsHtml = S.lobbyRooms.map(room => {
    const title = room.title ? escapeHtml(room.title) : '未命名房间';
    const desc = room.description ? escapeHtml(room.description) : '';
    const port = parseInt(room.port, 10) || 0;
    const fullAddr = port ? `${S.lobbyServerAddress}:${port}` : '';
    const onlineBadge = room.online
      ? `<span class="lobby-badge online" title="仅允许正版账户加入">仅正版</span>`
      : `<span class="lobby-badge offline" title="允许离线账户加入">允许离线</span>`;
    // 版本信息：description 即为房主上传的版本描述（如 "1.20.1 / Fabric 0.15.7" 或 "1.21 / 原版"）
    const descHtml = desc ? `<div class="ps-card-desc">${desc}</div>` : '';
    // 模组加载器标签：从 description 判断是否原版
    let loaderBadge = '';
    if (desc) {
      if (/原版/.test(desc)) {
        loaderBadge = `<span class="lobby-badge offline" title="原版房间，无模组加载器">原版</span>`;
      } else {
        loaderBadge = `<span class="lobby-badge online" title="该版本有模组加载器">有模组加载器</span>`;
      }
    }
    const addrHtml = fullAddr
      ? `<div class="ps-card-address" data-addr="${escapeHtml(fullAddr)}" title="点击复制">${escapeHtml(fullAddr)}</div>`
      : `<div class="ps-card-address" style="color:var(--text-muted)">端口信息缺失</div>`;
    const copyBtn = fullAddr
      ? `<button class="btn btn-primary btn-sm" data-copy="${escapeHtml(fullAddr)}">复制地址</button>`
      : '';
    return `
      <div class="ps-card lobby-card">
        <div class="ps-card-info">
          <div class="ps-card-title">${title} ${onlineBadge} ${loaderBadge}</div>
          ${addrHtml}
          ${descHtml}
        </div>
        <div class="ps-card-actions">
          ${copyBtn}
        </div>
      </div>
    `;
  }).join('');

  // 翻页
  const currentPage = Math.floor(S.lobbyOffset / S.LOBBY_PAGE_SIZE) + 1;
  const paginationHtml = `
    <div class="ps-pagination">
      <button class="ps-page-btn" data-page="prev" ${S.lobbyOffset <= 0 ? 'disabled' : ''}>上一页</button>
      <span class="ps-page-info">第 ${currentPage} 页</span>
      <button class="ps-page-btn" data-page="next" ${!S.lobbyHasMore ? 'disabled' : ''}>下一页</button>
    </div>
  `;

  return toolbarHtml + `
    <div class="ps-list">${cardsHtml}</div>
    ${paginationHtml}
    ${getLobbyTipHtml()}
  `;
}

function getLobbyTipHtml() {
  return `
    <div class="ps-join-banner">
      <span>联机大厅展示当前节点下所有公开房间，复制地址后在游戏内"多人游戏 → 直接连接"粘贴即可加入</span>
    </div>
  `;
}

function bindLobbyEvents(container) {
  // 节点切换
  const serverBtn = container.querySelector('#lobby-server-btn');
  if (serverBtn) {
    serverBtn.addEventListener('click', lobbyCycleServer);
  }
  // 刷新
  const refreshBtn = container.querySelector('#lobby-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadLobbyRooms(true));
  }
  // 翻页
  container.querySelectorAll('.ps-page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (btn.dataset.page === 'prev') {
        S.lobbyOffset = Math.max(0, S.lobbyOffset - S.LOBBY_PAGE_SIZE);
      } else if (btn.dataset.page === 'next') {
        if (!S.lobbyHasMore) return;
        S.lobbyOffset += S.LOBBY_PAGE_SIZE;
      }
      loadLobbyRooms();
    });
  });
  // 复制地址（卡片地址文本点击）
  container.querySelectorAll('.lobby-card .ps-card-address[data-addr]').forEach(el => {
    el.addEventListener('click', () => copyLobbyAddress(el.dataset.addr));
  });
  // 复制地址按钮
  container.querySelectorAll('.lobby-card [data-copy]').forEach(btn => {
    btn.addEventListener('click', () => copyLobbyAddress(btn.dataset.copy));
  });
}

async function copyLobbyAddress(address) {
  if (!address) return;
  try {
    const result = await bridge.privateServer.copyAddress(address);
    if (result && result.ok) {
      showToast('联机地址已复制，去游戏内直接连接粘贴即可', 'success');
    } else {
      showToast('复制失败', 'error');
    }
  } catch (e) {
    console.error('[Lobby] copy failed:', e);
    showToast('复制失败', 'error');
  }
}

async function showLobbyModsModal(serverAddress, tunnelId, title) {
  // 先弹出加载中弹窗
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'lobby-mods-modal';
  modal.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <h3>房间模组 - ${escapeHtml(title)}</h3>
        <button class="modal-close"${actionAttrs('closeLobbyModsModal')}>&times;</button>
      </div>
      <div class="modal-body">
        <div id="lobby-mods-content" style="text-align:center;padding:20px;color:var(--text-muted)">正在加载模组列表...</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary"${actionAttrs('closeLobbyModsModal')}>关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeLobbyModsModal(); });

  const content = document.getElementById('lobby-mods-content');
  try {
    const result = await bridge.redstoneOnline.getTunnelMods({
      serverAddress,
      tunnelId,
    });
    if (result && result.ok && Array.isArray(result.mods)) {
      if (result.mods.length === 0) {
        content.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">该房间没有模组，是原版房间</div>`;
      } else {
        const list = result.mods.map(m => `<li>${escapeHtml(m)}</li>`).join('');
        content.innerHTML = `
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">共 ${result.mods.length} 个模组</div>
          <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.9;max-height:300px;overflow-y:auto">${list}</ul>
        `;
      }
    } else {
      content.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">加载失败：${escapeHtml((result && result.error) || '未知错误')}</div>`;
    }
  } catch (e) {
    content.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

function closeLobbyModsModal() {
  const m = document.getElementById('lobby-mods-modal');
  if (m) m.remove();
}

export { ensureLobbyServers, lobbyCycleServer, loadLobbyRooms, renderLobbyInner, getLobbyTipHtml, bindLobbyEvents, copyLobbyAddress, showLobbyModsModal, closeLobbyModsModal };
