// personalize-state.js — 个性化设置的共享响应式状态
// 供个性化设页面组件与 personalize 业务模块共同读写，避免依赖 window 全局。
import { reactive } from 'vue';

export const personalizeState = reactive({
  theme: 'light',
  wallpaper: 'none',
  customColor: '#4c8dff',
  customLight: false,
  customColorGroupVisible: false,
  glassEffect: false,
  liquidGlass: false,
  minimalNav: false,
  hideNavLabels: false,
  autoCollapseNav: false,
  navWidth: 80,
  // 窗口大小记忆默认开启，保持 1.7.2 起已有的自动记忆行为
  rememberWindowSize: true,
  startFullscreen: false,
  panoramaTheme: 'overworld',
  panoramaSpeed: 5,
  panoramaFollow: false,
  opacity: 100,
  blur: 0,
  fit: 'cover',
  customFileName: '未选择',
  weWallpapers: [],
  weWallpaper: null,
  wePickerOpen: false,
  weLoading: false,
  // 场景渲染器组件（可选下载）：null=未知, true=已安装, false=未安装
  weRendererInstalled: null,
  weRendererDownloading: false,
});
