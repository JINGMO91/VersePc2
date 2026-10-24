// dev-page-entry.js — 单页独立预览入口
// 只加载样式与目标页面组件，不引入主应用启动流程，避免无关模块中断渲染。
import './styles/tailwind.css';
import { createApp } from 'vue';

// 白名单方式列出可预览页面，避免动态拼接路径无法被构建工具静态分析。
// 新增页面时在此登记，供 ?p=<name> 访问。
const PAGES = {
  home: ['首页', () => import('./vue/pages/page-home.js')],
  versions: ['下载/版本', () => import('./vue/pages/page-versions.js')],
  'installed-versions': ['已安装版本', () => import('./vue/pages/page-installed-versions.js')],
  'version-detail': ['版本详情', () => import('./vue/pages/page-version-detail.js')],
  'version-settings': ['版本设置', () => import('./vue/pages/page-version-settings.js')],
  mods: ['模组', () => import('./vue/pages/page-mods.js')],
  'mod-detail': ['模组详情', () => import('./vue/pages/page-mod-detail.js')],
  'mod-favorites': ['模组收藏', () => import('./vue/pages/page-mod-favorites.js')],
  modpacks: ['整合包', () => import('./vue/pages/page-modpacks.js')],
  datapacks: ['数据包', () => import('./vue/pages/page-datapacks.js')],
  resourcepacks: ['材质包', () => import('./vue/pages/page-resourcepacks.js')],
  shaders: ['光影包', () => import('./vue/pages/page-shaders.js')],
  'lan-terracotta': ['陶瓦联机', () => import('./vue/pages/page-lan-terracotta.js')],
  'lan-portmap': ['红石联机', () => import('./vue/pages/page-lan-portmap.js')],
  'lan-enderlink': ['EnderLink 联机', () => import('./vue/pages/page-lan-enderlink.js')],
  plugins: ['插件', () => import('./vue/pages/page-plugins.js')],
  'private-server': ['一起玩', () => import('./vue/pages/page-private-server.js')],
  'server-host': ['开服', () => import('./vue/pages/page-server-host.js')],
  toolbox: ['工具箱', () => import('./vue/pages/page-toolbox.js')],
  accounts: ['账户', () => import('./vue/pages/page-accounts.js')],
  'settings-launch': ['设置-启动', () => import('./vue/pages/page-settings-launch.js')],
  'settings-personalize': ['设置-个性化', () => import('./vue/pages/page-settings-personalize.js')],
  'settings-other': ['设置-其他', () => import('./vue/pages/page-settings-other.js')],
  java: ['Java 管理', () => import('./vue/pages/page-java.js')],
  downloads: ['下载管理', () => import('./vue/pages/page-downloads.js')],
  feedback: ['问题反馈', () => import('./vue/pages/page-feedback.js')],
  cloud: ['Verse 云盘', () => import('./vue/pages/page-cloud.js')],
};

const params = new URLSearchParams(location.search);
const name = params.get('p') || 'feedback';
const select = document.getElementById('vp-page');

for (const [key, [label]] of Object.entries(PAGES)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = label;
  select.appendChild(opt);
}
if (PAGES[name]) select.value = name;

select.addEventListener('change', () => {
  location.search = `?p=${select.value}`;
});

const stage = document.getElementById('stage');

async function render() {
  const entry = PAGES[name];
  if (!entry) {
    stage.innerHTML = `<div class="vp-error">未知页面：${name}</div>`;
    return;
  }
  try {
    const mod = await entry[1]();
    createApp(mod.default || mod).mount(stage);
  } catch (e) {
    stage.innerHTML = `<div class="vp-error">页面渲染失败：${String(e && e.message ? e.message : e)}</div>`;
  }
}

render();
