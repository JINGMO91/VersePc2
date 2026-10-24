// 版本设置页模组方法：模组卡片、加载/启停/删除、从文件安装、去下载与更新检查。
import { API } from '../../core/api.js';
import { showToast, showConfirmDialog } from '../../features/misc/ui-components.js';
import { loadMods as loadModBrowse } from '../../features/mods/mod-browse.js';
import { openModDetail } from '../../features/mods/mod-detail.js';
import { openModTranslateDialog, showModUpdateDialog } from '../../features/versions/version-settings.js';
import { formatModNameWithChinese } from '../../features/mods/chinese-names.js';
import { navigateToPage } from '../../core/navigation.js';
import { appState } from '../../core/app-state.js';
import { customSelectInstances } from '../../features/misc/custom-select.js';

export const modMethods = {
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
        try { if (typeof loadModBrowse === 'function') loadModBrowse(); } catch (e) {}
      }, 100);
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
};
