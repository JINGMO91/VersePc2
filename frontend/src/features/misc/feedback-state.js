// 问题反馈页共享状态与常量：分类规则、附件限制、站点地址与表单状态。
/** 站点地址 */
export var FEEDBACK_SITE_URL = 'https://verselauncher.cn';

/** 附件限制 */
export var FEEDBACK_MAX_FILES = 10;
export var FEEDBACK_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 分类 -> 自动收集的日志文件名规则 */
export var FEEDBACK_AUTO_LOGS = {
  launch: [
    { prefix: 'launch-debug.log', match: 'exact' },
    { prefix: 'launch-fail-', match: 'prefix' },
    { prefix: 'startup-timing.log', match: 'exact' }
  ],
  download: [
    { prefix: 'modpack-import.log', match: 'exact' },
    { prefix: 'updater-download.log', match: 'exact' },
    { prefix: 'loader-install.log', match: 'exact' },
    { prefix: '.install', match: 'ends' }
  ]
};

/** 表单状态 */
export var feedbackState = {
  type: 'bug',
  category: 'other',
  files: [],          // 截图/视频（手动选择）
  autoLogs: [],       // 日志（自动收集）
  env: null,
  envLoaded: false,
  submitting: false,
  captchaId: '',
  signKey: ''
};
