// 问题反馈表单读取与校验：标签、字段收集、校验结果与提交按钮状态。
import { feedbackState } from './feedback-state.js';

function getFeedbackTypeLabel(type) {
  if (type === 'bug') return '问题反馈';
  if (type === 'feature') return '功能建议';
  return '其他';
}

function getFeedbackCategoryLabel(cat) {
  if (cat === 'launch') return '启动问题';
  if (cat === 'download') return '下载问题';
  return '其他';
}

function getFeedbackForm() {
  return {
    type: feedbackState.type,
    typeLabel: getFeedbackTypeLabel(feedbackState.type),
    category: feedbackState.category,
    categoryLabel: getFeedbackCategoryLabel(feedbackState.category),
    title: (document.getElementById('fb-title') || {}).value || '',
    detail: (document.getElementById('fb-detail') || {}).value || '',
    contact: (document.getElementById('fb-contact') || {}).value || '',
    captcha: (document.getElementById('fb-captcha-input') || {}).value || ''
  };
}

/** 返回第一条校验错误，全部通过时返回空字符串 */
function validateFeedback(form) {
  if (!form.title.trim()) return '请填写反馈标题';
  if (form.title.trim().length < 4) return '标题太短，请至少填写 4 个字';
  if (!form.detail.trim()) return '请填写详细描述';
  if (form.detail.trim().length < 10) return '描述太短，请至少填写 10 个字';

  var captchaGroup = document.getElementById('fb-captcha-group');
  if (captchaGroup && !captchaGroup.hidden && !form.captcha.trim()) {
    return '请完成人机验证';
  }
  return '';
}

function updateFeedbackSubmitState() {
  var button = document.getElementById('fb-submit-btn');
  var hint = document.getElementById('fb-submit-hint');
  if (!button) return;

  if (feedbackState.submitting) {
    button.disabled = true;
    return;
  }

  var error = validateFeedback(getFeedbackForm());
  button.disabled = !!error;
  if (hint) hint.textContent = error || '';
  if (hint) hint.classList.toggle('is-error', !!error);
}

function setFeedbackSubmitting(submitting) {
  feedbackState.submitting = submitting;
  var button = document.getElementById('fb-submit-btn');
  if (button) {
    button.disabled = submitting;
    button.textContent = submitting ? '提交中...' : '提交反馈';
  }
}

export {
  getFeedbackTypeLabel, getFeedbackCategoryLabel, getFeedbackForm, validateFeedback,
  updateFeedbackSubmitState, setFeedbackSubmitting
};
