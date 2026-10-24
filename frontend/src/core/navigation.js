// core/navigation.js — 页面导航的中立入口
// 业务模块只依赖此文件发起页面切换，具体实现由版本导航模块在启动时注册，
// 避免设置、启动、模组等模块反向依赖版本导航而形成循环依赖。

let navigationHandler = null;
let versionDetailHandler = null;

/// 注册实际导航实现（由 versions-nav 模块在加载时调用）
export function setNavigationHandler(handler) {
  navigationHandler = typeof handler === 'function' ? handler : null;
}

/// 注册版本详情打开实现
export function setVersionDetailHandler(handler) {
  versionDetailHandler = typeof handler === 'function' ? handler : null;
}

/// 切换页面；实现未注册时给出警告，不抛异常
export function navigateToPage(pageName) {
  if (!navigationHandler) {
    console.warn('[navigation] 导航实现尚未注册:', pageName);
    return;
  }
  return navigationHandler(pageName);
}

/// 打开版本详情页；实现未注册时给出警告
export function openVersionDetail(versionId, versionUrl, versionType) {
  if (!versionDetailHandler) {
    console.warn('[navigation] 版本详情实现尚未注册:', versionId);
    return;
  }
  return versionDetailHandler(versionId, versionUrl, versionType);
}
