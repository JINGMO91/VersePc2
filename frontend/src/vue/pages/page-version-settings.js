import { API } from '../../core/api.js';
/* page-version-settings.js - 版本设置页 Vue 组件（完整数据驱动）
 * 交互逻辑全部迁入组件（data/methods/computed），卡片用 v-for/v-if 渲染。
 * class 与整体 DOM 结构保持不变，确保既有 CSS 零修改。
 * 弹窗类流程（文件修复/诊断/模组汉化/模组更新）仍复用全局函数。
 */
import { bridge } from '../../core/tauri-bridge.js';
import { decodeFileBuffer } from '../../core/utils.js';

import { toggleMod } from '../../features/accounts/accounts.js';
import { handleLaunch, detectJava } from '../../features/launch/launch.js';
import { setCustomSelectValue, CustomSelect, customSelectInstances } from '../../features/misc/custom-select.js';
import { showToast, showConfirmDialog } from '../../features/misc/ui-components.js';
import { loadMods } from '../../features/mods/mod-browse.js';
import { openModDetail } from '../../features/mods/mod-detail.js';
import { loadSettings } from '../../features/settings/settings-load-save.js';
import { isPinned } from '../../features/versions/pinned-store.js';
import { openVersionFolder, openSavesFolder, openModsFolder, showModUpdateDialog, exportLaunchScript, showRepairModal, pollRepairProgress, repairFiles, diagnoseVersion, showDiagnoseDialog, deleteCurrentVersion, previewMod, installModFromFile, installModByFile, goDownloadMods, toggleExportTree, startExport, openModTranslateDialog } from '../../features/versions/version-settings.js';
import { loadVersions, updateVersionSelects, renderInstalledVersionsInto, navigateToPage } from '../../features/versions/versions.js';

import { appState } from '../../core/app-state.js';
import { formatModNameWithChinese } from '../../features/mods/chinese-names.js';
import { isPinned as isPinnedItem, PIN_ICONS, togglePinSave } from '../../features/versions/pinned-store.js';
import { vmHolders } from '../../core/vm-holders.js';
import { VERSION_SETTINGS_TEMPLATE } from './version-settings-template.js';
import VButton from '@/components/verse/VButton.vue';
import VInput from '@/components/verse/VInput.vue';
import VTextarea from '@/components/verse/VTextarea.vue';

const PageVersionSettings = {
  name: 'PageVersionSettings',
  // 模板里的通用控件使用 components/verse 语义层组件，此处统一注册
  components: { VButton, VInput, VTextarea },
  data() {
    return {
      versionId: null,
      title: '版本设置',
      // 版本信息
      customName: '',
      description: '',
      // 设置卡片
      isolation: 'global',
      windowTitle: '',
      customInfo: '',
      javaPath: 'global',
      javaOptions: [
        { value: 'global', text: '跟随全局设置' },
        { value: 'detect', text: '加载中...' }
      ],
      memoryMode: 'global',
      memoryValue: 4096,
      memOptimize: 'global',
      jvmArgs: '',
      gameArgs: '',
      usedMemory: '--',
      gameMemory: '--',
      // 外部版本提示
      isExternal: false,
      externalPath: '',
      // 面板
      activeTab: 'overview',
      // 模组卡片
      mods: [],
      modsLoading: false,
      modSearch: '',
      isVanilla: false,
      modsLoaded: false,
      // 存档卡片
      saves: [],
      savesLoading: false,
      savesLoaded: false,
      saveEditing: null,
      ruleDefs: {
        keepInventory: { label: '保留物品栏', def: false },
        doDaylightCycle: { label: '昼夜循环', def: true },
        doWeatherCycle: { label: '天气循环', def: true },
        doMobSpawning: { label: '生物生成', def: true },
        doMobLoot: { label: '生物掉落', def: true },
        doTileDrops: { label: '方块掉落', def: true },
        doEntityDrops: { label: '实体掉落', def: true },
        mobGriefing: { label: '生物破坏地形', def: true },
        naturalRegeneration: { label: '自然回血', def: true },
        doFireTick: { label: '火焰蔓延', def: true },
        pvp: { label: 'PVP 伤害', def: true },
        showCoordinates: { label: '显示坐标', def: false },
        commandBlockOutput: { label: '命令方块输出', def: true },
        randomTickSpeed: { label: '随机刻速度', def: '3' }
      },
      _saveIconCache: {},
      _saveIconLoading: {},
      // 导出卡片
      exportName: '',
      exportVersion: '1.0.0',
      exportAuthor: '',
      exportDescription: '',
      exportGameDesc: '正式版',
      exportModCount: '0 个',
      exportSavesCount: '',
      exportResourcePacks: [],
      exportSaves: [],
      exportSavesMore: 0,
      exportKeys: [],
      exportLoaded: false,
      exportTrees: {
        game: true, mods: true, resourcepacks: true, saves: true
      },
      // 其它
      checkingUpdates: false,
      repairSessionId: null,
      _memDisplayTimer: null
    };
  },
  computed: {
    displayName() {
      return this.customName || this.versionId || '';
    },
    memoryDisplayText() {
      return this.memoryValue + ' MB';
    },
    filteredMods() {
      const kw = (this.modSearch || '').toLowerCase();
      if (!kw) return this.mods;
      return this.mods.filter(m => {
        const name = (m.name || '').toLowerCase();
        const desc = (m.description || '').toLowerCase();
        return name.includes(kw) || desc.includes(kw);
      });
    },
    vanishPromptShown() {
      return this.activeTab === 'modmgr' && this.isVanilla;
    },
    boolRuleDefs() {
      const out = {};
      Object.keys(this.ruleDefs).forEach(k => {
        if (k !== 'randomTickSpeed') out[k] = this.ruleDefs[k];
      });
      return out;
    }
  },
  watch: {
    activeTab(val) {
      if (val === 'modmgr' && !this.isVanilla && !this.modsLoaded) {
        this.loadMods();
      } else if (val === 'export' && !this.exportLoaded) {
        this.loadExportTree();
      } else if (val === 'saves' && !this.savesLoaded) {
        this.loadSaves();
      }
    }
  },
  mounted() {
    vmHolders.versionSettings = this;
    this.initCustomSelects();
  },
  methods: {
    // ===== 打开 / 关闭 =====
    async openFor(versionId, versionName) {
      this.versionId = versionId;
      this.modsLoaded = false;
      this.exportLoaded = false;
      this.versionId = versionId;
      const versionInfo = (typeof appState.installedVersions !== 'undefined' && appState.installedVersions || []).find(v => v.id === versionId);
      this.customName = (versionInfo && versionInfo.customName) || versionName || versionId;
      this.exportName = this.customName;
      this.isExternal = !!(versionInfo && versionInfo.isExternal);
      this.externalPath = (versionInfo && versionInfo.externalPath) || '';
      this.title = '版本设置 - ' + this.customName;
      this.activeTab = 'overview';

      API.saveSetting('selectedVersion', versionId).catch(e => {
        console.error('[VersionSettings] Failed to set selectedVersion:', e);
      });

      navigateToPage('version-settings');
      document.querySelector('.content-area').classList.add('no-scroll');
      this.loadSettings();
    },
    close() {
      if (typeof appState._modDownloadVersionId !== 'undefined') appState._modDownloadVersionId = '';
      const ca = document.querySelector('.content-area');
      if (ca) ca.classList.remove('no-scroll');
      navigateToPage((typeof appState.previousPage !== 'undefined' && appState.previousPage) || 'home');
      this.versionId = null;
    },
    // ===== 设置加载 / 保存 =====
    async loadSettings() {
      if (!this.versionId) return;
      try {
        const settings = await API.getVersionSettings(this.versionId);
        const s = settings || {};
        this.customName = s.customName || this.customName;
        this.description = s.description || '';
        this.windowTitle = s.windowTitle || '';
        this.customInfo = s.customInfo || '';
        this.isolation = s.isolation || (this.isExternal ? 'on' : 'global');
        this.jvmArgs = s.jvmArgs || '';
        this.gameArgs = s.gameArgs || '';
        this.memoryMode = s.memoryMode || 'global';
        this.memoryValue = s.memoryValue || 4096;
        this.memOptimize = s.memOptimize || 'global';
        this.javaPath = s.javaPath || 'global';
        this.title = '版本设置 - ' + (this.customName || this.versionId);
        this.exportName = this.customName || this.versionId;

        this.refreshJavaOptions(this.javaPath);
        this.syncCustomSelects();
        this.refreshMemoryUsage();
      } catch (e) {
        console.error('[VersionSettings] Load settings error:', e);
      }
    },
    saveSetting(key, value) {
      if (!this.versionId) return;
      const data = { versionId: this.versionId, [key]: value };
      API.saveVersionSettings(data).then(r => {
        if (!r.success) console.warn('[VersionSettings] Save failed for', key);
      }).catch(e => console.error('[VersionSettings] Save error:', e));
    },
    onCustomNameInput() {
      this.title = '版本设置 - ' + (this.customName || this.versionId);
      if (typeof appState.installedVersions !== 'undefined' && appState.installedVersions) {
        const vInfo = appState.installedVersions.find(v => v.id === this.versionId);
        if (vInfo) vInfo.customName = this.customName;
        try { updateVersionSelects(); } catch (e) {}
      }
      this.exportName = this.customName;
    },
    // ===== Java =====
    async refreshJavaOptions(selectValue) {
      try {
        const javaData = await API.getInstalledJava();
        const javaList = (javaData && javaData.java) || [];
        this.javaOptions = [
          { value: 'global', text: '跟随全局设置' },
          ...javaList.map(j => ({
            value: j.path || j.executable || '',
            text: `${j.version || j.name || 'Java'}${j.arch ? ' (' + j.arch + ')' : ''}${j.majorVersion ? ' [' + j.majorVersion + ']' : ''}`
          }))
        ];
        this.javaPath = selectValue || 'global';
        this.setCustomSelectValue('vset-java', this.javaPath);
      } catch (e) {
        console.error('[VersionSettings] Refresh Java options error:', e);
      }
    },
    async detectJava() {
      if (!this.versionId) return;
      showToast('正在搜索 Java...', 'info');
      try {
        const result = await API.detectJava();
        if (result.javaList && result.javaList.length > 0) {
          const best = result.javaList.find(j => j.majorVersion >= 17) || result.javaList[0];
          await this.refreshJavaOptions(best.path);
          this.saveSetting('javaPath', best.path);
          showToast(`已找到 Java ${best.version}，已自动选中`, 'success');
        } else {
          showToast('未检测到 Java，请尝试手动导入', 'warning');
        }
      } catch (e) {
        showToast('Java 搜索失败', 'error');
      }
    },
    async browseJava() {
      if (!this.versionId) return;
      if (bridge && bridge.showOpenDialog) {
        try {
          const result = await bridge.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Java 可执行文件', extensions: ['exe', ''] }]
          });
          if (!result.canceled && result.filePaths.length > 0) {
            const javaPath = result.filePaths[0];
            await this.refreshJavaOptions(javaPath);
            this.saveSetting('javaPath', javaPath);
            showToast('已导入 Java，已自动选中', 'success');
          }
        } catch (e) {
          showToast('导入失败', 'error');
        }
      } else {
        showToast('请手动输入 Java 路径', 'info');
      }
    },
    // ===== CustomSelect 下拉（集成既有组件）=====
    initCustomSelects() {
      const self = this;
      if (typeof CustomSelect === 'undefined') return;
      if (typeof customSelectInstances !== 'undefined') {
        // java
        if (!customSelectInstances['vset-java'] && document.getElementById('vset-java-wrapper')) {
          customSelectInstances['vset-java'] = new CustomSelect('vset-java-wrapper', {
            onChange: (value) => { self.javaPath = value; self.saveSetting('javaPath', value); }
          });
        }
        // mem-optimize
        if (!customSelectInstances['vset-mem-optimize'] && document.getElementById('vset-mem-optimize-wrapper')) {
          customSelectInstances['vset-mem-optimize'] = new CustomSelect('vset-mem-optimize-wrapper', {
            onChange: (value) => { self.memOptimize = value; self.saveSetting('memOptimize', value); }
          });
        }
      }
    },
    syncCustomSelects() {
      this.setCustomSelectValue('vset-java', this.javaPath);
      this.setCustomSelectValue('vset-mem-optimize', this.memOptimize);
    },
    setCustomSelectValue(key, value) {
      if (typeof customSelectInstances === 'undefined') return;
      const inst = customSelectInstances[key];
      if (inst && typeof inst.setValue === 'function') {
        try { inst.setValue(value); } catch (e) {}
      }
    },
    // ===== 快捷入口 =====
    openVersionFolder() {
      if (this.versionId) API.openVersionFolder(this.versionId, 'version');
    },
    openSavesFolder() {
      if (this.versionId) API.openVersionFolder(this.versionId, 'saves');
    },
    openModsFolder() {
      if (this.versionId) API.openVersionFolder(this.versionId, 'mods');
    },
    // ===== 模组卡片 =====
    async loadMods() {
      if (!this.versionId) return;
      this.modsLoading = true;
      this.mods = [];
      try {
        const mods = await API.getVersionMods(this.versionId);
        this.mods = (mods && Array.isArray(mods)) ? mods : [];
        this.mods.forEach(m => { m.iconHtml = (m.icon && !String(m.icon).startsWith('/api/')) ? m.icon : ''; m.iconDataUrl = ''; });
        this.modsLoaded = true;
      } catch (e) {
        console.error('[ModMgr] Load error:', e);
      } finally {
        this.modsLoading = false;
      }
    },
    loadIcon(mod) {
      if (mod.iconHtml || mod.iconDataUrl) return;
      const iconUrl = mod.icon || '';
      const isApi = String(iconUrl).startsWith('/api/');
      if (!isApi) return;
      const mm = iconUrl.match(/hash=([^&]+)/);
      const hash = mm ? decodeURIComponent(mm[1]) : '';
      if (!hash) return;
      API.getModIcon(hash).then(r => {
        if (r && r.dataUrl) {
          mod.iconDataUrl = r.dataUrl;
        }
      }).catch(() => {});
    },
    switchTab(tabName) {
      this.activeTab = tabName;
    },
    formatModName(m) {
      try { return formatModNameWithChinese(m.slug || m.id || m.fileName, m.name); }
      catch (e) { return m.name || m.fileName || ''; }
    },
    previewMod(projectId) {
      if (!projectId) return;
      try { openModDetail(projectId, 'modrinth'); } catch (e) {}
    },
    openTranslate(mod) {
      try { openModTranslateDialog(mod.fileName || mod.name, mod.name || mod.fileName); } catch (e) {}
    },
    toggleMod(mod) {
      if (!this.versionId) return;
      const fileName = mod.fileName || mod.name;
      const disable = !!(mod && mod.disabled);
      API.toggleMod(fileName, !disable, this.versionId).then(r => {
        if (r.success) {
          showToast(disable ? '已禁用' : '已启用', 'success');
          this.loadMods();
        } else {
          showToast(r.error || '操作失败', 'error');
        }
      }).catch(e => showToast(e.message || '操作失败', 'error'));
    },
    async removeMod(mod) {
      if (!this.versionId) return;
      const fileName = mod.fileName || mod.name;
      const confirmed = await showConfirmDialog('删除模组', `确定要删除 ${fileName} 吗？`, '删除', '取消');
      if (!confirmed) return;
      API.removeMod(this.versionId, fileName).then(r => {
        if (r.success) {
          showToast('已删除', 'success');
          this.loadMods();
        } else {
          showToast(r.error || '删除失败', 'error');
        }
      });
    },
    installModFromFile() {
      showToast('请选择要安装的 Mod 文件（.jar）', 'info');
      API.selectModFile().then(result => {
        if (result && result.filePath) this.installModByFile(result.filePath);
      });
    },
    installModByFile(filePath) {
      if (!this.versionId) {
        showToast('请先选择一个版本', 'error');
        return;
      }
      API.installModFromFile(this.versionId, filePath).then(r => {
        if (r.success) {
          showToast('Mod 安装成功', 'success');
          this.loadMods();
        } else {
          showToast(r.error || '安装失败', 'error');
        }
      }).catch(e => showToast('安装失败: ' + e.message, 'error'));
    },
    goDownloadMods() {
      if (typeof appState._modDownloadVersionId !== 'undefined') appState._modDownloadVersionId = this.versionId || '';
      const versionInfo = this.versionId && (typeof appState.installedVersions !== 'undefined' && appState.installedVersions || []).find(v => v.id === this.versionId);
      let gameVersion = '';
      if (versionInfo && versionInfo.baseVersion) gameVersion = versionInfo.baseVersion;
      else if (versionInfo && versionInfo.inheritsFrom) gameVersion = versionInfo.inheritsFrom;
      else gameVersion = this.versionId ? this.versionId.split('-')[0] : '';
      let loaderType = '';
      if (versionInfo) {
        if (versionInfo.isFabric) loaderType = 'fabric';
        else if (versionInfo.isForge) loaderType = 'forge';
        else if (versionInfo.isNeoForge) loaderType = 'neoforge';
      }
      navigateToPage('mods');
      setTimeout(() => {
        if (gameVersion && typeof customSelectInstances !== 'undefined' && customSelectInstances['mod-filter-version']) {
          customSelectInstances['mod-filter-version'].setValue(gameVersion);
        }
        if (loaderType && typeof customSelectInstances !== 'undefined' && customSelectInstances['mod-filter-loader']) {
          customSelectInstances['mod-filter-loader'].setValue(loaderType);
        }
        if (typeof appState.modSearchOffset !== 'undefined') appState.modSearchOffset = 0;
        try { if (typeof loadMods === 'function') loadMods(); } catch (e) {}
      }, 100);
    },
    // ===== 概览卡片：脚本导出 / 文件修复 / 诊断 / 删除 =====
    exportLaunchScript() {
      if (!this.versionId) return;
      API.exportLaunchScript(this.versionId).then(r => {
        if (r.success) showToast('启动脚本已导出', 'success');
        else showToast(r.error || '导出失败', 'error');
      });
    },
    async repairFiles() {
      if (!this.versionId) return;
      try { showRepairModal(this.versionId); } catch (e) {}
      try {
        const result = await API.repairStart(this.versionId);
        if (result.success && result.sessionId) {
          this.repairSessionId = result.sessionId;
          pollRepairProgress(result.sessionId);
        } else {
          try {
            document.getElementById('repair-stage').textContent = '启动失败';
            document.getElementById('repair-message').textContent = result.error || '无法启动修复';
            document.getElementById('repair-cancel-btn').style.display = 'none';
          } catch (e) {}
          showToast(result.error || '启动修复失败', 'error');
        }
      } catch (e) {
        try {
          document.getElementById('repair-stage').textContent = '启动失败';
          document.getElementById('repair-message').textContent = '网络错误，请重试';
          document.getElementById('repair-cancel-btn').style.display = 'none';
        } catch (err) {}
        showToast('启动修复失败: ' + e.message, 'error');
      }
    },
    async diagnoseVersion() {
      if (!this.versionId) {
        showToast('请先选择一个游戏版本', 'error');
        return;
      }
      try {
        const result = await API.diagnoseVersion(this.versionId);
        if (typeof showDiagnoseDialog === 'function') showDiagnoseDialog(result);
        else showToast('诊断完成', 'info');
      } catch (e) {
        showToast('诊断失败: ' + e.message, 'error');
      }
    },
    async deleteCurrentVersion() {
      if (!this.versionId) {
        showToast('未找到版本信息', 'error');
        return;
      }
      const isExternal = String(this.versionId).includes(' [外部');
      if (isExternal) {
        const confirmed = await showConfirmDialog('移除外部版本', '确定要从列表中移除此外部版本吗？（不会删除实际游戏文件）', '移除', '取消');
        if (!confirmed) return;
      } else {
        const ver = (typeof appState.installedVersions !== 'undefined' && appState.installedVersions || []).find(v => v.id === this.versionId);
        let warningParts = [];
        if (ver && ver.hasMods) warningParts.push('模组');
        if (ver && ver.hasSaves) warningParts.push('存档');
        if (ver && ver.hasResourcepacks) warningParts.push('资源包');
        let confirmMsg = `确定要删除版本 ${this.versionId} 吗？此操作不可撤销！`;
        let chainInfo = '';
        try {
          const chainResult = await API.getDeleteChain(this.versionId);
          if (chainResult.success && chainResult.willDelete && chainResult.willDelete.length > 1) {
            const otherVersions = chainResult.willDelete.filter(id => id !== this.versionId);
            if (otherVersions.length > 0) {
              chainInfo = `\n\n同时将删除关联版本：\n${otherVersions.map(id => '• ' + id).join('\n')}`;
            }
          }
        } catch (e) {}
        if (warningParts.length > 0) {
          confirmMsg += `\n\n⚠ 由于该版本开启了版本隔离，删除版本时该版本对应的${warningParts.join('、')}等文件也将被一并删除！`;
        }
        if (chainInfo) confirmMsg += chainInfo;
        const confirmed = await showConfirmDialog('版本删除确认', confirmMsg, '删除', '取消');
        if (!confirmed) return;
      }
      const deletedVersionId = this.versionId;
      try {
        const r = await API.deleteVersion(deletedVersionId);
        if (r.success) {
          const deletedNames = r.deleted ? r.deleted.join('、') : deletedVersionId;
          showToast(`版本 ${deletedNames} 已删除`, 'success');
          this.close();
          if (typeof loadVersions === 'function') await loadVersions(true);
          const installedContainer = document.getElementById('installed-versions-list');
          if (installedContainer && typeof renderInstalledVersionsInto === 'function') renderInstalledVersionsInto(installedContainer);
        } else {
          showToast(r.error || '删除失败', 'error');
        }
      } catch (e) {
        showToast('删除失败', 'error');
      }
    },
    // ===== 模组更新（弹窗，复用全局）=====
    async checkModUpdates() {
      if (!this.versionId) {
        showToast('请先选择一个版本', 'error');
        return;
      }
      if (this.checkingUpdates) {
        showToast('正在检查更新，请稍候...', 'info');
        return;
      }
      this.checkingUpdates = true;
      showToast('正在检查模组更新...', 'info');
      try {
        const result = await API.checkModUpdates(this.versionId);
        if (result.error) {
          showToast('检查更新失败: ' + result.error, 'error');
          return;
        }
        const updates = result.updates || [];
        if (updates.length === 0) {
          showToast(`已检查 ${result.checked || 0} 个模组，暂无更新`, 'success');
          return;
        }
        try { showModUpdateDialog(updates, result.checked || 0); } catch (e) {}
      } catch (e) {
        showToast('检查更新失败: ' + (e.message || '未知错误'), 'error');
      } finally {
        this.checkingUpdates = false;
      }
    },
    // ===== 导出卡片 =====
    async loadExportTree() {
      if (!this.versionId) return;
      try {
        const data = await API.getVersionExportInfo(this.versionId);
        this.exportLoaded = true;
        if (data.gameDesc) this.exportGameDesc = data.gameDesc;
        if (data.modCount !== undefined) this.exportModCount = `${data.modCount} 个`;
        if (data.savesCount !== undefined) this.exportSavesCount = `${data.savesCount} 个存档`;
        this.exportResourcePacks = (data.resourcePacks && data.resourcePacks.length) ? data.resourcePacks : [];
        this.exportSaves = (data.saves && data.saves.length) ? data.saves.slice(0, 10) : [];
        this.exportSavesMore = (data.saves && data.saves.length > 10) ? data.saves.length - 10 : 0;
      } catch (e) {
        console.error('[Export] Load tree data error:', e);
      }
    },
    toggleExportTree(key, expanded) {
      const cur = this.exportTrees[key];
      this.exportTrees = { ...this.exportTrees, [key]: cur ? false : true };
    },
    toggleExportKey(key) {
      const i = this.exportKeys.indexOf(key);
      if (i >= 0) this.exportKeys.splice(i, 1);
      else this.exportKeys.push(key);
    },
    startExport() {
      if (!this.versionId) return;
      const name = (this.exportName || '').trim();
      if (!name) { showToast('请输入整合包名称', 'error'); return; }
      const version = this.exportVersion || '1.0.0';
      const author = this.exportAuthor || '';
      const description = this.exportDescription || '';
      showToast('正在导出整合包...', 'info');
      API.exportModpack(this.versionId, name, version, author, description, this.exportKeys).then(r => {
        if (r.success) showToast(`整合包已导出到 ${r.path}`, 'success');
        else showToast(r.error || '导出失败', 'error');
      }).catch(e => showToast('导出失败: ' + (e.message || ''), 'error'));
    },
    // ===== 内存 =====
    refreshMemoryUsage() {
      try {
        API.getSystemMemory().then(info => {
          if (info && info.usedMB !== undefined) {
            this.usedMemory = info.usedMB + ' MB';
            if (info.autoMB !== undefined) {
              this.gameMemory = Math.min(this.memoryValue, info.autoMB) + ' MB';
            }
          }
        }).catch(() => {});
      } catch (e) {}
    },
    // ===== 存档管理 =====
    async loadSaves() {
      if (!this.versionId) return;
      this.savesLoading = true;
      try {
        const res = await bridge.invoke('version_list_saves', { versionId: this.versionId });
        this.saves = (res && res.saves) || [];
        this.savesLoaded = true;
      } catch (e) {
        console.error('[Saves] Load error:', e);
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
      Promise.resolve(bridge && bridge.readFileBuffer(s.icon)).then((buffer) => {
        try {
          const u8 = typeof decodeFileBuffer === 'function'
            ? decodeFileBuffer(buffer)
            : (buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []));
          if (!u8 || u8.byteLength === 0) return;
          const blob = new Blob([u8], { type: 'image/png' });
          self._saveIconCache[s.folder] = URL.createObjectURL(blob);
        } catch (e) {}
      }).catch(() => {});
      return '';
    },
    openSaveEditor(s) {
      const rules = {};
      Object.keys(this.ruleDefs).forEach(k => {
        rules[k] = (s.rules && s.rules[k] !== undefined) ? s.rules[k] : String(this.ruleDefs[k].def);
      });
      this.saveEditing = {
        folder: s.folder,
        name: s.name,
        difficulty: (typeof s.difficulty === 'number') ? s.difficulty : 2,
        rules: rules
      };
    },
    closeSaveEditor() {
      this.saveEditing = null;
    },
    ruleBool(rules, key) {
      return String(rules[key]) === 'true';
    },
    toggleRule(rules, key) {
      rules[key] = String(rules[key]) === 'true' ? 'false' : 'true';
    },
    async saveSaveEdit() {
      const ed = this.saveEditing;
      if (!ed) return;
      const changed = {};
      Object.keys(this.ruleDefs).forEach(k => {
        if (ed.rules[k] !== undefined) changed[k] = ed.rules[k];
      });
      try {
        const res = await bridge.invoke('version_save_update', {
          versionId: this.versionId,
          folder: ed.folder,
          displayName: ed.name,
          difficulty: ed.difficulty,
          rules: changed
        });
        if (res && res.success) {
          showToast('存档已保存', 'success');
          this.closeSaveEditor();
          this.loadSaves();
        } else {
          showToast((res && res.error) || '保存失败', 'error');
        }
      } catch (e) {
        showToast('保存失败: ' + (e && e.message ? e.message : String(e)), 'error');
      }
    },
    launchSave(s) {
      if (!this.versionId) return;
      // 让启动流程以当前配置的版本为准，并带上世界名直接进存档
      if (typeof appState.currentLaunchVersionId !== 'undefined') appState.currentLaunchVersionId = this.versionId;
      if (typeof appState.quickPlayWorld === 'undefined') {
        showToast('启动入口未就绪', 'error');
        return;
      }
      appState.quickPlayWorld = s.folder;
      if (typeof handleLaunch === 'function') {
        handleLaunch();
      } else {
        showToast('启动入口未就绪', 'error');
      }
    },
    isPinned(type, id) {
      return isPinnedItem(type, id);
    },
    ic(name) {
      return PIN_ICONS[name] || '';
    },
    pinSave(s) {
      togglePinSave(s.folder, s.name, this.versionId, s.icon || '', s.difficulty);
    },
    difficultyLabel(d) {
      return { 0: '和平', 1: '简单', 2: '普通', 3: '困难' }[d] || '未知';
    },
    lastPlayedText(ms) {
      if (!ms) return '从未游玩';
      const d = new Date(ms);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  },
  template: VERSION_SETTINGS_TEMPLATE,
};

// 外部入口由 features/versions/version-settings.js 通过 vmHolders.versionSettings 调用本组件

export default PageVersionSettings;
