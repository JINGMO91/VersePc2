// private-server-state.js — 模块共享可变状态
// 仅本域子模块读写，门面不重新声明状态。
export const S = {
  privateServerList: [],
  privateServerCheckCache: {},
  _privateServerModal: null,
  psSearchKeyword: '',
  psActiveCategory: 'all',
  psCurrentPage: 1,
  PS_PAGE_SIZE: 10,
  psActiveView: 'my-servers',
  lobbyRooms: [],
  lobbyLoading: false,
  lobbyOffset: 0,
  LOBBY_PAGE_SIZE: 10,
  lobbyHasMore: false,
  lobbyServerList: [],
  lobbyServerIdx: 0,
  lobbyServerAddress: '',
  lobbyLoaded: false,
  lobbyError: '',
  PS_CATEGORIES: [ { id: 'all', label: '全部' }, { id: 'online', label: '在线' }, { id: 'offline', label: '离线' }, { id: 'modpack', label: '有整合包' }, ],
};
