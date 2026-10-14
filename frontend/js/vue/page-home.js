/* page-home.js - 首页 Vue 组件（页面结构层）
 * 主页可移动控件系统（参考 ZalithLauncher2 主页卡片模式）：
 *   - 每个控件（软件名/头像/版本卡/启动按钮/存档坞/运行卡片）均为绝对定位，
 *     按住拖动柄（悬停显示的 ⠿ 把手；头像直接拖主体）自由移动，
 *     位置与头像缩放持久化到 localStorage（versepc_home_layout_v1）。
 *   - 头像：拖动移动 + 滚轮缩放（0.5x ~ 2.0x），点击进入账户管理。
 *   - 存档坞：常驻卡片（不再从底部展开），显示当前版本存档，点击存档直接启动。
 * 交互逻辑调用 js/app/*.js 的全局函数，全局状态变量在 js/app.js。
 */

// 共享响应式 store（launch.js 写入，主页卡片读取）
if (!window.VersePCGameStore) {
  window.VersePCGameStore = Vue.reactive({ instances: [], running: false, now: Date.now() });
  // 每秒刷新一次，用于运行时长倒计时显示
  setInterval(function () { window.VersePCGameStore.now = Date.now(); }, 1000);
}

const LAYOUT_KEY = 'versepc_home_layout_v1';
const AVATAR_MIN = 0.5, AVATAR_MAX = 2.0, DRAG_THRESHOLD = 5;

function loadHomeLayout() {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {};
  } catch (e) { return {}; }
}
function saveHomeLayout(layout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (e) {}
}
function clampPos(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const PageHome = {
  data() {
    return {
      saves: [],
      currentVersionId: '',
      savesLoading: false,
      _saveIconCache: {},
      _saveIconLoading: {}
    };
  },
  template: `
    <div class="home-page" ref="homePage">
      <!-- 软件名称（可移动，点击回主页） -->
      <div class="home-page-title topbar-title" ref="titleEl" data-widget="title">
        <span class="home-widget-grip" title="拖动移动" @click.stop>
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
        </span>
        Verse<span class="home-page-title-accent">PC2</span>
      </div>

      <!-- 头像控件（可移动 + 滚轮缩放；点击进入账户管理） -->
      <div class="home-avatar-widget" ref="avatarEl" data-widget="avatar" title="拖动移动 · 滚轮缩放 · 点击进入账户">
        <span class="home-widget-grip" title="拖动移动" @click.stop>
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
        </span>
        <div class="home-avatar-scale" ref="avatarScale">
          <div class="home-avatar-box" id="home-avatar-box">
            <div class="home-avatar-img-wrap" id="home-avatar"><img src="img/icon.png" alt="" class="home-avatar-img"></div>
          </div>
          <div class="home-account-bar" id="home-account-bar">
            <span class="account-name" id="home-player-name">未登录</span>
            <span class="account-type" id="home-account-type">离线模式</span>
          </div>
        </div>
      </div>

      <!-- 版本列表卡片（可移动） -->
      <div class="home-version-card-wrap" ref="versionEl" data-widget="version">
        <span class="home-widget-grip" title="拖动移动" @click.stop>
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
        </span>
        <div class="home-current-version-card" id="home-current-version-card" title="点击切换版本">
          <!-- 由 JS 渲染：图标 + 版本名 + 加载器标签 + 右侧箭头 -->
        </div>
      </div>

      <!-- 启动按钮（可移动） -->
      <button id="home-launch-btn" ref="launchEl" class="btn btn-primary btn-lg home-launch-btn">
        <span class="home-widget-grip" title="拖动移动" @click.stop>
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        启动游戏
      </button>

      <!-- 启动任务 / 运行中游戏卡片（可移动，有运行实例时显示） -->
      <div class="home-running-card" ref="runningEl" v-if="gameInstances.length > 0">
        <span class="home-widget-grip" title="拖动移动" @click.stop>
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
        </span>
        <div class="home-running-card-header">
          <span class="home-running-dot"></span>
          <span class="home-running-title">启动任务</span>
          <span class="home-running-count" v-if="gameInstances.length > 1">({{ gameInstances.length }})</span>
        </div>
        <div class="home-running-list">
          <div class="home-running-item" v-for="inst in gameInstances" :key="inst.sessionId">
            <div class="home-running-info">
              <div class="home-running-name">{{ inst.versionId }}</div>
              <div class="home-running-meta">PID: {{ inst.pid }} · {{ formatElapsed(inst) }}</div>
            </div>
            <button class="home-running-stop" @click="stopInstance(inst.sessionId)">停止</button>
          </div>
        </div>
      </div>

      <!-- 存档坞：常驻卡片（可移动），显示当前版本存档，点击直接启动 -->
      <div class="home-save-dock" ref="dockEl" data-widget="saves">
        <div class="home-save-dock-header" title="拖动移动">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:16px;height:16px;color:var(--accent)"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span class="home-save-dock-title">{{ currentVersionName }} · 存档</span>
        </div>
        <div class="home-save-dock-body">
          <p v-if="!currentVersionId" class="home-saves-hint">尚未选择版本，请先在首页选择游戏版本</p>
          <p v-else-if="savesLoading" class="home-saves-hint">加载中...</p>
          <p v-else-if="saves.length === 0" class="home-saves-hint">当前版本暂无存档</p>
          <div v-else class="home-save-dock-list">
            <div class="home-save-card" v-for="s in saves" :key="s.folder" @click="launchSave(s)" :title="'启动并进入 ' + s.name">
              <div class="home-save-card-bg">
                <img v-if="saveIconUrl(s)" :src="saveIconUrl(s)" alt="">
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              </div>
              <div class="home-save-card-info">
                <div class="home-save-card-name" :title="s.name">{{ s.name }}</div>
                <div class="home-save-card-meta">{{ difficultyLabel(s.difficulty) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  computed: {
    gameInstances() {
      return window.VersePCGameStore ? window.VersePCGameStore.instances : [];
    },
    currentVersionName() {
      const vid = this.currentVersionId;
      if (!vid) return '未选择版本';
      const v = (typeof installedVersions !== 'undefined' && installedVersions || []).find(x => x.id === vid);
      return (v && v.customName) || vid;
    }
  },
  methods: {
    widgetByKey(key) {
      return {
        title: this.$refs.titleEl,
        avatar: this.$refs.avatarEl,
        version: this.$refs.versionEl,
        launch: this.$refs.launchEl,
        saves: this.$refs.dockEl,
        running: this.$refs.runningEl
      }[key];
    },
    // ── 可移动控件系统（参考 ZalithLauncher2 主页卡片：自由拖动 + 位置持久化） ──
    applyLayout() {
      const page = this.$refs.homePage;
      if (!page) return;
      const layout = loadHomeLayout();
      const pw = page.clientWidth, ph = page.clientHeight;
      const defaults = {
        title:   function (w, h) { return { x: (pw - w) / 2, y: 14 }; },
        avatar:  function (w, h) { return { x: (pw - w) / 2, y: Math.max(56, ph * 0.14) }; },
        version: function (w, h) { return { x: (pw - w) / 2, y: ph * 0.52 }; },
        launch:  function (w, h) {
          const vEl = this.$refs.versionEl;
          const vy = vEl ? (parseFloat(vEl.style.top) || ph * 0.52) : ph * 0.52;
          const vh = vEl ? vEl.offsetHeight : 60;
          return { x: (pw - w) / 2, y: vy + vh + 16 };
        },
        saves:   function (w, h) { return { x: Math.max(12, pw - w - 28), y: ph * 0.22 }; },
        running: function (w, h) { return { x: 28, y: Math.max(70, ph - h - 24) }; }
      };
      for (const key in defaults) {
        const el = this.widgetByKey(key);
        if (!el) continue;
        const w = el.offsetWidth || 10, h = el.offsetHeight || 10;
        const pos = layout[key] || defaults[key].call(this, w, h);
        el.style.left = clampPos(pos.x, 0, Math.max(0, pw - w)) + 'px';
        el.style.top = clampPos(pos.y, 0, Math.max(0, ph - h)) + 'px';
      }
      // 头像缩放
      const s = (layout.avatar && layout.avatar.s) || 1;
      if (this.$refs.avatarScale) {
        this.$refs.avatarScale.style.transform = 'scale(' + s + ')';
      }
    },
    persistPos(key, el) {
      const layout = loadHomeLayout();
      layout[key] = layout[key] || {};
      layout[key].x = parseInt(el.style.left, 10) || 0;
      layout[key].y = parseInt(el.style.top, 10) || 0;
      if (key === 'avatar') {
        layout.avatar.s = this._avatarScale || 1;
      }
      saveHomeLayout(layout);
    },
    /**
     * 绑定拖动：grip 上 pointerdown → 移动超阈值 = 拖动控件并持久化；
     * 未超阈值松手 = 视为点击，执行 onTap。
     * @param el 被移动的控件元素
     * @param grip 拖动柄元素（null = 控件自身作为拖动区）
     * @param key 布局持久化键
     * @param onTap 未发生拖动时的点击回调（可为 null）
     */
    bindDrag(el, grip, key, onTap) {
      if (!el) return;
      const handle = grip || el;
      const self = this;
      handle.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        // 不拦截控件内部交互元素（按钮/输入等）：仅把手与头像主体走拖动
        if (grip === null && e.target.closest && e.target.closest('button, input, select, a')) return;
        e.preventDefault();
        const page = self.$refs.homePage;
        const rect = el.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        const ox = rect.left - pageRect.left;
        const oy = rect.top - pageRect.top;
        const sx = e.clientX, sy = e.clientY;
        let moved = false;
        try { handle.setPointerCapture(e.pointerId); } catch (err) {}
        const onMove = function (ev) {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
          moved = true;
          const w = el.offsetWidth || 10, h = el.offsetHeight || 10;
          el.style.left = clampPos(ox + dx, 0, Math.max(0, pageRect.width - w)) + 'px';
          el.style.top = clampPos(oy + dy, 0, Math.max(0, pageRect.height - h)) + 'px';
        };
        const onUp = function () {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          if (moved) {
            self.persistPos(key, el);
          } else if (onTap) {
            onTap();
          }
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    },
    setupWidgets() {
      const self = this;
      // 软件名：把手拖动 + 点击回主页
      this.bindDrag(this.$refs.titleEl, this.$refs.titleEl.querySelector('.home-widget-grip'), 'title', function () {
        if (typeof navigateToPage === 'function') navigateToPage('home');
      });
      // 版本卡：把手拖动（内部点击留给版本选择）
      this.bindDrag(this.$refs.versionEl, this.$refs.versionEl.querySelector('.home-widget-grip'), 'version', null);
      // 启动按钮：把手拖动 + 按钮本体点击启动（拖把手不会误触启动）
      this.bindDrag(this.$refs.launchEl, this.$refs.launchEl.querySelector('.home-widget-grip'), 'launch', function () {
        if (typeof handleLaunch === 'function') handleLaunch();
      });
      // 运行卡片：把手拖动
      this.bindDrag(this.$refs.runningEl, this.$refs.runningEl.querySelector('.home-widget-grip'), 'running', null);
      // 存档坞：标题栏整条拖动（列表内交互不受影响）
      this.bindDrag(this.$refs.dockEl, this.$refs.dockEl.querySelector('.home-save-dock-header'), 'saves', null);
      // 头像：主体直接拖动 + 点击进账户 + 滚轮缩放
      this.bindDrag(this.$refs.avatarEl, null, 'avatar', function () {
        if (typeof navigateToPage === 'function') navigateToPage('accounts');
      });
      const avatarEl = this.$refs.avatarEl;
      const scaleWrap = this.$refs.avatarScale;
      if (avatarEl && scaleWrap) {
        const layout = loadHomeLayout();
        this._avatarScale = (layout.avatar && layout.avatar.s) || 1;
        scaleWrap.style.transform = 'scale(' + this._avatarScale + ')';
        avatarEl.addEventListener('wheel', function (e) {
          e.preventDefault();
          self._avatarScale = clampPos(self._avatarScale + (e.deltaY < 0 ? 0.1 : -0.1), AVATAR_MIN, AVATAR_MAX);
          scaleWrap.style.transform = 'scale(' + self._avatarScale + ')';
          self.persistPos('avatar', avatarEl);
        }, { passive: false });
      }
      // 窗口尺寸变化时把控件收回可视区域
      window.addEventListener('resize', function () { self.applyLayout(); });
    },
    // ── 存档坞 ──
    async pollVersionChange() {
      const vid = (typeof currentLaunchVersionId !== 'undefined' && currentLaunchVersionId) || '';
      if (vid !== this._lastVersionId) {
        this._lastVersionId = vid;
        this.currentVersionId = vid;
        await this.loadSaves();
      }
      // 运行卡片是 v-if 挂载的：出现后补一次位置应用
      const rEl = this.$refs.runningEl;
      if (rEl && !rEl.style.left) {
        const layout = loadHomeLayout();
        const page = this.$refs.homePage;
        const pos = layout.running || { x: 28, y: Math.max(70, page.clientHeight - rEl.offsetHeight - 24) };
        rEl.style.left = clampPos(pos.x, 0, Math.max(0, page.clientWidth - rEl.offsetWidth)) + 'px';
        rEl.style.top = clampPos(pos.y, 0, Math.max(0, page.clientHeight - rEl.offsetHeight)) + 'px';
        this.bindDrag(rEl, rEl.querySelector('.home-widget-grip'), 'running', null);
      }
    },
    async loadSaves() {
      const vid = this.currentVersionId;
      if (!vid) {
        this.saves = [];
        return;
      }
      this.savesLoading = true;
      try {
        const res = await window.bridge.invoke('version_list_saves', { versionId: vid });
        this.saves = (res && res.saves) || [];
      } catch (e) {
        console.error('[HomeSaves] Load error:', e);
        this.saves = [];
      } finally {
        this.savesLoading = false;
      }
    },
    saveIconUrl(s) {
      if (!s || !s.icon) return '';
      if (this._saveIconCache[s.folder]) return this._saveIconCache[s.folder];
      if (this._saveIconLoading[s.folder]) return '';
      this._saveIconLoading[s.folder] = true;
      const self = this;
      Promise.resolve(window.bridge && window.bridge.readFileBuffer(s.icon)).then((buffer) => {
        try {
          const u8 = typeof window.decodeFileBuffer === 'function'
            ? window.decodeFileBuffer(buffer)
            : (buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []));
          if (!u8 || u8.byteLength === 0) return;
          const blob = new Blob([u8], { type: 'image/png' });
          self._saveIconCache[s.folder] = URL.createObjectURL(blob);
        } catch (e) {}
      }).catch(() => {});
      return '';
    },
    launchSave(s) {
      const vid = this.currentVersionId;
      if (!vid) {
        showToast('请先选择游戏版本', 'warning');
        return;
      }
      if (typeof quickPlayWorld === 'undefined') {
        showToast('启动入口未就绪', 'error');
        return;
      }
      quickPlayWorld = s.folder;
      if (typeof handleLaunch === 'function') {
        handleLaunch();
      } else {
        showToast('启动入口未就绪', 'error');
      }
    },
    difficultyLabel(d) {
      return { 0: '和平', 1: '简单', 2: '普通', 3: '困难' }[d] || '未知';
    },
    // 计算运行时长（每秒由 store.now 触发重新渲染）
    formatElapsed(inst) {
      const elapsed = Math.floor(((window.VersePCGameStore.now || Date.now()) - inst.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
    },
    stopInstance(sessionId) {
      if (typeof stopGameInstance === 'function') {
        stopGameInstance(sessionId);
      }
    }
  },
  mounted() {
    const self = this;
    const init = function () {
      if (typeof loadAccounts !== 'function' || typeof loadVersions !== 'function' || typeof handleLaunch !== 'function') {
        setTimeout(init, 80);
        return;
      }
      // 刷新账户显示（含头像加载）和版本列表（含主页版本卡片渲染）
      loadAccounts().catch(function (e) { console.error('[PageHome] loadAccounts error:', e); });
      loadVersions().catch(function (e) { console.error('[PageHome] loadVersions error:', e); });
      // 拉取一次运行中游戏状态，让主页启动任务卡片尽快显示
      if (typeof updateGameStatus === 'function') {
        updateGameStatus().catch(function (e) { console.error('[PageHome] updateGameStatus error:', e); });
      }
      // 应用持久化布局 / 默认位置，并绑定拖动与缩放
      self.applyLayout();
      self.setupWidgets();
      // 存档坞：初始加载 + 轮询检测版本切换（全局变量非响应式）
      self.pollVersionChange();
      setInterval(function () { self.pollVersionChange(); }, 1200);
    };
    requestAnimationFrame(function () { setTimeout(init, 50); });
  }
};

// 导出供主入口使用
window.VersePC = window.VersePC || {};
window.VersePC.PageHome = PageHome;
