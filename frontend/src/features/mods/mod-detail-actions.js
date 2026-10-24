// mod-detail-actions.js — data-action 注册
import { registerActions as registerActions } from '../../core/actions.js';
import { addModFromDetail as addModFromDetail, installModpackVersion as installModpackVersion, installModFile as installModFile, quickInstallResourceVersion as quickInstallResourceVersion, toggleMdvGroup as toggleMdvGroup, installModpackVersionSafe as installModpackVersionSafe, installModFileSafe as installModFileSafe, installResourceVersionSafe as installResourceVersionSafe } from './mod-install.js';
import { openGalleryLightbox } from './mod-detail-images.js';
import { openModDetail } from './mod-detail-header.js';
import { switchMdVersionTab, renderMdVersionListMore } from './mod-detail-versions.js';

registerActions({
  openModDetail: (event, el, projectId, source) => openModDetail(projectId, source),
  openGalleryLightbox: (event, el, idx) => openGalleryLightbox(idx),
  switchMdVersionTab: (event, el, ver, mode) => switchMdVersionTab(ver, mode),
  addModFromDetail: (event, el, projectId, source, safeVid, safeFid) => addModFromDetail(projectId, source, safeVid, safeFid),
  installModpackVersion: (event, el, projectId, versionId) => installModpackVersion(projectId, versionId),
  installModFile: (event, el, projectId, source, versionId, fileId) => installModFile(projectId, source, versionId, fileId),
  quickInstallResourceVersion: (event, el, projectId, type, versionId) => quickInstallResourceVersion(projectId, type, versionId),
  toggleMdvGroup: (event, el, idx) => toggleMdvGroup(idx),
  installModpackVersionRow: (event, el) => installModpackVersionSafe(el.closest('.mdv-file-item')),
  installModFileRow: (event, el) => installModFileSafe(el.closest('.mdv-file-item')),
  installResourceVersionRow: (event, el) => installResourceVersionSafe(el.closest('.mdv-file-item')),
  renderMdVersionListMore,
});
