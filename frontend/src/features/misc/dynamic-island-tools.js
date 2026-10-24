// 动态岛可调用工具表：独立成模块，避免智能体主体过长。
import { API } from '../../core/api.js';
import { appState } from '../../core/app-state.js';
import { navigateToPage } from '../../core/navigation.js';
import { handleLaunch } from '../launch/launch.js';
import { _getActiveTaskCount } from './dynamic-island-view.js';

export var _tools = [
        {
            name: 'navigate',
            desc: '切换到指定页面',
            danger: false,
            params: { page: '页面名称：home(主页)/download(下载)/resource(资源)/mods(模组)/modpack(整合包)/settings(设置)/accounts(账户)/personalize(个性化)/java(Java)/experimental(实验性)' },
            run: function (args) {
                var pageMap = {
                    '主页': 'home', '首页': 'home', 'home': 'home',
                    '下载': 'download', 'download': 'download',
                    '资源': 'resource', 'resource': 'resource',
                    '模组': 'mods', 'mods': 'mods',
                    '整合包': 'modpack', 'modpack': 'modpack',
                    '设置': 'settings', 'settings': 'settings',
                    '账户': 'accounts', '账号': 'accounts', 'accounts': 'accounts',
                    '个性化': 'personalize', 'personalize': 'personalize',
                    'java': 'java', 'Java': 'java',
                    '实验': 'experimental', '实验性': 'experimental', 'experimental': 'experimental'
                };
                var p = pageMap[args.page] || args.page;
                if (navigateToPage) {
                    navigateToPage(p);
                    return '已切换到 ' + args.page + ' 页面';
                }
                return '无法切换页面';
            }
        },
        {
            name: 'open_folder',
            desc: '打开文件夹',
            danger: false,
            params: { type: '文件夹类型：mods(模组文件夹)/saves(存档文件夹)/version(版本文件夹)/screenshots(截图文件夹)' },
            run: function (args) {
                var versionId = (typeof appState.currentLaunchVersionId !== 'undefined' && appState.currentLaunchVersionId) ||
                                (typeof appState.launchVersionCustomSelect !== 'undefined' && appState.launchVersionCustomSelect ? appState.launchVersionCustomSelect.getValue() : '');
                if (!versionId) return '请先选择一个版本';
                if (API.openVersionFolder) {
                    API.openVersionFolder(versionId, args.type || 'mods');
                    return '已打开 ' + (args.type || 'mods') + ' 文件夹';
                }
                return '无法打开文件夹';
            }
        },
        {
            name: 'launch_game',
            desc: '启动游戏',
            danger: true,
            params: { version: '要启动的版本ID（可选，不填则启动当前选中版本）' },
            run: function (args) {
                if (args.version && typeof appState.launchVersionCustomSelect !== 'undefined' && appState.launchVersionCustomSelect) {
                    var versions = (typeof appState.installedVersions !== 'undefined') ? appState.installedVersions : [];
                    var match = versions.find(function (v) {
                        return v.id === args.version || (v.customName && v.customName.indexOf(args.version) !== -1);
                    });
                    if (match) {
                        appState.launchVersionCustomSelect.setValue(match.id);
                    }
                }
                if (typeof handleLaunch === 'function') {
                    handleLaunch();
                    return '正在启动游戏...';
                }
                return '无法启动游戏';
            }
        },
        {
            name: 'select_version',
            desc: '选择当前启动版本',
            danger: false,
            params: { version: '版本名称或ID' },
            run: function (args) {
                if (typeof appState.launchVersionCustomSelect === 'undefined' || !appState.launchVersionCustomSelect) return '版本选择器未初始化';
                if (typeof appState.installedVersions === 'undefined') return '版本列表未加载';
                var match = appState.installedVersions.find(function (v) {
                    return v.id === args.version ||
                           (v.customName && v.customName.indexOf(args.version) !== -1) ||
                           v.id.indexOf(args.version) !== -1;
                });
                if (match) {
                    appState.launchVersionCustomSelect.setValue(match.id);
                    return '已选择版本：' + (match.customName || match.id);
                }
                return '未找到版本：' + args.version;
            }
        },
        {
            name: 'search_mods',
            desc: '搜索模组',
            danger: false,
            params: { query: '搜索关键词' },
            run: function (args) {
                if (navigateToPage) navigateToPage('mods');
                setTimeout(function () {
                    var searchInput = document.querySelector('#mods-search-input, input[placeholder*="搜索"]');
                    if (searchInput) {
                        searchInput.value = args.query;
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    }
                    import('../mods/mod-browse.js')
                        .then((m) => m.searchMods())
                        .catch((e) => console.error('[island] 模组模块加载失败:', e));
                }, 300);
                return '正在搜索模组：' + args.query;
            }
        },
        {
            name: 'open_version_settings',
            desc: '打开版本设置',
            danger: false,
            params: { version: '版本名称或ID（可选）' },
            run: function (args) {
                var versionId = args.version;
                if (!versionId) {
                    versionId = (typeof appState.currentLaunchVersionId !== 'undefined' && appState.currentLaunchVersionId) ||
                                (typeof appState.launchVersionCustomSelect !== 'undefined' && appState.launchVersionCustomSelect ? appState.launchVersionCustomSelect.getValue() : '');
                }
                if (!versionId) return '请先选择一个版本';
                if (typeof appState.installedVersions !== 'undefined') {
                    var match = appState.installedVersions.find(function (v) {
                        return v.id === versionId || (v.customName && v.customName.indexOf(versionId) !== -1) || v.id.indexOf(versionId) !== -1;
                    });
                    if (match) versionId = match.id;
                }
                import('../versions/version-settings.js')
                    .then((m) => m.openVersionSettings(versionId, versionId))
                    .catch((e) => console.error('[island] 版本设置模块加载失败:', e));
                return '已打开版本设置：' + versionId;
            }
        },
        {
            name: 'get_status',
            desc: '获取当前软件状态',
            danger: false,
            params: {},
            run: function () {
                var status = [];
                if (typeof appState.installedVersions !== 'undefined') {
                    status.push('已安装 ' + appState.installedVersions.length + ' 个版本');
                }
                var activeTaskCount = _getActiveTaskCount();
                if (activeTaskCount > 0) {
                    status.push(activeTaskCount + ' 个下载任务进行中');
                }
                var currentVer = '';
                if (typeof appState.launchVersionCustomSelect !== 'undefined' && appState.launchVersionCustomSelect) {
                    currentVer = appState.launchVersionCustomSelect.getValue();
                }
                if (currentVer) {
                    status.push('当前选中版本：' + currentVer);
                }
                return status.length > 0 ? status.join('，') : '一切正常，没有进行中的任务';
            }
        },
        {
            name: 'check_updates',
            desc: '检查模组更新',
            danger: false,
            params: {},
            run: function () {
                var versionId = (typeof appState.currentLaunchVersionId !== 'undefined' && appState.currentLaunchVersionId) ||
                                (typeof appState.launchVersionCustomSelect !== 'undefined' && appState.launchVersionCustomSelect ? appState.launchVersionCustomSelect.getValue() : '');
                if (!versionId) return '请先选择一个版本';
                import('../versions/version-settings.js')
                    .then((m) => m.checkModUpdatesForVersion())
                    .catch((e) => console.error('[island] 版本设置模块加载失败:', e));
                return '正在检查模组更新...';
            }
        },
        {
            name: 'install_version',
            desc: '下载安装 Minecraft 版本',
            danger: true,
            params: { version: 'Minecraft 版本号，如 1.21.1' },
            run: function (args) {
                if (!args.version) return '请指定要下载的版本号';
                if (navigateToPage) navigateToPage('download');
                setTimeout(function () {
                    var searchInput = document.querySelector('#download-search-input, input[placeholder*="搜索"]');
                    if (searchInput) {
                        searchInput.value = args.version;
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }, 300);
                return '已跳转到下载页面，请搜索 ' + args.version + ' 并点击安装';
            }
        }
    ];
