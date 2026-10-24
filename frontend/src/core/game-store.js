// core/game-store.js — 运行中游戏实例的共享响应式 store
// launch.js 写入，主页与联机页面读取运行状态和时长。
import { reactive } from 'vue';

export const gameStore = reactive({ instances: [], running: false, now: Date.now() });

// 每秒刷新一次，用于运行时长倒计时显示
setInterval(() => { gameStore.now = Date.now(); }, 1000);
