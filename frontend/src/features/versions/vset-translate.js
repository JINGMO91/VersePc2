import { bridge as bridge } from '../../core/tauri-bridge.js';
import { showToast as showToast, showModal as showModal } from '../misc/ui-components.js';
import { appState as appState } from '../../core/app-state.js';
import { S } from './vset-state.js';

async function openModTranslateDialog(fileName, modName) {
  if (!appState.currentSettingsVersionId) {
    showToast('请先选择版本', 'error');
    return;
  }
  S._translateModName = modName || fileName;
  const jarPath = await _resolveModJarPath(fileName);
  if (!jarPath) {
    showToast('找不到模组文件: ' + fileName, 'error');
    return;
  }
  S._translateModJarPath = jarPath;

  showModal('mod-translate-modal');
  document.getElementById('mod-translate-loading').style.display = '';
  document.getElementById('mod-translate-content').style.display = 'none';

  try {
    const result = await bridge.mods.findLangFiles(jarPath);
    S._translateLangInfo = result;

    document.getElementById('mod-translate-loading').style.display = 'none';
    document.getElementById('mod-translate-content').style.display = '';
    document.getElementById('mod-translate-modname').textContent = S._translateModName;

    let langText = '';
    if (result && result.langFiles && result.langFiles.length > 0) {
      const enFile = result.langFiles.find(f => f.isEnglish) || result.langFiles[0];
      const hasZh = result.langFiles.some(f => f.isChinese);
      langText = `共 ${result.langFiles.length} 个语言文件`;
      if (enFile) langText += `，英文源: ${enFile.name}`;
      if (hasZh) langText += '，已有中文翻译';
    } else {
      langText = '未找到语言文件（此模组可能没有可翻译的文本）';
    }
    document.getElementById('mod-translate-langinfo').textContent = langText;

    const aiConfig = _getTranslateAIConfig();
    const warning = document.getElementById('mod-translate-ai-warning');
    const startBtn = document.getElementById('mod-translate-start-btn');
    if (!aiConfig || !aiConfig.provider || !aiConfig.apiKey) {
      warning.style.display = '';
      startBtn.disabled = true;
      startBtn.textContent = '未配置 AI';
    } else {
      warning.style.display = 'none';
      startBtn.disabled = false;
      startBtn.textContent = '开始机翻';
    }

    document.getElementById('mod-translate-progress').style.display = 'none';
    document.getElementById('mod-translate-result').style.display = 'none';

    switchTranslateTab('quick');
  } catch (e) {
    document.getElementById('mod-translate-loading').innerHTML =
      `<p style="color:var(--text-muted);">检查失败: ${e.message}</p>`;
  }
}

async function _resolveModJarPath(fileName) {
  try {
    const r = await fetch(`/api/mods/installed?versionId=${encodeURIComponent(appState.currentSettingsVersionId)}`);
    const mods = await r.json();
    const mod = (mods || []).find(m => m.fileName === fileName);
    if (mod && mod.jarPath) return mod.jarPath;
  } catch (_) {}
  try {
    const dir = await bridge.mods.getVersionModsDir(appState.currentSettingsVersionId);
    if (dir) {
      return dir + '/' + fileName;
    }
  } catch (_) {}
  return '';
}

function _getTranslateAIConfig() {
  try { return JSON.parse(localStorage.getItem('v-island-ai-config') || '{}'); }
  catch (_) { return {}; }
}

function switchTranslateTab(tab) {
  document.querySelectorAll('.mod-translate-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('mod-translate-tab-quick').style.display = tab === 'quick' ? '' : 'none';
  document.getElementById('mod-translate-tab-auto').style.display = tab === 'auto' ? '' : 'none';
  document.getElementById('mod-translate-tab-manual').style.display = tab === 'manual' ? '' : 'none';
}

async function startQuickTranslate() {
  if (!S._translateLangInfo || !S._translateLangInfo.langFiles || S._translateLangInfo.langFiles.length === 0) {
    showToast('没有可翻译的语言文件', 'error');
    return;
  }

  const enFile = S._translateLangInfo.langFiles.find(f => f.isEnglish);
  if (!enFile) {
    showToast('未找到英文语言文件，无法翻译', 'error');
    return;
  }

  const startBtn = document.getElementById('mod-translate-quick-btn');
  const progressBar = document.getElementById('mod-translate-quick-progress-bar');
  const progressBox = document.getElementById('mod-translate-quick-progress');
  const progressText = document.getElementById('mod-translate-quick-progress-text');
  const resultBox = document.getElementById('mod-translate-quick-result');

  startBtn.disabled = true;
  startBtn.textContent = '翻译中...';
  progressBox.style.display = '';
  progressBar.style.width = '0%';
  progressText.textContent = '正在读取语言文件...';
  resultBox.style.display = 'none';

  try {
    const readResult = await bridge.mods.readJarEntry(S._translateModJarPath, enFile.name);
    if (!readResult || !readResult.success || !readResult.content) {
      throw new Error(readResult?.error || '读取语言文件失败');
    }
    const content = readResult.content;

    let entries;
    if (enFile.name.endsWith('.json')) {
      entries = JSON.parse(content);
    } else {
      entries = {};
      content.split('\n').forEach(line => {
        const match = line.match(/^(.+?)=(.+)$/);
        if (match) entries[match[1].trim()] = match[2].trim();
      });
    }

    const keys = Object.keys(entries);
    if (keys.length === 0) {
      throw new Error('语言文件为空');
    }

    const values = keys.map(k => entries[k]);
    const BATCH_SIZE = 40;
    const translatedValues = [];

    progressText.textContent = '共 ' + keys.length + ' 条文本，正在翻译...';
    progressBar.style.width = '2%';

    for (let i = 0; i < values.length; i += BATCH_SIZE) {
      const batch = values.slice(i, i + BATCH_SIZE);
      const res = await bridge.ai.translateBatch({ texts: batch, source: 'en', target: 'zh-CN' });
      if (!res || !res.ok || !res.results) {
        throw new Error(res?.error || '翻译接口失败（批次 ' + (Math.floor(i / BATCH_SIZE) + 1) + '）');
      }
      // 确保结果数量匹配
      const results = res.results;
      while (results.length < batch.length) results.push(batch[results.length]);
      translatedValues.push(...results.slice(0, batch.length));

      const done = Math.min(i + BATCH_SIZE, values.length);
      progressBar.style.width = Math.round((done / values.length) * 100) + '%';
      progressText.textContent = '已翻译 ' + done + '/' + values.length + ' 条文本...';
    }

    // 组装翻译后的 entries
    const translatedEntries = {};
    keys.forEach((k, idx) => { translatedEntries[k] = translatedValues[idx]; });

    // 确定输出文件名
    const zhFileName = enFile.name.replace(/en_us\.json$/i, 'zh_cn.json').replace(/en_us\.lang$/i, 'zh_cn.lang').replace(/en\.lang$/i, 'zh_cn.lang');
    const isJson = zhFileName.endsWith('.json');
    const outputContent = isJson ? JSON.stringify(translatedEntries, null, 2) : keys.map(k => k + '=' + translatedEntries[k]).join('\n');

    const writeResult = await bridge.mods.writeJarEntry(S._translateModJarPath, zhFileName, outputContent);
    if (!writeResult || !writeResult.success) {
      throw new Error(writeResult?.error || '写入翻译文件失败');
    }

    progressBar.style.width = '100%';
    progressText.textContent = '';
    resultBox.style.display = '';
    resultBox.style.background = 'rgba(34,197,94,0.1)';
    resultBox.style.color = '#22c55e';
    resultBox.textContent = '汉化完成！共翻译 ' + keys.length + ' 条文本，已写入 ' + zhFileName;

    showToast('快速汉化完成，共翻译 ' + keys.length + ' 条', 'success');
  } catch (e) {
    resultBox.style.display = '';
    resultBox.style.background = 'rgba(239,68,68,0.1)';
    resultBox.style.color = '#ef4444';
    resultBox.textContent = '汉化失败：' + e.message;
    showToast('汉化失败：' + e.message, 'error');
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = '开始快速汉化';
  }
}

async function startAutoTranslate() {
  if (!S._translateLangInfo || !S._translateLangInfo.langFiles || S._translateLangInfo.langFiles.length === 0) {
    showToast('没有可翻译的语言文件', 'error');
    return;
  }

  const aiConfig = _getTranslateAIConfig();
  if (!aiConfig || !aiConfig.provider || !aiConfig.apiKey) {
    showToast('请先在 V岛设置中配置 AI 供应商', 'error');
    return;
  }

  const enFile = S._translateLangInfo.langFiles.find(f => f.isEnglish) || S._translateLangInfo.langFiles[0];
  if (!enFile) {
    showToast('找不到英文源语言文件', 'error');
    return;
  }

  const zhName = enFile.zhName || enFile.name.replace(/en_us/i, 'zh_cn');
  const startBtn = document.getElementById('mod-translate-start-btn');
  const progressDiv = document.getElementById('mod-translate-progress');
  const progressBar = document.getElementById('mod-translate-progress-bar');
  const progressText = document.getElementById('mod-translate-progress-text');
  const resultDiv = document.getElementById('mod-translate-result');

  startBtn.disabled = true;
  startBtn.textContent = '翻译中...';
  progressDiv.style.display = '';
  resultDiv.style.display = 'none';
  progressBar.style.width = '10%';
  progressText.textContent = '正在读取语言文件...';

  try {
    const readResult = await bridge.mods.readJarEntry(S._translateModJarPath, enFile.name);
    if (!readResult || !readResult.success || !readResult.content) {
      throw new Error(readResult?.error || '读取语言文件失败');
    }
    const content = readResult.content;

    let entries;
    if (enFile.name.endsWith('.json')) {
      entries = JSON.parse(content);
    } else {
      entries = {};
      content.split('\n').forEach(line => {
        const match = line.match(/^(.+?)=(.+)$/);
        if (match) entries[match[1].trim()] = match[2].trim();
      });
    }

    const keys = Object.keys(entries);
    if (keys.length === 0) {
      throw new Error('语言文件为空');
    }

    progressBar.style.width = '20%';
    progressText.textContent = `共 ${keys.length} 条文本，正在翻译...`;

    const isJson = enFile.name.endsWith('.json');
    const translated = await _translateWithAI(entries, aiConfig, isJson, (done, total) => {
      const pct = 20 + Math.round((done / total) * 70);
      progressBar.style.width = pct + '%';
      progressText.textContent = `已翻译 ${done}/${total} 条...`;
    });

    progressBar.style.width = '90%';
    progressText.textContent = '正在写入翻译结果...';

    let outputContent;
    if (isJson) {
      outputContent = JSON.stringify(translated, null, 2);
    } else {
      outputContent = keys.map(k => `${k}=${translated[k] || entries[k]}`).join('\n');
    }

    await bridge.mods.writeJarEntry(S._translateModJarPath, zhName, outputContent);

    progressBar.style.width = '100%';
    progressText.textContent = '完成！';
    resultDiv.style.display = '';
    resultDiv.style.background = 'rgba(34,197,94,0.1)';
    resultDiv.style.color = '#22c55e';
    resultDiv.textContent = `汉化完成！已翻译 ${keys.length} 条文本，写入到 ${zhName}`;

    startBtn.textContent = '重新翻译';
    startBtn.disabled = false;
    showToast(`「${S._translateModName}」汉化完成`, 'success');
  } catch (e) {
    progressDiv.style.display = 'none';
    resultDiv.style.display = '';
    resultDiv.style.background = 'rgba(239,68,68,0.1)';
    resultDiv.style.color = '#ef4444';
    resultDiv.textContent = '翻译失败: ' + e.message;
    startBtn.textContent = '重试';
    startBtn.disabled = false;
    showToast('汉化失败: ' + e.message, 'error');
  }
}

async function _translateWithAI(entries, aiConfig, isJson, onProgress) {
  const keys = Object.keys(entries);
  const BATCH_SIZE = 50;
  const PARALLEL = 4;
  const result = {};

  const provider = aiConfig.provider;
  const providerInfo = S._AI_PROVIDERS[provider];
  const baseConfig = {
    provider: provider,
    apiKey: aiConfig.apiKey,
    model: aiConfig.model,
    messages: [],
    maxTokens: 4096,
    timeout: 120000,
  };
  if (provider === 'custom') {
    if (!aiConfig.endpoint) throw new Error('自定义供应商未配置接口地址');
    baseConfig.endpoint = aiConfig.endpoint;
    baseConfig.apiFormat = aiConfig.apiFormat || 'openai';
  } else if (providerInfo) {
    baseConfig.endpoint = providerInfo.endpoint;
    baseConfig.apiFormat = providerInfo.apiFormat;
    if (provider === 'google') {
      baseConfig.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent`;
    }
  } else {
    throw new Error('不支持的供应商: ' + provider);
  }

  const batches = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batchKeys = keys.slice(i, i + BATCH_SIZE);
    const batchEntries = {};
    batchKeys.forEach(k => { batchEntries[k] = entries[k]; });
    batches.push({ index: i, keys: batchKeys, entries: batchEntries });
  }

  const systemPrompt = '你是 Minecraft 模组翻译专家。将用户提供的 JSON 对象中所有英文值翻译成简体中文。要求：1. 只翻译值，不翻译键名 2. 保留所有格式化符号如 %s %d §a &e 等 3. 只返回 JSON 对象，不要使用 markdown 代码块 4. 不要添加任何解释文字';

  let completed = 0;

  async function translateOneBatch(batch) {
    const batchNum = Math.floor(batch.index / BATCH_SIZE) + 1;
    const reqConfig = Object.assign({}, baseConfig);
    reqConfig.messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(batch.entries) },
    ];

    let res;
    let lastError;
    let attempts = 0;
    for (let retry = 0; retry < 3; retry++) {
      attempts = retry + 1;
      try {
        res = await bridge.ai.chat(reqConfig);
        if (res && res.ok && res.reply) {
          const reply = res.reply;
          const jsonStart = reply.indexOf('{');
          const jsonEnd = reply.lastIndexOf('}');
          if (jsonStart >= 0 && jsonEnd > jsonStart) {
            let jsonStr = reply.substring(jsonStart, jsonEnd + 1);
            let translatedBatch = JSON.parse(jsonStr);
            Object.assign(result, translatedBatch);
            completed += batch.keys.length;
            if (onProgress) onProgress(Math.min(completed, keys.length), keys.length);
            return;
          }
        }
        lastError = (res && res.error) || (res && res.reply === '(空回复)' ? '空回复' : '返回格式异常');
        // 余额不足、Key 无效等不可恢复的错误，立即停止重试
        if (lastError && (lastError.indexOf('余额不足') !== -1 ||
            lastError.indexOf('API Key 无效') !== -1 ||
            lastError.indexOf('权限不足') !== -1 ||
            lastError.indexOf('接口地址或模型名称') !== -1)) {
          break;
        }
      } catch (e) {
        lastError = e.message;
      }
      if (retry < 2) await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error('AI 请求失败（批次 ' + batchNum + '，重试' + attempts + '次）：' + lastError);
  }

  for (let i = 0; i < batches.length; i += PARALLEL) {
    const group = batches.slice(i, i + PARALLEL);
    await Promise.all(group.map(b => translateOneBatch(b)));
  }

  return result;
}

async function exportModLangFile() {
  if (!S._translateLangInfo || !S._translateLangInfo.langFiles || S._translateLangInfo.langFiles.length === 0) {
    showToast('没有可导出的语言文件', 'error');
    return;
  }

  const enFile = S._translateLangInfo.langFiles.find(f => f.isEnglish) || S._translateLangInfo.langFiles[0];
  if (!enFile) {
    showToast('找不到英文源语言文件', 'error');
    return;
  }

  try {
    const readResult = await bridge.mods.readJarEntry(S._translateModJarPath, enFile.name);
    if (!readResult || !readResult.success || !readResult.content) {
      showToast(readResult?.error || '读取语言文件失败', 'error');
      return;
    }
    const content = readResult.content;

    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = enFile.name.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已导出 ${enFile.name.split('/').pop()}`, 'success');
  } catch (e) {
    showToast('导出失败: ' + e.message, 'error');
  }
}

async function importModLangFile() {
  if (!S._translateLangInfo) {
    showToast('请先打开模组汉化弹窗', 'error');
    return;
  }

  const fileInput = document.getElementById('mod-translate-file-input');
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileInput.value = '';

    try {
      const content = await file.text();
      const enFile = S._translateLangInfo.langFiles.find(f => f.isEnglish) || S._translateLangInfo.langFiles[0];
      const zhName = (enFile ? enFile.zhName : null) || 'zh_cn.json';

      await bridge.mods.writeJarEntry(S._translateModJarPath, zhName, content);
      showToast(`已导入 ${file.name} → ${zhName}`, 'success');
    } catch (e) {
      showToast('导入失败: ' + e.message, 'error');
    }
  };
  fileInput.click();
}

export { openModTranslateDialog, _resolveModJarPath, _getTranslateAIConfig, switchTranslateTab, startQuickTranslate, startAutoTranslate, _translateWithAI, exportModLangFile, importModLangFile };
