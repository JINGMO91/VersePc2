// core/utils.js — 通用格式化与懒加载工具
// 迁移期间由 legacy/globals.js 统一暴露为全局函数，供尚未迁移的脚本使用。

export function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${year}/${month}/${day} ${hours}:${minutes}`;
    } catch (e) { return dateStr; }
}

export function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = (bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0);
    return `${size} ${units[i]}`;
}

export function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

export function formatSpeed(bytesPerSec) {
    if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
    if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
    return bytesPerSec + ' B/s';
}

export function formatDuration(seconds) {
    seconds = Math.ceil(seconds);
    if (seconds < 60) return seconds + '秒';
    if (seconds < 3600) return Math.floor(seconds / 60) + '分' + (seconds % 60) + '秒';
    return Math.floor(seconds / 3600) + '时' + Math.floor((seconds % 3600) / 60) + '分';
}

const _lazyScriptCache = {};
export function _lazyLoadScript(src) {
    if (_lazyScriptCache[src]) return _lazyScriptCache[src];
    _lazyScriptCache[src] = new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load: ' + src));
        document.head.appendChild(s);
    });
    return _lazyScriptCache[src];
}

/** 兼容 Tauri readFileBuffer 三种返回格式（Base64 字符串 / number[] / Uint8Array）→ Uint8Array */
export function decodeFileBuffer(res) {
    if (typeof res === 'string') {
        try {
            const bin = atob(res);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return bytes;
        } catch (e) {
            return new Uint8Array(0);
        }
    }
    return res instanceof Uint8Array ? res : new Uint8Array(res || []);
}

export function _lazyLoadCSS(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
}
