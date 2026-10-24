// private-server-actions.js — data-action 注册
import { registerActions as registerActions } from '../../core/actions.js';
import { copyPrivateServerAddress, checkPrivateServerStatus, refreshPrivateServerList } from './private-server-list.js';
import { closePrivateServerModal } from './private-server-modal.js';
import { loadLobbyRooms, closeLobbyModsModal } from './private-server-lobby.js';

registerActions({
  closePrivateServerModal,
  copyPrivateServerAddress: (event, el, address) => copyPrivateServerAddress(address),
  checkPrivateServerStatus: (event, el, serverId) => checkPrivateServerStatus(serverId),
  refreshPrivateServerList,
  loadLobbyRooms: (event, el, resetOffset) => loadLobbyRooms(!!resetOffset),
  closeLobbyModsModal,
  openWindow: (event, el, url) => window.open(url, '_blank'),
});
