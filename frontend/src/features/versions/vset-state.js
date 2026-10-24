// vset-state.js — 模块共享可变状态
// 仅本域子模块读写，门面不重新声明状态。
import { getDOMElement } from '../misc/utils.js';

export const S = {
  currentVersionSettings: null,
  _modMgrSettingsLoaded: false,
  _exportTreeLoaded: false,
  _checkingModUpdates: false,
  currentRepairSessionId: null,
  repairPollTimer: null,
  memSlider: getDOMElement('vset-memory-value'),
  vsetIsolation: document.getElementById('vset-isolation'),
  vsetWindowTitle: document.getElementById('vset-window-title'),
  vsetCustomInfo: document.getElementById('vset-custom-info'),
  vsetJvmArgs: document.getElementById('vset-jvm-args'),
  vsetGameArgs: document.getElementById('vset-game-args'),
  _translateModJarPath: '',
  _translateModName: '',
  _translateLangInfo: null,
  _AI_PROVIDERS: { zhipu:    { apiFormat: 'openai',    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' }, deepseek: { apiFormat: 'openai',    endpoint: 'https://api.deepseek.com/chat/completions' }, qwen:     { apiFormat: 'openai',    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' }, openai:   { apiFormat: 'openai',    endpoint: 'https://api.openai.com/v1/chat/completions' }, anthropic:{ apiFormat: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages' }, google:   { apiFormat: 'google',    endpoint: '' }, custom:   null, },
};
