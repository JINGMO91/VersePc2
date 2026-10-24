// 问题反馈附件：文件选择、添加/移除、列表渲染与大小/文本格式化。
import { showToast } from './ui-components.js';
import { actionAttrs } from '../../core/actions.js';
import { feedbackState, FEEDBACK_MAX_FILES, FEEDBACK_MAX_FILE_BYTES } from './feedback-state.js';
import { updateFeedbackSubmitState } from './feedback-validate.js';

function pickFeedbackFiles() {
  var input = document.getElementById('fb-file-input');
  if (input) input.click();
}

function onFeedbackFilesPicked(fileList) {
  addFeedbackFiles(fileList);
  var input = document.getElementById('fb-file-input');
  if (input) input.value = '';
}

function addFeedbackFiles(fileList) {
  var incoming = Array.prototype.slice.call(fileList || []);
  var rejected = [];

  incoming.forEach(function (file) {
    if (feedbackState.files.length >= FEEDBACK_MAX_FILES) {
      rejected.push(file.name + '（已达数量上限）');
      return;
    }
    if (file.size > FEEDBACK_MAX_FILE_BYTES) {
      rejected.push(file.name + '（超过 20 MB）');
      return;
    }
    var duplicated = feedbackState.files.some(function (item) {
      return item.name === file.name && item.size === file.size;
    });
    if (duplicated) return;
    feedbackState.files.push({ name: file.name, size: file.size, file: file });
  });

  if (rejected.length && typeof showToast === 'function') {
    showToast('已跳过：' + rejected.join('、'), 'error');
  }
  renderFeedbackFiles();
  updateFeedbackSubmitState();
}

function removeFeedbackFile(index) {
  feedbackState.files.splice(index, 1);
  renderFeedbackFiles();
  updateFeedbackSubmitState();
}

function renderFeedbackFiles() {
  var list = document.getElementById('fb-file-list');
  if (!list) return;

  if (!feedbackState.files.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = feedbackState.files.map(function (item, index) {
    return '<div class="fb-file-item">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="fb-file-icon">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
      '<span class="fb-file-name" title="' + escapeFeedbackText(item.name) + '">' + escapeFeedbackText(item.name) + '</span>' +
      '<span class="fb-file-size">' + formatFeedbackSize(item.size) + '</span>' +
      '<button class="fb-file-remove" title="移除"' + actionAttrs('removeFeedbackFile', index) + '>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '</div>';
  }).join('');
}

function formatFeedbackSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function escapeFeedbackText(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

export {
  pickFeedbackFiles, onFeedbackFilesPicked, addFeedbackFiles, removeFeedbackFile,
  renderFeedbackFiles, formatFeedbackSize, escapeFeedbackText
};
