// 版本设置页概览与导出方法：脚本导出、修复、诊断、删除、整合包导出。
import { API } from '../../core/api.js';
import { showToast, showConfirmDialog } from '../../features/misc/ui-components.js';
import { showRepairModal, pollRepairProgress, showDiagnoseDialog } from '../../features/versions/version-settings.js';
import { loadVersions, renderInstalledVersionsInto } from '../../features/versions/versions-list.js';
import { appState } from '../../core/app-state.js';

export const exportMethods = {
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
    toggleExportTree(key, _expanded) {
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
};
