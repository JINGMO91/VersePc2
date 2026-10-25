// @vitest-environment jsdom
// wallpaper-utils.test.js — 壁纸路径与全局下载进度条单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _ensureGlobalDlBar,
  hideGlobalDownloadProgress,
  showGlobalDownloadProgress,
  wewpVideoPath,
  wpfilePath,
} from './wallpaper-utils.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('wpfilePath', () => {
  it('空路径返回空串，已转换路径保持不变', () => {
    expect(wpfilePath('')).toBe('');
    expect(wpfilePath('wpfile:///a/b.png')).toBe('wpfile:///a/b.png');
    expect(wpfilePath('blob:http://x')).toBe('blob:http://x');
  });

  it('Windows 路径转换为编码后的自定义协议地址', () => {
    expect(wpfilePath('C:\\Wallpapers\\a b.png')).toBe('wpfile:///C%3A/Wallpapers/a%20b.png');
  });
});

describe('wewpVideoPath', () => {
  it('缺少参数时返回空串', () => {
    expect(wewpVideoPath('', 'a.mp4')).toBe('');
    expect(wewpVideoPath('123', '')).toBe('');
  });

  it('按平台拼接映射后的协议地址并编码路径段', () => {
    expect(wewpVideoPath('123', 'video/a b.mp4')).toBe('wewp://localhost/123/video/a%20b.mp4');
  });
});

describe('全局下载进度条', () => {
  it('只创建一次并更新百分比与详情', () => {
    const first = _ensureGlobalDlBar();
    const second = _ensureGlobalDlBar();
    expect(first).toBe(second);
    expect(document.querySelectorAll('#global-download-progress-bar').length).toBe(1);

    showGlobalDownloadProgress('下载中', 42.6, '3/10 文件');
    expect(document.querySelector('#gdlb-pct').textContent).toBe('43%');
    expect(document.querySelector('#gdlb-fill').style.width).toBe('43%');
    expect(document.querySelector('#gdlb-info').textContent).toBe('3/10 文件');
    expect(first.style.display).toBe('block');

    hideGlobalDownloadProgress();
    expect(first.style.display).toBe('none');
  });
});
