import { API as API } from '../../core/api.js';
import { bridge as bridge } from '../../core/tauri-bridge.js';
import { showToast as showToast } from '../misc/ui-components.js';

async function detectJava() {
  const hint = document.getElementById('java-detect-result');
  if (hint) hint.textContent = '检测中...';
  try {
    const result = await API.detectJava();
    if (result.javaList && result.javaList.length > 0) {
      const best = result.javaList.find(j => j.majorVersion >= 17) || result.javaList[0];
      const javaPathInput = document.getElementById('setting-java-path');
      if (javaPathInput) javaPathInput.value = best.path;
      if (hint) hint.textContent = `找到 Java ${best.version} (${best.is64Bit ? '64位' : '32位'})`;
      const statJava = document.getElementById('stat-java');
      if (statJava) statJava.textContent = best.majorVersion;
    } else {
      if (hint) hint.textContent = '未检测到Java，请手动配置或安装';
    }
  } catch (e) { if (hint) hint.textContent = '检测失败'; }
}

async function checkJavaOnStartup() {
  try {
    const result = await API.detectJava();
    if (result.javaList && result.javaList.length > 0) {
      const best = result.javaList.find(j => j.majorVersion >= 17) || result.javaList[0];
      const statJava = document.getElementById('stat-java');
      if (statJava) statJava.textContent = best.majorVersion;
    }
  } catch (e) {
    console.error('Java startup check failed:', e);
  }
}

async function triggerJvmPreheat() {
  try {
    const saved = await bridge.store.get('versepc_launch_settings');
    if (!saved) return;
    const settings = JSON.parse(saved);
    if (!settings.jvmPreheat) return;

    const result = await API.detectJava();
    if (result && result.javaList && result.javaList.length > 0) {
      const bestJava = result.javaList.find(j => j.majorVersion >= 17) || result.javaList[0];
      const memInfo = await API.getSystemMemory();
      const totalMB = memInfo.totalMB || 8192;
      const preheatMem = Math.min(2048, Math.floor(totalMB * 0.3));
      await fetch('/api/jvm/preheat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ javaPath: bestJava.path, maxMemMB: preheatMem })
      });
    }
  } catch(e) {}
}

async function generateCdsArchive() {
  const versionId = document.getElementById('launch-version-select')?.value;
  if (!versionId) {
    showToast('请先选择一个游戏版本', 'error');
    return;
  }
  const statusText = document.getElementById('cds-status-text');
  if (statusText) statusText.textContent = '正在生成...';
  showToast('正在生成 CDS 归档，请稍候...', 'info');
  try {
    const result = await API.generateCds(versionId);
    if (result.success) {
      const sizeInfo = result.sizeKB ? ` (${result.sizeKB}KB)` : '';
      showToast(`CDS 归档生成成功${sizeInfo}，下次启动将自动加速`, 'success');
      if (statusText) statusText.textContent = `✓ 已生成${sizeInfo}`;
    } else {
      showToast('CDS 归档生成失败: ' + (result.error || '未知错误'), 'error');
      if (statusText) statusText.textContent = '✗ 生成失败';
    }
  } catch (e) {
    showToast('CDS 归档生成失败: ' + e.message, 'error');
    if (statusText) statusText.textContent = '✗ 生成失败';
  }
}

async function checkCdsStatus() {
  const versionId = document.getElementById('launch-version-select')?.value;
  if (!versionId) return;
  const statusText = document.getElementById('cds-status-text');
  if (!statusText) return;
  try {
    const result = await API.getCdsStatus(versionId);
    if (result.available) {
      statusText.textContent = `✓ 归档已就绪 (${result.sizeKB}KB)`;
    } else {
      statusText.textContent = '未生成归档';
    }
  } catch (e) {
    statusText.textContent = '';
  }
}

export { detectJava, checkJavaOnStartup, triggerJvmPreheat, generateCdsArchive, checkCdsStatus };
