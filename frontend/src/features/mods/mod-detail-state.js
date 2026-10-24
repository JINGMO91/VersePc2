// mod-detail-state.js — 模块共享可变状态
// 仅本域子模块读写，门面不重新声明状态。
class LRUCache {
  constructor(maxSize) {
    this._max = maxSize;
    this._map = new Map();
  }
  has(key) { return this._map.has(key); }
  get(key) {
    if (!this._map.has(key)) return undefined;
    const val = this._map.get(key);
    this._map.delete(key);
    this._map.set(key, val);
    return val;
  }
  set(key, val) {
    if (this._map.has(key)) this._map.delete(key);
    this._map.set(key, val);
    if (this._map.size > this._max) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
  }
  delete(key) { this._map.delete(key); }
  clear() { this._map.clear(); }
  get size() { return this._map.size; }
}

export const S = {
  mdGallery: [],
  mdGalleryIndex: -1,
  mdTabMode: 'major',
  _projectDataCache: new LRUCache(200),
  _versionPreloadCache: new LRUCache(100),
  _versionPreloadInFlight: new Set(),
  _mdImageCache: new Map(),
  mdDepsCache: new Map(),
  MD_DEPS_CACHE_TTL: 5 * 60 * 1000,
  MD_DEPS_CACHE_MAX: 50,
  MDV_INITIAL_RENDER: 30,
};

export { LRUCache };
