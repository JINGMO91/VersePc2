// 模组详情使用的已安装版本信息：独立成模块，避免详情头部与依赖列表互相依赖。
import { API } from '../../core/api.js';
import { appState } from '../../core/app-state.js';
import { ensureInstalledVersions } from './install-target.js';

export async function getInstalledVersionInfo() {
  try {
    // 直接从模组页进入时 appState.installedVersions 可能尚未填充，先确保加载
    await ensureInstalledVersions();
    const settings = await API.getSettings().catch(() => ({}));
    const selectedVersion = settings.selectedVersion || '';
    if (!selectedVersion) return { gameVersion: '', loaderType: '', versionId: '' };

    const versionInfo = appState.installedVersions.find(v => v.id === selectedVersion);
    let gameVersion = '';
    if (versionInfo && versionInfo.baseVersion) {
      gameVersion = versionInfo.baseVersion;
    } else if (versionInfo && versionInfo.inheritsFrom) {
      gameVersion = versionInfo.inheritsFrom;
    } else {
      gameVersion = selectedVersion.split('-')[0];
    }

    let loaderType = '';
    if (versionInfo) {
      if (versionInfo.isFabric) loaderType = 'fabric';
      else if (versionInfo.isForge) loaderType = 'forge';
      else if (versionInfo.isNeoForge) loaderType = 'neoforge';
    }

    return { gameVersion, loaderType, versionId: selectedVersion };
  } catch (e) {
    return { gameVersion: '', loaderType: '', versionId: '' };
  }
}
