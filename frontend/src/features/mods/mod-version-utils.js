

import { modDetailState } from './detail-state.js';

export function pickDependencyRootVersion(gameVersion, loader) {
  let candidates = Array.isArray(modDetailState.allVersions) ? modDetailState.allVersions.slice() : [];
  if (gameVersion) {
    candidates = candidates.filter(v =>
      (v.gameVersions || []).some(gv => gv === gameVersion));
  }
  if (loader) {
    candidates = candidates.filter(v =>
      (v.loaders || []).some(l => l.toLowerCase() === loader.toLowerCase()));
  }
  if (candidates.length === 0) return '';
  const sorted = _sortVersionsByNumber(candidates);
  const release = sorted.find(v => v.releaseType === 'release');
  return (release || sorted[0]).id || '';
}

function _versionToExact(ver) {
  if (!ver) return null;
  const base = ver.split('-')[0];
  if (ver.includes('w') || ver.includes('snapshot')) return '快照版';
  const m = base.match(/^(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function _versionToMajor(ver) {
  if (!ver) return null;
  if (ver.includes('w') || ver.includes('snapshot')) return '快照版';
  const base = ver.split('-')[0];
  const parts = base.split('.');
  if (parts.length < 2) return null;
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  if (major === 1 && minor >= 14) return '1.' + minor;
  if (major >= 25) return major + '.' + minor;
  return null;
}

function _sortVersionsByNumber(versions) {
  return [...versions].sort((a, b) => {
    // 提取版本号字符串，去掉前缀 v/V
    const aRaw = (a.versionNumber || a.versionName || '').trim();
    const bRaw = (b.versionNumber || b.versionName || '').trim();
    const aNum = aRaw.replace(/^v/i, '');
    const bNum = bRaw.replace(/^v/i, '');
    const aParts = aNum.split(/[.\-_]/).map(p => parseInt(p, 10) || 0);
    const bParts = bNum.split(/[.\-_]/).map(p => parseInt(p, 10) || 0);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;
      if (aVal !== bVal) return bVal - aVal;
    }
    // 版本号完全相同时，按发布日期降序（新版本在前）
    const aDate = new Date(a.datePublished || 0).getTime();
    const bDate = new Date(b.datePublished || 0).getTime();
    return bDate - aDate;
  });
}

export { _versionToExact, _versionToMajor, _sortVersionsByNumber };
