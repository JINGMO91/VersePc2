import { API as API } from '../../core/api.js';
import { escapeHtml as escapeHtml } from '../../core/utils.js';
import { appState as appState } from '../../core/app-state.js';
import { actionAttrs as actionAttrs } from '../../core/actions.js';
import { S } from './mod-detail-state.js';

async function getLocalImageDataUrl(url) {
  if (!url) return '';
  if (S._mdImageCache.has(url)) {
    const cached = S._mdImageCache.get(url);
    if (typeof cached === 'string') return cached;
    return cached;
  }
  const p = API.getResourceImage(url)
    .then(r => (r && r.dataUrl) || '')
    .catch(() => '')
    .then(d => { if (d) S._mdImageCache.set(url, d); return d; });
  S._mdImageCache.set(url, p);
  return p;
}

async function setLocalImage(el, url, source) {
  if (!el || !url) return;
  const useProxy = (source || appState.currentModDetailSource || 'modrinth') === 'modrinth' && /^https?:\/\//.test(url);
  if (useProxy) {
    const dataUrl = await getLocalImageDataUrl(url);
    if (dataUrl) { el.src = dataUrl; return; }
  }
  el.src = url;
}

function proxifyBodyHtml(html) {
  const source = appState.currentModDetailSource || 'modrinth';
  if (source !== 'modrinth') return html;
  const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  return html.replace(/<img([^>]*?)src="([^"]+cdn\.modrinth\.com[^"]+)"([^>]*)>/gi, (m, pre, url, post) => {
    return `<img${pre}src="${PLACEHOLDER}" data-src="${url}"${post}>`;
  });
}

function hydrateBodyImages(container) {
  if (!container) return;
  const source = appState.currentModDetailSource || 'modrinth';
  container.querySelectorAll('img[data-src]').forEach(img => {
    setLocalImage(img, img.getAttribute('data-src'), source);
  });
}

function renderModGallery(detail) {
  const container = document.getElementById('md-gallery');
  const galleryTab = document.getElementById('md-gallery-tab');
  const raw = (detail && detail.gallery) || [];
  const gallery = Array.isArray(raw) ? raw : [];
  if (galleryTab) galleryTab.style.display = gallery.length > 0 ? '' : 'none';
  if (!container) return;
  S.mdGallery = gallery;
  if (gallery.length === 0) {
    container.innerHTML = '<p class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">暂无截图</p>';
    return;
  }
  const source = appState.currentModDetailSource || 'modrinth';
  const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  container.innerHTML = gallery.map((item, idx) => {
    const url = (item && (item.url || item.rawUrl)) || item || '';
    const title = (item && item.title) || '';
    return `<div class="md-gallery-item"${actionAttrs('openGalleryLightbox', idx)}>
      <img class="md-gallery-image" src="${PLACEHOLDER}" data-src="${escapeHtml(url)}" alt="${escapeHtml(title)}" loading="lazy">
      ${title ? `<div class="md-gallery-item-title">${escapeHtml(title)}</div>` : ''}
    </div>`;
  }).join('');
  container.querySelectorAll('img[data-src]').forEach(img => {
    setLocalImage(img, img.getAttribute('data-src'), source);
  });
}

function openGalleryLightbox(idx) {
  const gallery = S.mdGallery || [];
  if (gallery.length === 0) return;
  S.mdGalleryIndex = Math.max(0, Math.min(idx, gallery.length - 1));
  const box = document.getElementById('md-gallery-lightbox');
  const img = document.getElementById('md-gallery-lightbox-img');
  const cap = document.getElementById('md-gallery-lightbox-caption');
  if (!box || !img) return;
  const item = gallery[S.mdGalleryIndex];
  const url = (item && (item.rawUrl || item.url)) || item || '';
  img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  setLocalImage(img, url);
  if (cap) cap.textContent = (item && item.title) ? item.title : '';
  box.style.display = 'flex';
}

function closeGalleryLightbox() {
  const box = document.getElementById('md-gallery-lightbox');
  if (box) box.style.display = 'none';
}

function prevGalleryImage() {
  const gallery = S.mdGallery || [];
  if (gallery.length === 0 || S.mdGalleryIndex === undefined) return;
  const nextIdx = (S.mdGalleryIndex - 1 + gallery.length) % gallery.length;
  openGalleryLightbox(nextIdx);
}

function nextGalleryImage() {
  const gallery = S.mdGallery || [];
  if (gallery.length === 0 || S.mdGalleryIndex === undefined) return;
  const nextIdx = (S.mdGalleryIndex + 1) % gallery.length;
  openGalleryLightbox(nextIdx);
}

export { getLocalImageDataUrl, setLocalImage, proxifyBodyHtml, hydrateBodyImages, renderModGallery, openGalleryLightbox, closeGalleryLightbox, prevGalleryImage, nextGalleryImage };
