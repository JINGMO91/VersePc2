// core/vue-ready.js — Vue 分批挂载完成状态
let mountDone = false;
let waiters = [];

export function isVueMountDone() {
  return mountDone;
}

export function markVueMountDone() {
  mountDone = true;
  const pending = waiters;
  waiters = [];
  pending.forEach((resolve) => resolve());
}

export function waitForVueMount() {
  if (mountDone) return Promise.resolve();
  return new Promise((resolve) => { waiters.push(resolve); });
}
