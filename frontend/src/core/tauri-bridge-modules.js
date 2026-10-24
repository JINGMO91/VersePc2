// tauri-bridge-modules.js — 私人服务器 / 本地开服 / 联机模块桥接
// 通过依赖注入复用主桥接层的 invoke 与事件订阅，不直接访问宿主全局。

export function createBridgeModules(deps) {
  'use strict';

  var invoke = deps.invoke;
  var onTauriEvent = deps.onTauriEvent;

  // ── 私人服务器（7 个命令） ──
  var privateServer = {
    list: function () { return invoke('private_server_list'); },
    save: function (servers) { return invoke('private_server_save', { servers: servers }); },
    add: function (server) { return invoke('private_server_add', { server: server }); },
    update: function (server) { return invoke('private_server_update', { server: server }); },
    delete: function (id) { return invoke('private_server_delete', { id: id }); },
    check: function (address) { return invoke('private_server_check', { address: address }); },
    copyAddress: function (address) { return invoke('private_server_copy_address', { address: address }); },
    getIcon: function (icon) { return invoke('private_server_icon', { icon: icon }); }
  };

  // ── 本地开服（11 个命令 + 2 个事件） ──
  var serverHost = {
    list: function () { return invoke('server_host_list'); },
    create: function (opts) {
      opts = opts || {};
      return invoke('server_host_create', {
        versionId: opts.versionId,
        name: opts.name,
        port: opts.port,
        options: {
          maxMem: opts.maxMem,
          onlineMode: opts.onlineMode,
          syncMods: opts.syncMods
        }
      });
    },
    start: function (opts) {
      opts = opts || {};
      return invoke('server_host_start', { serverId: opts.id });
    },
    stop: function (opts) {
      opts = opts || {};
      return invoke('server_host_stop', { serverId: opts.id });
    },
    command: function (opts) {
      opts = opts || {};
      return invoke('server_host_command', { serverId: opts.id, cmd: opts.command });
    },
    status: function (opts) {
      var serverId = (opts && opts.id) ? opts.id : null;
      return invoke('server_host_status', { serverId: serverId });
    },
    delete: function (opts) {
      opts = opts || {};
      return invoke('server_host_delete', { serverId: opts.id });
    },
    openDir: function (opts) {
      var serverId = (opts && opts.id) ? opts.id : null;
      return invoke('server_host_open_dir', { serverId: serverId });
    },
    resolveVersion: function (opts) {
      opts = opts || {};
      return invoke('server_host_resolve_version', { versionId: opts.versionId });
    },
    detectLoader: function (opts) {
      opts = opts || {};
      return invoke('server_host_detect_loader', { versionId: opts.versionId });
    },
    syncMods: function (opts) {
      opts = opts || {};
      return invoke('server_host_sync_mods', {
        serverId: opts.id,
        clientVersionId: opts.clientVersionId || opts.versionId || ''
      });
    },
    onLog: function (cb) {
      return onTauriEvent('server-host:log', cb, function (p) { return p; });
    },
    onStatus: function (cb) {
      return onTauriEvent('server-host:status', cb, function (p) { return p; });
    }
  };

  // ── 红石联机（9 个命令 + 4 个事件） ──
  var _rsUnlisteners = [];

  var redstoneOnline = {
    getServers: function () { return invoke('redstone_servers'); },
    scanPort: function () { return invoke('redstone_scan_port'); },
    start: function (params) { return invoke('redstone_start', { params: params }); },
    stop: function () { return invoke('redstone_stop'); },
    getStatus: function () { return invoke('redstone_status'); },
    onLog: function (callback) {
      var unsub = onTauriEvent('redstone:log', callback, function (payload) {
        if (typeof payload === 'string') return payload;
        return (payload && payload.message) || '';
      });
      _rsUnlisteners.push(unsub);
      return unsub;
    },
    onDisconnected: function (callback) {
      var unsub = onTauriEvent('redstone:disconnected', callback, function () { return undefined; });
      _rsUnlisteners.push(unsub);
      return unsub;
    },
    onReconnecting: function (callback) {
      var unsub = onTauriEvent('redstone:reconnecting', callback, function (payload) { return payload || {}; });
      _rsUnlisteners.push(unsub);
      return unsub;
    },
    onReconnected: function (callback) {
      var unsub = onTauriEvent('redstone:reconnected', callback, function (payload) { return payload || {}; });
      _rsUnlisteners.push(unsub);
      return unsub;
    },
    removeListeners: function () {
      while (_rsUnlisteners.length) {
        var fn = _rsUnlisteners.pop();
        try { fn(); } catch (_) {}
      }
    }
  };

  // EnderLink 联机对象（对应 Rust 端 enderlink_online.rs）
  var enderlinkOnline = {
    getRooms: function () { return invoke('enderlink_rooms'); },
    getNodes: function () { return invoke('enderlink_nodes'); },
    download: function () { return invoke('enderlink_download'); },
    start: function (params) { return invoke('enderlink_start', { params: params }); },
    stop: function () { return invoke('enderlink_stop'); },
    getStatus: function () { return invoke('enderlink_status'); },
    onLog: function (callback) {
      var unsub = onTauriEvent('enderlink:log', callback, function (payload) {
        return { message: payload.message, ts: payload.ts };
      });
      _rsUnlisteners.push(unsub);
      return unsub;
    },
    onDisconnected: function (callback) {
      var unsub = onTauriEvent('enderlink:disconnected', callback, function () { return undefined; });
      _rsUnlisteners.push(unsub);
      return unsub;
    }
  };

  return { privateServer: privateServer, serverHost: serverHost, redstoneOnline: redstoneOnline, enderlinkOnline: enderlinkOnline };
}
