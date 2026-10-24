// versions-delete.js — 删除版本
import { API as API } from '../../core/api.js';
import { showToast as showToast, showConfirmDialog as showConfirmDialog } from '../misc/ui-components.js';
import { appState as appState } from '../../core/app-state.js';
import { versionsState as S } from './versions-state.js';
import { loadVersions, renderInstalledVersionsInto } from './versions-list.js';

async function deleteVersion(versionId) {
  const isExternal = versionId.includes(' [外部');
  const ver = appState.installedVersions.find(v => v.id === versionId);
  const isPermanent = !isExternal && S._shiftKeyDown;
  let warningParts = [];
  if (ver?.hasMods) warningParts.push('模组');
  if (ver?.hasSaves) warningParts.push('存档');
  if (ver?.hasResourcepacks) warningParts.push('资源包');
  let confirmMsg = isExternal
    ? `确定要从列表中移除 ${versionId} 吗？\n（不会删除实际游戏文件）`
    : isPermanent
      ? `确定要永久删除版本 ${versionId} 吗？\n（无法恢复）`
      : `确定要删除版本 ${versionId} 吗？\n（将移入回收站）`;

  if (warningParts.length > 0) {
    confirmMsg += `\n\n⚠ 由于该版本开启了版本隔离，删除版本时该版本对应的${warningParts.join('、')}等文件也将被一并删除！`;
  }

  const confirmed = await showConfirmDialog(isExternal ? '移除外部版本' : isPermanent ? '永久删除' : '版本删除确认', confirmMsg, isExternal ? '移除' : isPermanent ? '永久删除' : '删除', '取消');
  if (!confirmed) return;
  try {
    const r = await API.deleteVersion(versionId, isPermanent);
    if (r.success) {
      showToast(`版本 ${versionId} 已${isPermanent ? '永久删除' : '删除'}`, 'success');
      await loadVersions(true);
      const installedContainer = document.getElementById('installed-versions-list');
      if (installedContainer) renderInstalledVersionsInto(installedContainer);
    } else {
      showToast(r.error || '删除失败', 'error');
    }
  } catch (e) { showToast('删除失败', 'error'); }
}

export { deleteVersion };
