// core/game-store.js — 运行中游戏实例的共享响应式 store
// launch.js 写入，主页与联机页面读取运行状态和时长。
// 时钟由入口显式启动，避免模块加载即创建定时器导致测试与页面生命周期失控。
import { reactive } from 'vue';

export const gameStore = reactive({ instances: [], running: false, now: Date.now() });

let clockTimer = null;

/// 启动每秒刷新的运行时长时钟（幂等）
export function startGameClock() {
  if (clockTimer) return;
  clockTimer = setInterval(() => {
    gameStore.now = Date.now();
  }, 1000);
}

/// 停止时钟，便于测试与页面卸载时清理
export function stopGameClock() {
  if (!clockTimer) return;
  clearInterval(clockTimer);
  clockTimer = null;
}
