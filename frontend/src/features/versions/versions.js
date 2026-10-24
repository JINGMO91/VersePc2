// versions.js — 版本域门面：保持既有导入路径不变（Phase 10 拆分）
import './versions-actions.js';

export * from './versions-list.js';
export * from './versions-nav.js';
export * from './versions-install.js';
export * from './versions-loaders.js';
export * from './versions-external.js';
export * from './versions-delete.js';
export { AVATAR_CACHE_VERSION } from '../../core/constants.js';
