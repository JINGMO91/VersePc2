// mod-detail.js — 门面：保持既有导入路径不变
import './mod-detail-actions.js';
export * from './mod-version-utils.js';
export * from './mod-detail-images.js';
export * from './mod-detail-header.js';
export * from './mod-detail-versions.js';
export * from './mod-detail-deps.js';
export { LRUCache } from './mod-detail-state.js';

// 缓存对象身份固定，跨域共享同一实例（外部模块只调用其方法，不重新赋值）
import { S as modDetailState } from './mod-detail-state.js';
import { openModDetail } from './mod-detail-header.js';
import { registerLazyLoader } from '../../core/lazy-loaders.js';

// 详情返回栈恢复历史模组时调用
registerLazyLoader('mod:open-detail', (id, source) => openModDetail(id, source));
export const _projectDataCache = modDetailState._projectDataCache;
export const _versionPreloadCache = modDetailState._versionPreloadCache;
export const _versionPreloadInFlight = modDetailState._versionPreloadInFlight;
export const mdDepsCache = modDetailState.mdDepsCache;
export const MD_DEPS_CACHE_TTL = modDetailState.MD_DEPS_CACHE_TTL;
export const MD_DEPS_CACHE_MAX = modDetailState.MD_DEPS_CACHE_MAX;
export const MDV_INITIAL_RENDER = modDetailState.MDV_INITIAL_RENDER;
