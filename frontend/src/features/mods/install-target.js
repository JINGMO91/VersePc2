import { bridge as bridge } from '../../core/tauri-bridge.js';
import { getCustomSelectValue as getCustomSelectValue } from '../misc/custom-select.js';
import { modDetailState as modDetailState } from './detail-state.js';
import { createApp as createApp } from 'vue';
import { S } from './install-state.js';
import { ensureInstalledVersions, matchInstalledVersion, resolveModSavePath, resolveResourceSavePath, getSelectedVersionModsPath } from './install-paths.js';

function resolveModTarget(gameVersions, loaders) {
  const gvs = (gameVersions || []).map(String);
  const lds = (loaders || []).map(String).map(l => l.toLowerCase());
  const LD = ['forge', 'fabric', 'neoforge', 'quilt'];
  let loader = lds.find(l => LD.includes(l)) || '';
  if (!loader) {
    loader = gvs.find(g => LD.includes(g.toLowerCase())) || '';
  }
  let game = gvs.find(g => /^\d+(\.\d+)+$/.test(g)) || '';
  return { game, loader };
}

function resolveModVersionTarget(versionId) {
  try {
    const versions = (typeof modDetailState.allVersions !== 'undefined' ? modDetailState.allVersions : []);
    const v = versions.find(x => x && x.id === versionId);
    if (v) return resolveModTarget(v.gameVersions, v.loaders);
  } catch (e) {}
  return { game: '', loader: '' };
}

async function resolveModSavePathWithConfirm() {
  const filterVersion = getCustomSelectValue('mod-filter-version') || '';
  const filterLoader = getCustomSelectValue('mod-filter-loader') || '';
  const targetGame = S._mdSaveGame || filterVersion || '';
  const targetLoader = S._mdSaveLoader || filterLoader || '';

  // 优先使用按常规逻辑解析的默认保存文件夹（选中版本兼容则用之，否则择优）
  let resolved = null;
  try {
    if (bridge && typeof bridge.getDefaultModSaveFolder === 'function') {
      resolved = await bridge.getDefaultModSaveFolder(targetGame, targetLoader);
      console.warn('[mod-folder] backend 入参=', targetGame, targetLoader, '返回=', JSON.stringify(resolved));
    }
  } catch (e) {
    console.warn('[resolveModSavePathWithConfirm] getDefaultModSaveFolder error:', e);
  }

  if (resolved && resolved.path) {
    if (resolved.selectedCompatible || resolved.compatible) {
      return resolved.path;
    }
    const ok = await showNoFolderConfirmCard('该版本没有对应的版本文件夹，将会打开已选择版本的 mod 文件夹');
    if (!ok) return null;
    return getSelectedVersionModsPath();
  }

  // 备选：命令不可用时的旧版匹配逻辑
  await ensureInstalledVersions();
  const matched = matchInstalledVersion(targetGame, targetLoader);
  if (matched) {
    return resolveModSavePath();
  }
  const ok = await showNoFolderConfirmCard('该版本没有对应的版本文件夹，将会打开已选择版本的 mod 文件夹');
  if (!ok) return null;
  return getSelectedVersionModsPath();
}

function showNoFolderConfirmCard(message) {
  return new Promise((resolve) => {
    if (S._noFolderApp) {
      try { S._noFolderApp.unmount(); } catch (e) {}
      S._noFolderApp = null;
    }
    let host = document.getElementById('mod-no-folder-card-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mod-no-folder-card-host';
      document.body.appendChild(host);
    } else {
      host.innerHTML = '';
    }
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (S._noFolderApp) {
        try { S._noFolderApp.unmount(); } catch (e) {}
        S._noFolderApp = null;
      }
      if (host) host.innerHTML = '';
      resolve(val);
    };
    const App = {
      data() {
        return {
          visible: false,
          message: message || '该版本没有对应的版本文件夹，将会打开已选择版本的 mod 文件夹',
          confirmText: '确定',
          cancelText: '取消'
        };
      },
      mounted() {
        this.visible = true;
      },
      methods: {
        confirm() { finish(true); },
        cancel() { finish(false); }
      },
      template: `
        <transition name="modnf-fade">
          <div class="modnf-overlay" v-if="visible" @click.self="cancel" role="presentation">
            <div class="modnf-card" role="dialog">
              <div class="modnf-icon">📂</div>
              <div class="modnf-title">提示</div>
              <p class="modnf-message">{{ message }}</p>
              <div class="modnf-actions">
                <button type="button" class="btn btn-secondary btn-sm" @click="cancel">{{ cancelText }}</button>
                <button type="button" class="btn btn-primary btn-sm" @click="confirm">{{ confirmText }}</button>
              </div>
            </div>
          </div>
        </transition>`
    };
    S._noFolderApp = createApp(App).mount(host);
  });
}

export { resolveModTarget, resolveModVersionTarget, ensureInstalledVersions, matchInstalledVersion, resolveModSavePath, resolveResourceSavePath, getSelectedVersionModsPath, resolveModSavePathWithConfirm, showNoFolderConfirmCard };
