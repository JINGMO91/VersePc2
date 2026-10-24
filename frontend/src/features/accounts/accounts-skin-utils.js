// 皮肤头像裁剪与详情背景：独立成模块，供账户列表、头像与详情共用。
import { accountsState as S } from './accounts-state.js';

export function cropSkinHeadCanvas(imgElement, outputSize = 64) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const sw = imgElement.naturalWidth || imgElement.width;
    const sh = imgElement.naturalHeight || imgElement.height;
    if (sw < 64 || sh < 32) return null;
    const scale = sw / 64;
    canvas.width = outputSize;
    canvas.height = outputSize;
    ctx.imageSmoothingEnabled = false;
    // 双图层：脸部放大约 0.75，帽子层放大约 0.875（帽子比脸大，完整显示帽子像素块，不被脸的正方形裁剪）
    const faceSize = Math.round(outputSize * 0.75);
    const hatSize = Math.round(outputSize * 0.875);
    const faceOffset = Math.round((outputSize - faceSize) / 2);
    const hatOffset = Math.round((outputSize - hatSize) / 2);
    // 脸部（居中背景）
    ctx.drawImage(imgElement, 8 * scale, 8 * scale, 8 * scale, 8 * scale, faceOffset, faceOffset, faceSize, faceSize);
    // 帽子层（更大、居中前景，透明像素露出脸部）
    if (sh >= 64) {
      const hatCanvas = document.createElement('canvas');
      hatCanvas.width = outputSize;
      hatCanvas.height = outputSize;
      const hatCtx = hatCanvas.getContext('2d');
      hatCtx.imageSmoothingEnabled = false;
      hatCtx.drawImage(imgElement, 40 * scale, 8 * scale, 8 * scale, 8 * scale, hatOffset, hatOffset, hatSize, hatSize);
      const hatData = hatCtx.getImageData(0, 0, outputSize, outputSize);
      const faceData = ctx.getImageData(0, 0, outputSize, outputSize);
      for (let i = 0; i < hatData.data.length; i += 4) {
        const ha = hatData.data[i + 3];
        if (ha > 0) {
          // 帽子不透明像素直接覆盖脸部，透明像素保留脸部
          faceData.data[i] = hatData.data[i];
          faceData.data[i + 1] = hatData.data[i + 1];
          faceData.data[i + 2] = hatData.data[i + 2];
          faceData.data[i + 3] = ha;
        }
      }
      ctx.putImageData(faceData, 0, 0);
    }
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('[cropSkinHeadCanvas] error:', e);
    return null;
  }
}

export function setSkinBg(color) {
  S._currentSkinBg = color;
  const left = document.getElementById('acct-detail-left');
  if (left) {
    left.classList.toggle('bg-black', color === 'black');
  }
  if (S._skinViewer) {
    S._skinViewer.background = color === 'black' ? 0x000000 : 0xffffff;
  }
  document.querySelectorAll('.acct-bg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bg === color);
  });
}
