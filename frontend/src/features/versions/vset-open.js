import { API as API } from '../../core/api.js';
import { bridge as bridge } from '../../core/tauri-bridge.js';
import { CustomSelect as CustomSelect, customSelectInstances as customSelectInstances } from '../misc/custom-select.js';
import { showToast as showToast } from '../misc/ui-components.js';
import { updateVersionSelects as updateVersionSelects, navigateToPage as navigateToPage } from './versions.js';
import { appState as appState } from '../../core/app-state.js';
import { vmHolders as vmHolders } from '../../core/vm-holders.js';
import { S } from './vset-state.js';
import { loadInstalledModsForSettings } from './vset-mods.js';
import { loadExportTreeData } from './vset-export.js';

function openVersionSettings(versionId, versionName) {
  appState.currentSettingsVersionId = versionId;
  S._modMgrSettingsLoaded = false;
  S._exportTreeLoaded = false;
  const vm = vmHolders.versionSettings;
  if (vm && typeof vm.openFor === 'function') {
    return vm.openFor(versionId, versionName);
  }
  // 页面组件尚未挂载时等待挂载完成
  return new Promise((resolve) => {
    let tries = 0;
    const timer = setInterval(() => {
      const target = vmHolders.versionSettings;
      if (target && typeof target.openFor === 'function') {
        clearInterval(timer);
        target.openFor(versionId, versionName);
        resolve();
      } else if (++tries > 100) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

async function loadVersionSettingsUI() {
  if (!appState.currentSettingsVersionId) return;
  try {
    const settings = await API.getVersionSettings(appState.currentSettingsVersionId);
    S.currentVersionSettings = settings;

    const customNameInput = document.getElementById('vset-custom-name');
    if (customNameInput) customNameInput.value = settings.customName || '';

    const descriptionInput = document.getElementById('vset-description');
    if (descriptionInput) descriptionInput.value = settings.description || '';

    const isolationSelect = document.getElementById('vset-isolation');
    if (isolationSelect) {
      const versionInfo = appState.installedVersions.find(v => v.id === appState.currentSettingsVersionId);
      const isExternal = versionInfo && versionInfo.isExternal;
      isolationSelect.value = settings.isolation || (isExternal ? 'on' : 'global');
    }

    const windowTitle = document.getElementById('vset-window-title');
    if (windowTitle) windowTitle.value = settings.windowTitle || '';

    const customInfo = document.getElementById('vset-custom-info');
    if (customInfo) customInfo.value = settings.customInfo || '';

    if (document.getElementById('vset-java-wrapper') || customSelectInstances['vset-java']) {
      await refreshVsetJavaOptions(settings.javaPath || 'global');
    }

    const memoryMode = document.querySelector(`input[name="vsetMemoryMode"][value="${settings.memoryMode || 'global'}"]`);
    if (memoryMode) memoryMode.checked = true;

    const memoryCustom = document.getElementById('vset-memory-custom');
    if (memoryCustom) memoryCustom.style.display = settings.memoryMode === 'custom' ? 'block' : 'none';

    const memoryValue = document.getElementById('vset-memory-value');
    if (memoryValue) memoryValue.value = settings.memoryValue || 4096;

    const memoryDisplay = document.getElementById('vset-memory-display');
    if (memoryDisplay) memoryDisplay.textContent = (settings.memoryValue || 4096) + ' MB';

    const memOptimize = document.getElementById('vset-mem-optimize');
    if (memOptimize) memOptimize.value = settings.memOptimize || 'global';

    const jvmArgsInput = document.getElementById('vset-jvm-args');
    if (jvmArgsInput) jvmArgsInput.value = settings.jvmArgs || '';

    const gameArgsInput = document.getElementById('vset-game-args');
    if (gameArgsInput) gameArgsInput.value = settings.gameArgs || '';

  } catch (e) {
    console.error('[VersionSettings] Load settings error:', e);
  }
}

function saveCurrentVersionSetting(key, value) {
  if (!appState.currentSettingsVersionId) return;
  const data = { versionId: appState.currentSettingsVersionId, [key]: value };
  API.saveVersionSettings(data).then(r => {
    if (r.success) {
      if (S.currentVersionSettings) S.currentVersionSettings[key] = value;
    }
  }).catch(e => console.error('[VersionSettings] Save error:', e));
}

async function refreshVsetJavaOptions(selectValue) {
  try {
    const javaData = await API.getInstalledJava();
    const javaList = javaData.java || [];
    const options = [
      { value: 'global', text: '跟随全局设置' },
      ...javaList.map(j => ({
        value: j.path || j.executable || '',
        text: `${j.version || j.name || 'Java'}${j.arch ? ' (' + j.arch + ')' : ''}${j.majorVersion ? ' [' + j.majorVersion + ']' : ''}`
      }))
    ];
    if (!customSelectInstances['vset-java']) {
      customSelectInstances['vset-java'] = new CustomSelect('vset-java-wrapper', {
        onChange: (value) => saveCurrentVersionSetting('javaPath', value)
      });
    }
    customSelectInstances['vset-java'].setOptions(options);
    if (selectValue) {
      customSelectInstances['vset-java'].setValue(selectValue);
    }
  } catch (e) {
    console.error('[VersionSettings] Refresh Java options error:', e);
  }
}

async function vsetDetectJava() {
  if (!appState.currentSettingsVersionId) return;
  showToast('正在搜索 Java...', 'info');
  try {
    const result = await API.detectJava();
    if (result.javaList && result.javaList.length > 0) {
      const best = result.javaList.find(j => j.majorVersion >= 17) || result.javaList[0];
      await refreshVsetJavaOptions(best.path);
      saveCurrentVersionSetting('javaPath', best.path);
      showToast(`已找到 Java ${best.version}，已自动选中`, 'success');
    } else {
      showToast('未检测到 Java，请尝试手动导入', 'warning');
    }
  } catch (e) {
    showToast('Java 搜索失败', 'error');
  }
}

async function vsetBrowseJava() {
  if (!appState.currentSettingsVersionId) return;
  if (bridge && bridge.showOpenDialog) {
    try {
      const result = await bridge.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Java 可执行文件', extensions: ['exe', ''] }]
      });
      if (!result.canceled && result.filePaths.length > 0) {
        const javaPath = result.filePaths[0];
        await refreshVsetJavaOptions(javaPath);
        saveCurrentVersionSetting('javaPath', javaPath);
        showToast('已导入 Java，已自动选中', 'success');
      }
    } catch (e) {
      showToast('导入失败', 'error');
    }
  } else {
    showToast('请手动输入 Java 路径', 'info');
  }
}

function refreshVersionDisplayName() {
  if (!appState.currentSettingsVersionId) return;
  const customName = document.getElementById('vset-custom-name')?.value || '';
  const versionInfo = appState.installedVersions.find(v => v.id === appState.currentSettingsVersionId);
  if (versionInfo) versionInfo.customName = customName;
  const displayName = customName || appState.currentSettingsVersionId;
  document.getElementById('vset-title').textContent = '版本设置 - ' + displayName;
  const vItem = document.querySelector(`.version-item[data-version-id="${CSS.escape(appState.currentSettingsVersionId)}"] .version-item-name`);
  if (vItem) vItem.textContent = displayName;
  updateVersionSelects();
}

function closeVersionSettings() {
  appState.currentSettingsVersionId = null;
  S.currentVersionSettings = null;
  const vm = vmHolders.versionSettings;
  if (vm && typeof vm.close === 'function') {
    vm.close();
    return;
  }
  appState._modDownloadVersionId = '';
  document.querySelector('.content-area')?.classList.remove('no-scroll');
  navigateToPage(appState.previousPage || 'home');
}

function switchVSetTab(tabName) {
  document.querySelectorAll('.vset-nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`.vset-nav-item[data-tab="${tabName}"]`)?.classList.add('active');

  document.querySelectorAll('.vset-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`vset-panel-${tabName}`);
  if (panel) panel.classList.add('active');

  if (tabName === 'modmgr') {
    const versionInfo = appState.installedVersions.find(v => v.id === appState.currentSettingsVersionId);
    const isVanilla = versionInfo && !versionInfo.isFabric && !versionInfo.isForge && !versionInfo.isNeoForge;
    const modList = document.getElementById('modmgr-mod-list');
    const modHeader = panel?.querySelector('.modmgr-header-row');
    const modActions = panel?.querySelector('.modmgr-actions');
    if (isVanilla) {
      if (modHeader) modHeader.style.display = 'none';
      if (modActions) modActions.style.display = 'none';
      if (modList) {
        modList.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="width:48px;height:48px;margin-bottom:16px;opacity:0.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">原版不支持安装模组</div>
            <div style="font-size:13px;color:var(--text-muted);max-width:320px;line-height:1.6;">此版本为 Minecraft 原版，没有模组加载器。如需安装模组，请先安装 Fabric、Forge 或 NeoForge 模组加载器。</div>
          </div>`;
      }
    } else {
      if (modHeader) modHeader.style.display = '';
      if (modActions) modActions.style.display = '';
      if (!S._modMgrSettingsLoaded) {
        loadInstalledModsForSettings();
      }
    }
  } else if (tabName === 'export' && !S._exportTreeLoaded) {
    loadExportTreeData();
  }
}

function openVersionFolder() {
  if (!appState.currentSettingsVersionId) return;
  API.openVersionFolder(appState.currentSettingsVersionId, 'version');
}

function openSavesFolder() {
  if (!appState.currentSettingsVersionId) return;
  API.openVersionFolder(appState.currentSettingsVersionId, 'saves');
}

function openModsFolder() {
  if (!appState.currentSettingsVersionId) return;
  API.openVersionFolder(appState.currentSettingsVersionId, 'mods');
}

export { openVersionSettings, loadVersionSettingsUI, saveCurrentVersionSetting, refreshVsetJavaOptions, vsetDetectJava, vsetBrowseJava, refreshVersionDisplayName, closeVersionSettings, switchVSetTab, openVersionFolder, openSavesFolder, openModsFolder };
