// 跨模块懒加载中转：页面模块注册自己的入口，公共组件按名称触发，
// 避免公共组件为了回调而反向依赖具体页面模块。
const loaders = new Map();

export function registerLazyLoader(name, loader) {
    if (typeof loader === 'function') {
        loaders.set(name, loader);
    }
}

export function requestLazyLoad(name) {
    const loader = loaders.get(name);
    if (!loader) {
        console.warn('[lazy-loaders] 加载器尚未注册:', name);
        return undefined;
    }
    return loader();
}
