// 首页统计刷新：独立成模块，避免版本列表与窗口主题互相依赖。
import { appState } from '../../core/app-state.js';

export function updateHomeStats() {
  const el = document.getElementById('stat-installed');
  if (el) el.textContent = appState.installedVersions.length;
}
