// versions-detail-history.js — 详情页返回栈
// 独立成模块：资源页/模组详情只需要返回与入栈能力，避免反向依赖版本导航模块。
import { appState } from '../../core/app-state.js';
import { modDetailState } from '../mods/detail-state.js';
import { navigateToPage } from '../../core/navigation.js';
import { requestLazyLoad } from '../../core/lazy-loaders.js';

/// 返回上一级详情；没有历史时回到来源页
export function goBackFromDetail() {
  if (appState.modDetailHistory.length > 0) {
    const prev = appState.modDetailHistory.pop();
    appState._isRestoringModDetail = true;
    if (prev && prev.type !== 'mod') {
      requestLazyLoad('resource:open-detail', prev.id, prev.type, prev.source);
    } else {
      requestLazyLoad('mod:open-detail', prev && prev.id, prev && prev.source);
    }
    appState._isRestoringModDetail = false;
  } else {
    navigateToPage(appState.previousPage || 'mods');
  }
}

/// 记录当前模组详情到返回栈
export function pushModDetailHistory() {
  if (appState._isRestoringModDetail) return;
  const active = document.querySelector('.page.active');
  if (!active || active.id !== 'page-mod-detail') return;
  if (appState.modDetailHistory.length > 0) {
    const last = appState.modDetailHistory[appState.modDetailHistory.length - 1];
    if (last.id === appState.currentModDetailId && last.source === appState.currentModDetailSource) return;
  }
  appState.modDetailHistory.push({
    id: appState.currentModDetailId,
    source: appState.currentModDetailSource,
    type: modDetailState.type,
  });
}
