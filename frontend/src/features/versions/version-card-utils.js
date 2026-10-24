// features/versions/version-card-utils.js — 版本卡片相关纯函数
// 供版本列表、设置页与单元测试共用，不依赖 DOM。

// 版本卡片样式开关：true=新版卡片（宣传图样式），false=旧版列表
export function getVersionCardStyle() {
  try {
    return localStorage.getItem('versepc_version_card_style') !== 'list';
  } catch (e) {
    return true;
  }
}
