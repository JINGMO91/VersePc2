// accounts.js — 账户域门面：保持既有导入路径不变（Phase 10 拆分）
import './accounts-actions.js';

export * from './accounts-avatar.js';
export * from './accounts-home.js';
export * from './accounts-list.js';
export * from './accounts-detail.js';
export * from './accounts-skins.js';
export * from './accounts-capes.js';
export * from './accounts-auth.js';
export { getCurrentDetailAccount } from './accounts-state.js';
