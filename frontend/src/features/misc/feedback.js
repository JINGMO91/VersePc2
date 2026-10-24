/**
 * @file feedback.js
 * @description 问题反馈页门面 - 汇总日志、附件与表单模块，并注册全局动作
 *
 * 链路：
 *   1. 用户在「问题分类」选择 启动问题 / 下载问题 / 其他
 *   2. 选择后自动扫描 data/logs 收集对应日志（launch -> 启动日志；download -> 下载日志）
 *   3. 提交时加载站点验证码 -> HMAC 防伪签名 -> multipart POST 到 verselauncher.cn
 */

import { registerActions } from '../../core/actions.js';
import {
  feedbackState, FEEDBACK_SITE_URL, FEEDBACK_MAX_FILES, FEEDBACK_MAX_FILE_BYTES, FEEDBACK_AUTO_LOGS
} from './feedback-state.js';
import {
  pickFeedbackFiles, onFeedbackFilesPicked, addFeedbackFiles, removeFeedbackFile,
  renderFeedbackFiles, formatFeedbackSize, escapeFeedbackText
} from './feedback-attachments.js';
import {
  collectAutoLogs, readFeedbackFileAsBytes, renderAutoLogFiles, loadFeedbackEnv, renderFeedbackEnv
} from './feedback-logs.js';
import {
  selectFeedbackType, selectFeedbackCategory,
  onFeedbackDetailInput, loadFeedbackCaptcha, refreshFeedbackCaptcha, fetchFeedbackJson,
  resetFeedbackForm, submitFeedback, sendFeedbackToSite, hmacFeedbackSha256, hexToBytes,
  bytesToHex, randomFeedbackNonce, openFeedbackSite
} from './feedback-form.js';
import {
  getFeedbackTypeLabel, getFeedbackCategoryLabel, getFeedbackForm, validateFeedback,
  updateFeedbackSubmitState, setFeedbackSubmitting
} from './feedback-validate.js';

/** 绑定拖拽区、采集环境信息并同步按钮状态（Vue 挂载完成后调用） */
function setupFeedback() {
  var drop = document.getElementById('fb-drop');
  if (drop) {
    drop.addEventListener('dragover', function (e) {
      e.preventDefault();
      drop.classList.add('drag-over');
    });
    drop.addEventListener('dragleave', function () {
      drop.classList.remove('drag-over');
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files) {
        addFeedbackFiles(e.dataTransfer.files);
      }
    });
  }

  onFeedbackDetailInput();
  renderFeedbackFiles();
  renderAutoLogFiles();
  updateFeedbackSubmitState();
  loadFeedbackEnv();
  loadFeedbackCaptcha();
}

registerActions({
  removeFeedbackFile: (event, el, index) => removeFeedbackFile(index),
});

// 迁移过渡：保持旧脚本与模板可用的导入路径
export {
  setupFeedback, selectFeedbackType, getFeedbackTypeLabel, selectFeedbackCategory,
  getFeedbackCategoryLabel, collectAutoLogs, readFeedbackFileAsBytes, renderAutoLogFiles,
  pickFeedbackFiles, onFeedbackFilesPicked, addFeedbackFiles, removeFeedbackFile,
  renderFeedbackFiles, formatFeedbackSize, escapeFeedbackText, onFeedbackDetailInput,
  loadFeedbackEnv, renderFeedbackEnv, loadFeedbackCaptcha, refreshFeedbackCaptcha,
  fetchFeedbackJson, getFeedbackForm, validateFeedback, updateFeedbackSubmitState,
  setFeedbackSubmitting, resetFeedbackForm, submitFeedback, sendFeedbackToSite,
  hmacFeedbackSha256, hexToBytes, bytesToHex, randomFeedbackNonce, openFeedbackSite,
  FEEDBACK_SITE_URL, FEEDBACK_MAX_FILES, FEEDBACK_MAX_FILE_BYTES, FEEDBACK_AUTO_LOGS,
  feedbackState
};
