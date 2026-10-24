// 问题反馈日志与环境信息：按分类扫描 data/logs、读取日志、渲染自动日志与运行环境。
import { API } from '../../core/api.js';
import { bridge } from '../../core/tauri-bridge.js';
import { decodeFileBuffer } from '../../core/utils.js';
import { feedbackState, FEEDBACK_AUTO_LOGS, FEEDBACK_MAX_FILE_BYTES } from './feedback-state.js';
import { escapeFeedbackText, formatFeedbackSize } from './feedback-attachments.js';

/** 扫描 data/logs 并读取匹配日志，追加到 autoLogs（自动收集最多 8 个） */
async function collectAutoLogs() {
  var rules = FEEDBACK_AUTO_LOGS[feedbackState.category];
  var tip = document.getElementById('fb-auto-log-tip');
  var badge = document.getElementById('fb-auto-log-badge');

  if (!rules) {
    if (tip) { tip.textContent = '「其他」分类无需收集日志，可直接补充截图或描述'; tip.className = 'fb-auto-log-tip empty'; }
    if (badge) badge.hidden = true;
    return;
  }
  if (tip) { tip.textContent = '正在扫描 data/logs 收集日志...'; tip.className = 'fb-auto-log-tip loading'; }
  if (badge) badge.hidden = false;

  try {
    var dataDir = null;
    if (typeof API !== 'undefined' && typeof API.getDataDir === 'function') {
      var res = await API.getDataDir();
      if (res && res.dataDir) dataDir = res.dataDir;
    }
    if (!dataDir) {
      if (tip) { tip.textContent = '获取数据目录失败，无法自动收集日志'; tip.className = 'fb-auto-log-tip empty'; }
      return;
    }

    // logs 目录
    var logsPath = dataDir.replace(/[\\/]+$/, '') + '/logs';
    var entries = [];
    if (typeof API !== 'undefined' && typeof API.browseDirectory === 'function') {
      var browse = await API.browseDirectory(logsPath, true);
      // 兼容 items / files / folders 三种返回结构
      if (browse && browse.items) entries = browse.items;
      else if (browse && browse.files) entries = browse.files;
      else if (browse && browse.folders) entries = browse.folders;
    }

    // 按规则过滤，排除目录，按修改时间倒序
    var matched = entries.filter(function (item) {
      if (item.isDirectory) return false;
      var name = String(item.name || '');
      return rules.some(function (rule) {
        if (rule.match === 'exact') return name === rule.prefix;
        if (rule.match === 'prefix') return name.indexOf(rule.prefix) === 0;
        if (rule.match === 'ends') return name.lastIndexOf(rule.prefix) === name.length - rule.prefix.length;
        return false;
      });
    });
    matched.sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); });

    // 读取文件内容转 File（最多 8 个）
    var picked = matched.slice(0, 8);
    var added = [];
    for (var i = 0; i < picked.length; i++) {
      var item = picked[i];
      try {
        var bytes = await readFeedbackFileAsBytes(item.path);
        if (!bytes || bytes.byteLength > FEEDBACK_MAX_FILE_BYTES) continue;
        var file = new File([bytes], item.name, { type: 'text/plain' });
        added.push({ name: item.name, size: file.size, file: file, auto: true });
      } catch (e) { /* 单个日志读取失败跳过 */ }
    }
    feedbackState.autoLogs = added;
  } catch (e) {
    if (tip) { tip.textContent = '日志收集失败：' + (e && e.message ? e.message : '未知错误'); tip.className = 'fb-auto-log-tip empty'; }
  }

  renderAutoLogFiles();
  if (tip) {
    if (!feedbackState.autoLogs.length) {
      tip.textContent = '未在 data/logs 找到相关日志（可能尚未复现过问题）';
      tip.className = 'fb-auto-log-tip empty';
    } else {
      tip.textContent = '已自动收集 ' + feedbackState.autoLogs.length + ' 个日志文件（不可移除，随反馈一并提交）';
      tip.className = 'fb-auto-log-tip';
    }
  }
}

/** 通过 IPC 读取本地文件为 Uint8Array */
async function readFeedbackFileAsBytes(filePath) {
  var api = bridge;
  if (!api || typeof api.readFileBuffer !== 'function') throw new Error('readFileBuffer unavailable');
  var buffer = await api.readFileBuffer(filePath);
  if (typeof decodeFileBuffer === 'function') return decodeFileBuffer(buffer);
  if (buffer instanceof Uint8Array) return buffer;
  if (buffer) return new Uint8Array(buffer);
  return null;
}

function renderAutoLogFiles() {
  var list = document.getElementById('fb-auto-log-list');
  if (!list) return;

  if (!feedbackState.autoLogs.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = feedbackState.autoLogs.map(function (item, _index) {
    return '<div class="fb-file-item">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="fb-file-icon">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
      '<span class="fb-file-name" title="' + escapeFeedbackText(item.name) + '">' + escapeFeedbackText(item.name) + '</span>' +
      '<span class="fb-log-tag is-auto">日志</span>' +
      '<span class="fb-file-size">' + formatFeedbackSize(item.size) + '</span>' +
      '</div>';
  }).join('');
}

async function loadFeedbackEnv() {
  if (feedbackState.envLoaded) {
    renderFeedbackEnv();
    return;
  }

  var env = {
    launcher: '未知',
    system: '未知',
    java: '未知'
  };

  try {
    var api = bridge;
    if (api && api.updater && typeof api.updater.getVersion === 'function') {
      var version = await api.updater.getVersion();
      if (version) env.launcher = 'VersePC2 ' + version;
    }
  } catch (e) {}

  try {
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    var arch = /x64|Win64|WOW64|x86_64/i.test(navigator.userAgent) ? '64 位' : '';
    env.system = platform ? (platform + (arch ? ' · ' + arch : '')) : navigator.userAgent;
  } catch (e) {}

  try {
    if (typeof API !== 'undefined' && typeof API.detectJava === 'function') {
      var result = await API.detectJava();
      var list = (result && result.javaList) || [];
      if (list.length) {
        var best = list.find(function (j) { return j.majorVersion >= 17; }) || list[0];
        env.java = 'Java ' + (best.version || best.majorVersion || '') +
          (best.is64Bit ? ' (64 位)' : '') +
          (best.path ? ' · ' + best.path : '');
      } else {
        env.java = '未检测到';
      }
    }
  } catch (e) {}

  feedbackState.env = env;
  feedbackState.envLoaded = true;
  renderFeedbackEnv();
}

function renderFeedbackEnv() {
  var list = document.getElementById('fb-env-list');
  if (!list) return;
  var env = feedbackState.env;
  if (!env) {
    list.innerHTML = '<div class="fb-env-empty">正在收集环境信息...</div>';
    return;
  }

  var rows = [
    ['启动器版本', env.launcher],
    ['操作系统', env.system],
    ['Java', env.java]
  ];

  list.innerHTML = rows.map(function (row) {
    return '<div class="fb-env-row">' +
      '<span class="fb-env-key">' + row[0] + '</span>' +
      '<span class="fb-env-value" title="' + escapeFeedbackText(row[1]) + '">' + escapeFeedbackText(row[1]) + '</span>' +
      '</div>';
  }).join('');
}

export { collectAutoLogs, readFeedbackFileAsBytes, renderAutoLogFiles, loadFeedbackEnv, renderFeedbackEnv };
