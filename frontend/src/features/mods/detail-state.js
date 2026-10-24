// features/mods/detail-state.js — 模组/资源详情页共享状态
// 详情、依赖、版本列表由 mod-detail、mod-install、resource 三个模块共同读写。
export const modDetailState = {
  data: null,
  allVersions: [],
  tab: '',
  loaderFilter: '',
  type: 'mod',
  deps: [],
  depsResolved: {},
  depsVersionInfo: {},
  seq: 0,
  renderedCount: 0,
  currentVersions: [],
};
