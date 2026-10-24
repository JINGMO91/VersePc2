// dynamic-island.js — 门面：保持既有导入路径不变
export * from './dynamic-island-view.js';
export * from './dynamic-island-agent.js';
export * from './dynamic-island-tts.js';
export * from './dynamic-island-voice.js';
export * from './dynamic-island-onboarding.js';
export * from './dynamic-island-config.js';

import { show, update, dismiss, preview, setupHoverZone, isEnabled, isVisible } from './dynamic-island-view.js';
import { speak, stopSpeak } from './dynamic-island-tts.js';
import { chatWithAI, AI_PROVIDERS } from './dynamic-island-config.js';
import { _showOnboarding } from './dynamic-island-onboarding.js';
import { fixCrash } from './dynamic-island-agent.js';

export const DynamicIsland = {
  show: show,
  update: update,
  dismiss: dismiss,
  preview: preview,
  setupHoverZone: setupHoverZone,
  isEnabled: isEnabled,
  isVisible: isVisible,
  // 扩展接口
  speak: speak,
  stopSpeak: stopSpeak,
  chatWithAI: chatWithAI,
  showOnboarding: _showOnboarding,
  fixCrash: fixCrash,
  AI_PROVIDERS: AI_PROVIDERS
};
