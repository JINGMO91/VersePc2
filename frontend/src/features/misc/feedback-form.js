// 问题反馈表单：类型/分类选择、验证码、表单校验、组装与提交。
import { bridge } from '../../core/tauri-bridge.js';
import { showToast } from './ui-components.js';
import { feedbackState, FEEDBACK_SITE_URL, FEEDBACK_MAX_FILES } from './feedback-state.js';
import { renderFeedbackFiles } from './feedback-attachments.js';
import { collectAutoLogs, renderAutoLogFiles } from './feedback-logs.js';
import {
  getFeedbackForm, validateFeedback, updateFeedbackSubmitState, setFeedbackSubmitting
} from './feedback-validate.js';

function selectFeedbackType(btn) {
  if (!btn) return;
  var group = document.getElementById('fb-type-group');
  if (group) {
    group.querySelectorAll('.fb-type-btn').forEach(function (b) { b.classList.remove('active'); });
  }
  btn.classList.add('active');
  feedbackState.type = btn.dataset.type || 'other';
  updateFeedbackSubmitState();
}

function selectFeedbackCategory(btn) {
  if (!btn) return;
  var group = document.getElementById('fb-category-group');
  if (group) {
    group.querySelectorAll('.fb-category-btn').forEach(function (b) { b.classList.remove('active'); });
  }
  btn.classList.add('active');
  feedbackState.category = btn.dataset.cat || 'other';
  // 分类变化后重新扫描日志
  feedbackState.autoLogs = [];
  renderAutoLogFiles();
  collectAutoLogs();
  updateFeedbackSubmitState();
}

function onFeedbackDetailInput() {
  var detail = document.getElementById('fb-detail');
  var counter = document.getElementById('fb-detail-counter');
  if (detail && counter) counter.textContent = detail.value.length + ' / 2000';
  updateFeedbackSubmitState();
}

/* ============================================================================
   人机验证（站点验证码）
   ============================================================================ */

/** 从站点获取验证码 SVG 与签名密钥 */
async function loadFeedbackCaptcha() {
  try {
    var data = await fetchFeedbackJson(FEEDBACK_SITE_URL + '/api/feedback/captcha');
    if (data && data.id && data.svg) {
      feedbackState.captchaId = data.id;
      var img = document.getElementById('fb-captcha-image');
      if (img) img.innerHTML = data.svg;
      var group = document.getElementById('fb-captcha-group');
      if (group) group.hidden = false;
    }
  } catch (e) {}

  // 签名密钥：同源仅站点页面可用；启动器从 /signinfo 获取（host 为 verselauncher.cn）
  if (!feedbackState.signKey) {
    try {
      var keyRes = await fetchFeedbackJson(FEEDBACK_SITE_URL + '/api/feedback/signinfo');
      if (keyRes && keyRes.key) feedbackState.signKey = keyRes.key;
    } catch (e) {}
  }
  updateFeedbackSubmitState();
}

function refreshFeedbackCaptcha() {
  loadFeedbackCaptcha();
}

async function fetchFeedbackJson(url) {
  var res = await fetch(url, { method: 'GET', credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* ============================================================================
   提交
   ============================================================================ */

function resetFeedbackForm() {
  var title = document.getElementById('fb-title');
  var detail = document.getElementById('fb-detail');
  var contact = document.getElementById('fb-contact');
  var captchaInput = document.getElementById('fb-captcha-input');
  if (title) title.value = '';
  if (detail) detail.value = '';
  if (contact) contact.value = '';
  if (captchaInput) captchaInput.value = '';

  feedbackState.files = [];
  feedbackState.type = 'bug';
  var group = document.getElementById('fb-type-group');
  if (group) {
    group.querySelectorAll('.fb-type-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.type === 'bug');
    });
  }

  // 分类重置为「其他」并清空自动日志
  feedbackState.category = 'other';
  feedbackState.autoLogs = [];
  var catGroup = document.getElementById('fb-category-group');
  if (catGroup) {
    catGroup.querySelectorAll('.fb-category-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.cat === 'other');
    });
  }
  var tip = document.getElementById('fb-auto-log-tip');
  if (tip) { tip.textContent = '选择「启动问题」或「下载问题」后自动收集 data/logs 下的相关日志'; tip.className = 'fb-auto-log-tip'; }
  var badge = document.getElementById('fb-auto-log-badge');
  if (badge) badge.hidden = true;

  renderFeedbackFiles();
  renderAutoLogFiles();
  onFeedbackDetailInput();

  // 验证码一次一用，重置后刷新
  loadFeedbackCaptcha();
}

async function submitFeedback() {
  if (feedbackState.submitting) return;

  var form = getFeedbackForm();
  var error = validateFeedback(form);
  if (error) {
    updateFeedbackSubmitState();
    if (typeof showToast === 'function') showToast(error, 'error');
    return;
  }

  var includeEnv = document.getElementById('fb-include-env');

  setFeedbackSubmitting(true);
  try {
    await sendFeedbackToSite({
      category: form.category,
      categoryLabel: form.categoryLabel,
      title: form.title.trim(),
      detail: form.detail.trim(),
      contact: form.contact.trim(),
      captcha: form.captcha.trim(),
      env: (includeEnv && includeEnv.checked) ? feedbackState.env : null,
      autoLogs: feedbackState.autoLogs,
      files: feedbackState.files
    });
    setFeedbackSubmitting(false);
    resetFeedbackForm();
    loadFeedbackCaptcha();
    if (typeof showToast === 'function') showToast('反馈已提交，感谢你的反馈！', 'success');
  } catch (e) {
    setFeedbackSubmitting(false);
    updateFeedbackSubmitState();
    // 验证码一次一用（服务端校验即删）：失败后必须换新验证码并清空输入，
    // 否则携带已失效的 captchaId 重试会永远报"验证码不正确"
    var captchaInput = document.getElementById("fb-captcha-input");
    if (captchaInput) captchaInput.value = "";
    loadFeedbackCaptcha();
    // 429 时提示明日再试
    if (e && e.status === 429) {
      if (typeof showToast === 'function') showToast('今日已提交过反馈，请明日再试', 'error');
      return;
    }
    if (e && e.dailyLimit) {
      if (typeof showToast === 'function') showToast('今日已提交过反馈，请明日再试', 'error');
      return;
    }
    if (typeof showToast === 'function') showToast(e && e.message ? e.message : '提交失败，请稍后重试', 'error');
  }
}

/**
 * 提交到站点：multipart POST + HMAC-SHA256 防伪签名 + 验证码 + nonce 防重放
 *
 * 签名载荷：verse-feedback-v1|captchaId|nonce|ts|client|category|title|description
 * （与站点 lib/sign.ts 校验规则一致）
 */
async function sendFeedbackToSite(payload) {
  if (!feedbackState.signKey) {
    throw new Error('验证码与签名信息尚未就绪，请稍后重试');
  }

  // 拼接提交描述：正文 + 分类 + 环境信息
  var description = payload.detail;
  if (payload.env) {
    description += '\n\n【环境信息】启动器：' + (payload.env.launcher || '未知') +
      '；操作系统：' + (payload.env.system || '未知') +
      '；Java：' + (payload.env.java || '未知');
  }

  var captchaId = feedbackState.captchaId;
  var nonce = randomFeedbackNonce();
  var ts = String(Date.now());
  var client = 'versepc2';
  var category = payload.categoryLabel;
  var title = payload.title;

  var parts = ['verse-feedback-v1', captchaId, nonce, ts, client, category, title, description];
  var sig = await hmacFeedbackSha256(feedbackState.signKey, parts.join('|'));

  var formData = new FormData();
  formData.append('client', client);
  formData.append('title', title);
  formData.append('description', description);
  formData.append('category', category);
  formData.append('email', payload.contact);
  formData.append('captchaId', captchaId);
  formData.append('captchaAnswer', payload.captcha);
  formData.append('nonce', nonce);
  formData.append('ts', ts);
  formData.append('sig', sig);

  // 日志（自动收集）在前，截图/视频在后
  var allFiles = payload.autoLogs.concat(payload.files).slice(0, FEEDBACK_MAX_FILES);
  for (var i = 0; i < allFiles.length; i++) {
    formData.append('file' + i, allFiles[i].file, allFiles[i].name);
  }

  var res = await fetch(FEEDBACK_SITE_URL + '/api/feedback', {
    method: 'POST',
    body: formData,
    credentials: 'omit'
  });

  if (res.status === 429) {
    var e429 = new Error('今日已提交过反馈，请明日再试');
    e429.status = 429;
    e429.dailyLimit = true;
    throw e429;
  }
  if (!res.ok) {
    var body = null;
    try { body = await res.json(); } catch (e) {}
    if (body && body.error === 'captcha incorrect') throw new Error('验证码不正确，请点击验证码刷新后重试');
    if (body && body.error === 'invalid signature') throw new Error('提交校验失败，请刷新验证码后重试');
    if (body && body.error === 'replay denied') throw new Error('请勿重复提交，请刷新验证码后重试');
    throw new Error('提交失败（' + res.status + '），请稍后重试');
  }
  return true;
}

/** HMAC-SHA256 hex，密钥为 hex 字符串（与站点 Web Crypto 实现对应） */
async function hmacFeedbackSha256(keyHex, message) {
  var keyBytes = hexToBytes(keyHex);
  var key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  var sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function hexToBytes(hex) {
  var clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
  var bytes = new Uint8Array(clean.length / 2);
  for (var i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

/** 随机一次性 nonce（8-64 位字母数字） */
function randomFeedbackNonce() {
  var bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(function (b) { return b.toString(36); }).join('').slice(0, 32);
}

function openFeedbackSite() {
  var api = bridge;
  if (api && typeof api.openExternal === 'function') {
    api.openExternal(FEEDBACK_SITE_URL).catch(function () {});
    return;
  }
  window.open(FEEDBACK_SITE_URL, '_blank');
}

export {
  selectFeedbackType, selectFeedbackCategory,
  onFeedbackDetailInput, loadFeedbackCaptcha, refreshFeedbackCaptcha, fetchFeedbackJson,
  resetFeedbackForm, submitFeedback, sendFeedbackToSite, hmacFeedbackSha256, hexToBytes,
  bytesToHex, randomFeedbackNonce, openFeedbackSite
};
