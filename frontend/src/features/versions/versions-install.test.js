// @vitest-environment jsdom
// versions-install.test.js — 版本安装确认、加载器选择与进度轮询单元测试
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { toast, dlManagerMock, loadVersionsMock, navigateToPageMock } = vi.hoisted(() => {
  const tasks = new Map();
  return {
    toast: vi.fn(),
    dlManagerMock: {
      tasks,
      add: vi.fn((id, name, type, sessionId, iconUrl) => {
        tasks.set(id, { id, name, type, sessionId, iconUrl });
      }),
      update: vi.fn(),
      updateDom: vi.fn(),
    },
    loadVersionsMock: vi.fn(async () => {}),
    navigateToPageMock: vi.fn(),
  };
});

vi.mock('../misc/ui-components.js', () => ({ showToast: toast }));
vi.mock('./custom-download.js', () => ({ dlManager: dlManagerMock }));
vi.mock('./versions-list.js', () => ({ loadVersions: loadVersionsMock }));
vi.mock('../../core/navigation.js', () => ({ navigateToPage: navigateToPageMock }));

let mod;
let S;
let appState;
let API;

function buildDom() {
  document.body.innerHTML = `
    <div id="loader-desc-forge"></div>
    <div id="loader-desc-neoforge"></div>
    <div id="loader-desc-fabric"></div>
    <div id="loader-desc-optifine"></div>
    <div class="loader-card" data-loader="forge"></div>
    <div class="loader-card" data-loader="neoforge"></div>
    <div class="loader-card" data-loader="fabric"></div>
    <div class="loader-card" data-loader="optifine"></div>
    <div class="loader-card" data-loader=""></div>
    <div id="loader-version-section" style="display:none"></div>
    <div id="loader-version-list"></div>
    <div id="fabric-api-section-detail" style="display:none"></div>
    <div id="fabric-api-card-text-detail"></div>
    <div id="fabric-api-picker-detail" style="display:none"></div>
    <div id="page-version-detail"></div>
    <div id="pvd-body"></div>
    <div id="pvd-main"></div>
    <div id="pvd-footer"></div>
    <input type="radio" name="download-source" value="bmclapi" checked>
  `;
}

function resetS() {
  S.currentVersionDetail = null;
  S.selectedLoaderType = '';
  S.selectedLoaderVersion = '';
  S._fabricApiDetailId = '';
  S._fabricApiDetailText = '不安装';
  S._fabricApiDetailLoadedFor = '';
  S._fabricApiDetailVersions = [];
  S._pendingFabricApiAfterInstall = null;
  appState.currentInstallSessionId = null;
}

async function settle(times = 2) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeAll(async () => {
  vi.resetModules();
  ({ versionsState: S } = await import('./versions-state.js'));
  ({ appState } = await import('../../core/app-state.js'));
  ({ API } = await import('../../core/api.js'));
  mod = await import('./versions-install.js');
});

beforeEach(() => {
  buildDom();
  resetS();
  localStorage.clear();
  toast.mockClear();
  dlManagerMock.tasks.clear();
  dlManagerMock.add.mockClear();
  dlManagerMock.update.mockClear();
  dlManagerMock.updateDom.mockClear();
  loadVersionsMock.mockClear();
  navigateToPageMock.mockClear();
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(API, 'getModLoaderVersions').mockResolvedValue([]);
  vi.spyOn(API, 'checkVersionName').mockResolvedValue({ available: true });
  vi.spyOn(API, 'installVersion').mockResolvedValue({ success: true, sessionId: 's1' });
  vi.spyOn(API, 'installFabricApi').mockResolvedValue({ success: true });
  vi.spyOn(API, 'getInstallProgress').mockResolvedValue(null);
  vi.spyOn(API, 'cancelInstall').mockResolvedValue({ success: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.__TAURI__;
  document.body.innerHTML = '';
});

describe('getStageText', () => {
  it('覆盖所有阶段文案', () => {
    expect(mod.getStageText('preparing')).toBe('准备中...');
    expect(mod.getStageText('version_json')).toBe('下载版本信息...');
    expect(mod.getStageText('client_jar')).toBe('下载游戏客户端...');
    expect(mod.getStageText('libraries')).toBe('下载依赖库...');
    expect(mod.getStageText('assets')).toBe('下载资源文件...');
    expect(mod.getStageText('natives')).toBe('提取原生库...');
    expect(mod.getStageText('finalizing')).toBe('完成安装...');
    expect(mod.getStageText('loader')).toBe('安装模组加载器...');
    expect(mod.getStageText('fabric-api')).toBe('下载 Fabric API...');
    expect(mod.getStageText('completed')).toBe('安装完成');
    expect(mod.getStageText('failed')).toBe('安装失败');
    expect(mod.getStageText('cancelled')).toBe('已取消');
  });

  it('未知阶段原样返回，空值返回空串', () => {
    expect(mod.getStageText('custom-stage')).toBe('custom-stage');
    expect(mod.getStageText('')).toBe('');
    expect(mod.getStageText(undefined)).toBe('');
  });
});

describe('loadLoaderVersions', () => {
  it('展示各加载器最新版本', async () => {
    API.getModLoaderVersions.mockImplementation(async (versionId, loader) => {
      if (loader === 'forge') return [{ version: '47.2.0' }];
      if (loader === 'fabric') return [{ id: '0.15.0' }];
      if (loader === 'neoforge') return ['20.4'];
      return [{ version: 'HD U H1' }];
    });

    await mod.loadLoaderVersions('1.20.1');

    expect(document.getElementById('loader-desc-forge').textContent).toBe('Forge 47.2.0 可用');
    expect(document.getElementById('loader-desc-neoforge').textContent).toBe('NeoForge 20.4 可用');
    expect(document.getElementById('loader-desc-fabric').textContent).toBe('Fabric 0.15.0 可用');
    expect(document.getElementById('loader-desc-optifine').textContent).toBe('OptiFine HD U H1 可用');
  });

  it('新版本号未适配 Forge/NeoForge', async () => {
    await mod.loadLoaderVersions('25.1');

    expect(document.getElementById('loader-desc-forge').textContent).toBe('此版本暂未适配');
    expect(document.getElementById('loader-desc-neoforge').textContent).toBe('此版本暂未适配');
    expect(document.getElementById('loader-desc-fabric').textContent).toBe('暂无可用版本');
  });

  it('OptiFine 无版本时提示暂不支持', async () => {
    await mod.loadLoaderVersions('1.20.1');

    expect(document.getElementById('loader-desc-optifine').textContent).toBe('暂不支持此版本');
  });

  it('其他加载器无版本时提示暂无可用版本', async () => {
    await mod.loadLoaderVersions('1.20.1');

    expect(document.getElementById('loader-desc-forge').textContent).toBe('暂无可用版本');
  });

  it('单个加载器查询失败时展示加载失败', async () => {
    API.getModLoaderVersions.mockImplementation(async (versionId, loader) => {
      if (loader === 'forge') throw new Error('offline');
      return [];
    });

    await mod.loadLoaderVersions('1.20.1');

    expect(document.getElementById('loader-desc-forge').textContent).toBe('加载失败');
    expect(console.error).toHaveBeenCalled();
  });

  it('缺少描述元素时跳过对应加载器', async () => {
    document.getElementById('loader-desc-forge').remove();

    await mod.loadLoaderVersions('1.20.1');

    const loaders = API.getModLoaderVersions.mock.calls.map((call) => call[1]);
    expect(loaders).not.toContain('forge');
    expect(loaders).toContain('fabric');
  });
});

describe('selectLoaderCard', () => {
  it('选中加载器并加载版本列表', async () => {
    S.currentVersionDetail = { id: '1.20.1' };
    API.getModLoaderVersions.mockResolvedValue([{ version: '47.2.0' }]);

    mod.selectLoaderCard('forge');
    await settle();

    expect(S.selectedLoaderType).toBe('forge');
    expect(document.querySelector('.loader-card[data-loader="forge"]').classList.contains('selected')).toBe(true);
    expect(document.querySelector('.loader-card[data-loader="fabric"]').classList.contains('selected')).toBe(false);
    expect(document.getElementById('loader-version-section').style.display).toBe('block');
    expect(S.selectedLoaderVersion).toBe('47.2.0');
  });

  it('选择空加载器时隐藏版本区域', () => {
    S.selectedLoaderVersion = 'old';

    mod.selectLoaderCard('');

    expect(S.selectedLoaderVersion).toBe('');
    expect(document.getElementById('loader-version-section').style.display).toBe('none');
    expect(dlManagerMock.add).not.toHaveBeenCalled();
  });

  it('Fabric 时重置 API 选择区', () => {
    S.currentVersionDetail = { id: '1.20.1' };
    S._fabricApiDetailId = 'old';
    S._fabricApiDetailVersions = [{ versionId: 'x' }];

    mod.selectLoaderCard('fabric');

    expect(document.getElementById('fabric-api-section-detail').style.display).toBe('');
    expect(S._fabricApiDetailId).toBe('');
    expect(S._fabricApiDetailText).toBe('不安装');
    expect(S._fabricApiDetailVersions).toEqual([]);
    expect(document.getElementById('fabric-api-card-text-detail').textContent).toBe('不安装');
  });

  it('非 Fabric 时隐藏 API 区并复位容器', () => {
    S.currentVersionDetail = { id: '1.20.1' };
    document.getElementById('fabric-api-section-detail').style.display = '';
    document.getElementById('pvd-body').style.display = 'none';
    document.getElementById('pvd-main').style.display = 'none';
    document.getElementById('pvd-footer').style.display = 'none';
    const picker = document.getElementById('fabric-api-picker-detail');
    document.body.appendChild(picker);
    picker.style.display = 'block';

    mod.selectLoaderCard('forge');

    expect(document.getElementById('fabric-api-section-detail').style.display).toBe('none');
    expect(picker.style.display).toBe('none');
    expect(picker.parentElement).toBe(document.getElementById('page-version-detail'));
    expect(document.getElementById('pvd-body').style.display).toBe('');
    expect(document.getElementById('pvd-main').style.display).toBe('');
    expect(document.getElementById('pvd-footer').style.display).toBe('');
  });
});

describe('populateLoaderVersionSelect', () => {
  it('渲染版本项并选中首个', async () => {
    S.currentVersionDetail = { id: '1.20.1' };
    API.getModLoaderVersions.mockResolvedValue([
      { version: '47.2.0', type: '推荐' },
      { version: '47.1.0' },
    ]);

    await mod.populateLoaderVersionSelect('forge');

    const items = document.querySelectorAll('.lver-item');
    expect(items).toHaveLength(2);
    expect(items[0].classList.contains('selected')).toBe(true);
    expect(items[0].getAttribute('data-version')).toBe('47.2.0');
    expect(items[0].getAttribute('data-action')).toBe('selectLoaderVersion');
    expect(document.getElementById('loader-version-list').textContent).toContain('Forge 47.2.0');
    expect(document.getElementById('loader-version-list').textContent).toContain('推荐');
    expect(S.selectedLoaderVersion).toBe('47.2.0');
  });

  it('字符串版本与未知加载器图标', async () => {
    S.currentVersionDetail = { id: '1.20.1' };
    API.getModLoaderVersions.mockResolvedValue(['1.0.0']);

    await mod.populateLoaderVersionSelect('unknown');

    expect(document.getElementById('loader-version-list').textContent).toContain('unknown 1.0.0');
    expect(document.querySelector('.lver-icon img').getAttribute('src')).toBe('img/Grass.png');
    expect(S.selectedLoaderVersion).toBe('1.0.0');
  });

  it('无版本时展示空状态', async () => {
    S.currentVersionDetail = { id: '1.20.1' };

    await mod.populateLoaderVersionSelect('forge');

    expect(document.getElementById('loader-version-list').textContent).toBe('暂无可用版本');
    expect(S.selectedLoaderVersion).toBe('');
  });

  it('查询失败时展示错误', async () => {
    S.currentVersionDetail = { id: '1.20.1' };
    API.getModLoaderVersions.mockRejectedValue(new Error('boom'));

    await mod.populateLoaderVersionSelect('forge');

    expect(document.getElementById('loader-version-list').textContent).toBe('加载失败');
    expect(S.selectedLoaderVersion).toBe('');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('selectLoaderVersion', () => {
  it('更新选中项', () => {
    S.currentVersionDetail = { id: '1.20.1' };
    document.getElementById('loader-version-list').innerHTML = `
      <div class="lver-item selected" data-version="a"></div>
      <div class="lver-item" data-version="b"></div>
    `;

    mod.selectLoaderVersion('b');

    expect(S.selectedLoaderVersion).toBe('b');
    expect(document.querySelector('.lver-item[data-version="b"]').classList.contains('selected')).toBe(true);
    expect(document.querySelector('.lver-item[data-version="a"]').classList.contains('selected')).toBe(false);
  });

  it('目标项不存在时安全返回', () => {
    expect(() => mod.selectLoaderVersion('missing')).not.toThrow();
  });
});

describe('confirmInstallVersion', () => {
  beforeEach(() => {
    S.currentVersionDetail = { id: '1.20.1', url: 'https://example.com/1.20.1.json' };
  });

  it('没有详情时直接返回', () => {
    S.currentVersionDetail = null;

    mod.confirmInstallVersion();

    expect(document.getElementById('version-name-modal')).toBeNull();
  });

  it('无加载器时使用版本号作为默认名', async () => {
    mod.confirmInstallVersion();
    await settle();

    expect(document.getElementById('version-name-modal')).not.toBeNull();
    expect(document.getElementById('vnm-input').value).toBe('1.20.1');
  });

  it('选中加载器但版本为空时提示', () => {
    S.selectedLoaderType = 'forge';
    S.selectedLoaderVersion = '';

    mod.confirmInstallVersion();

    expect(toast).toHaveBeenCalledWith('获取Forge版本失败，请重新点击Forge卡片再试', 'error');
    expect(document.getElementById('version-name-modal')).toBeNull();
  });

  it('加载器版本拼入默认名称', async () => {
    S.selectedLoaderType = 'forge';
    S.selectedLoaderVersion = '47.2.0';

    mod.confirmInstallVersion();
    await settle();

    expect(document.getElementById('vnm-input').value).toBe('1.20.1-Forge-47.2.0');
  });

  it('NeoForge 使用专用后缀', async () => {
    S.selectedLoaderType = 'neoforge';
    S.selectedLoaderVersion = '20.4';

    mod.confirmInstallVersion();
    await settle();

    expect(document.getElementById('vnm-input').value).toBe('1.20.1-NeoForge-20.4');
  });

  it('Fabric API 选中项写入安装信息', async () => {
    S.selectedLoaderType = 'fabric';
    S.selectedLoaderVersion = '0.15.0';
    S._fabricApiDetailId = 'api1';
    S._fabricApiDetailVersions = [{ versionId: 'api1', url: 'https://api.jar', filename: 'fabric-api.jar' }];

    mod.confirmInstallVersion();
    await settle();
    document.getElementById('vnm-input').value = '自定义';
    await settle();

    const install = API.installVersion;

    document.getElementById('vnm-confirm').click();
    await vi.advanceTimersByTimeAsync(200);

    expect(install).toHaveBeenCalledWith(
      'https://example.com/1.20.1.json',
      '1.20.1',
      {
        type: 'fabric',
        version: '0.15.0',
        fabricApiId: 'api1',
        fabricApiUrl: 'https://api.jar',
        fabricApiFilename: 'fabric-api.jar',
      },
      'bmclapi',
      '自定义',
    );
  });
});

describe('showVersionNameModal', () => {
  async function open(defaultName = '1.20.1') {
    mod.showVersionNameModal(defaultName, 'url', '1.20.1', null, 'mojang');
    await settle();
    return document.getElementById('version-name-modal');
  }

  it('移除旧弹窗后重建', async () => {
    const old = document.createElement('div');
    old.id = 'version-name-modal';
    document.body.appendChild(old);

    const modal = await open();

    expect(modal).not.toBe(old);
    expect(document.querySelectorAll('#version-name-modal')).toHaveLength(1);
  });

  it('名称可用时允许确认', async () => {
    const modal = await open();

    expect(document.getElementById('vnm-hint').textContent).toBe('✓ 名称可用');
    expect(document.getElementById('vnm-confirm').disabled).toBe(false);
    expect(document.getElementById('vnm-warn').style.display).toBe('none');
    expect(modal.querySelector('#vnm-input')).not.toBeNull();
  });

  it('名称不可用时禁用确认并提示原因', async () => {
    API.checkVersionName.mockResolvedValue({ available: false, reason: '名称已存在' });
    const modal = await open();

    expect(document.getElementById('vnm-warn').style.display).toBe('block');
    expect(document.getElementById('vnm-warn').textContent).toContain('名称已存在');
    expect(document.getElementById('vnm-confirm').disabled).toBe(true);
    expect(document.getElementById('vnm-confirm').style.opacity).toBe('0.5');
    expect(modal).not.toBeNull();
  });

  it('名称检查异常时允许确认', async () => {
    API.checkVersionName.mockRejectedValue(new Error('offline'));
    await open();

    expect(document.getElementById('vnm-confirm').disabled).toBe(false);
    expect(document.getElementById('vnm-confirm').style.cursor).toBe('pointer');
  });

  it('空名称禁用确认', async () => {
    await open();
    const input = document.getElementById('vnm-input');
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    await settle();

    expect(document.getElementById('vnm-hint').textContent).toBe('');
    expect(document.getElementById('vnm-warn').style.display).toBe('none');
    expect(document.getElementById('vnm-confirm').disabled).toBe(true);
  });

  it('回车触发确认', async () => {
    await open();
    S.currentVersionDetail = null;
    const confirm = document.getElementById('vnm-confirm');
    const click = vi.spyOn(confirm, 'click').mockImplementation(() => {});

    document.getElementById('vnm-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(click).toHaveBeenCalled();
  });

  it('禁用时回车不触发确认', async () => {
    await open();
    const confirm = document.getElementById('vnm-confirm');
    confirm.disabled = true;
    const click = vi.spyOn(confirm, 'click').mockImplementation(() => {});

    document.getElementById('vnm-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(click).not.toHaveBeenCalled();
  });

  it('关闭、取消与点击遮罩都会移除弹窗', async () => {
    await open();
    document.getElementById('vnm-close').click();
    expect(document.getElementById('version-name-modal')).toBeNull();

    await open();
    document.getElementById('vnm-cancel').click();
    expect(document.getElementById('version-name-modal')).toBeNull();

    const modal = await open();
    modal.click();
    expect(document.getElementById('version-name-modal')).toBeNull();
  });

  it('确认后跳转版本页并延迟安装', async () => {
    await open();
    document.getElementById('vnm-input').value = 'My Version';
    await settle();
    document.getElementById('vnm-confirm').click();

    expect(document.getElementById('version-name-modal')).toBeNull();
    expect(navigateToPageMock).toHaveBeenCalledWith('versions');
    expect(API.installVersion).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(API.installVersion).toHaveBeenCalledWith('url', '1.20.1', null, 'mojang', 'My Version');
  });

  it('空名称确认不执行安装', async () => {
    await open();
    const input = document.getElementById('vnm-input');
    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    await settle();
    document.getElementById('vnm-confirm').click();
    await vi.advanceTimersByTimeAsync(200);

    expect(API.installVersion).not.toHaveBeenCalled();
    expect(navigateToPageMock).not.toHaveBeenCalled();
  });
});

describe('installVersionWithLoader / installVersion', () => {
  it('带加载器安装成功后加入下载任务并轮询', async () => {
    API.installVersion.mockResolvedValue({ success: true, sessionId: 's1' });
    const loaderInfo = { type: 'fabric', version: '0.15.0', fabricApiId: 'api1', fabricApiUrl: 'u', fabricApiFilename: 'f' };

    await mod.installVersionWithLoader('url', '1.20.1', loaderInfo, 'mojang', '自定义');

    expect(API.installVersion).toHaveBeenCalledWith('url', '1.20.1', loaderInfo, 'mojang', '自定义');
    expect(appState.currentInstallSessionId).toBe('s1');
    expect(S._pendingFabricApiAfterInstall).toEqual({
      gameVersion: '1.20.1',
      apiId: 'api1',
      url: 'u',
      filename: 'f',
      versionId: '',
    });
    expect(dlManagerMock.add).toHaveBeenCalledWith('version-s1', '安装 1.20.1', 'version', 's1', expect.stringContaining('/api/version-icon'));
  });

  it('无 Fabric API 时清空待安装信息', async () => {
    S._pendingFabricApiAfterInstall = { apiId: 'old' };

    await mod.installVersionWithLoader('url', '1.20.1', { type: 'forge', version: '1' }, 'mojang');

    expect(S._pendingFabricApiAfterInstall).toBeNull();
  });

  it('已安装时提示', async () => {
    API.installVersion.mockResolvedValue({ alreadyInstalled: true, message: '已有同名版本' });

    await mod.installVersionWithLoader('url', '1.20.1', null, 'mojang');

    expect(toast).toHaveBeenCalledWith('已有同名版本', 'info');
    expect(dlManagerMock.add).not.toHaveBeenCalled();
  });

  it('已安装但无文案时使用默认提示', async () => {
    API.installVersion.mockResolvedValue({ alreadyInstalled: true });

    await mod.installVersionWithLoader('url', '1.20.1', null, 'mojang');

    expect(toast).toHaveBeenCalledWith('版本 1.20.1 已安装', 'info');
  });

  it('安装失败时提示接口错误', async () => {
    API.installVersion.mockResolvedValue({ error: '磁盘不足' });

    await mod.installVersionWithLoader('url', '1.20.1', null, 'mojang');

    expect(toast).toHaveBeenCalledWith('磁盘不足', 'error');
  });

  it('安装请求异常时提示', async () => {
    API.installVersion.mockRejectedValue(new Error('network'));

    await mod.installVersionWithLoader('url', '1.20.1', null, 'mojang');

    expect(toast).toHaveBeenCalledWith('安装请求失败', 'error');
  });

  it('普通安装成功', async () => {
    API.installVersion.mockResolvedValue({ success: true, sessionId: 's2' });

    await mod.installVersion('url', '1.20.2');

    expect(API.installVersion).toHaveBeenCalledWith('url', '1.20.2');
    expect(appState.currentInstallSessionId).toBe('s2');
    expect(dlManagerMock.add).toHaveBeenCalledWith('version-s2', '安装 1.20.2', 'version', 's2', expect.any(String));
  });

  it('普通安装已存在', async () => {
    API.installVersion.mockResolvedValue({ alreadyInstalled: true });

    await mod.installVersion('url', '1.20.2');

    expect(toast).toHaveBeenCalledWith('版本 1.20.2 已安装', 'info');
  });

  it('普通安装失败与异常', async () => {
    API.installVersion.mockResolvedValueOnce({ error: 'no space' });

    await mod.installVersion('url', '1.20.2');
    expect(toast).toHaveBeenCalledWith('no space', 'error');

    API.installVersion.mockRejectedValueOnce(new Error('network'));
    await mod.installVersion('url', '1.20.2');
    expect(toast).toHaveBeenCalledWith('安装请求失败', 'error');
  });
});

describe('showInstallModal / 取消', () => {
  it('加入下载任务并异步替换版本图标', async () => {
    appState.currentInstallSessionId = 's3';
    window.__TAURI__ = {
      core: { invoke: vi.fn(async () => ({ success: true, data_url: 'data:image/png;base64,AA' })) },
    };
    dlManagerMock.tasks.set('version-s3', { iconUrl: 'old' });

    mod.showInstallModal('1.20.1');
    await settle(3);

    expect(window.__TAURI__.core.invoke).toHaveBeenCalledWith('get_version_icon', expect.objectContaining({ id: '1.20.1' }));
    expect(dlManagerMock.tasks.get('version-s3').iconUrl).toBe('data:image/png;base64,AA');
    expect(dlManagerMock.updateDom).toHaveBeenCalledWith('version-s3');
  });

  it('图标查询失败时静默', async () => {
    appState.currentInstallSessionId = 's4';
    window.__TAURI__ = { core: { invoke: vi.fn(async () => { throw new Error('no'); }) } };

    mod.showInstallModal('1.20.1');
    await settle(3);

    expect(dlManagerMock.add).toHaveBeenCalled();
    expect(dlManagerMock.updateDom).not.toHaveBeenCalled();
  });

  it('关闭弹窗会取消安装会话', () => {
    appState.currentInstallSessionId = 's5';

    mod.closeInstallModal();

    expect(API.cancelInstall).toHaveBeenCalledWith('s5');
    expect(appState.currentInstallSessionId).toBeNull();
  });

  it('无会话时关闭不调用接口', () => {
    mod.closeInstallModal();

    expect(API.cancelInstall).not.toHaveBeenCalled();
  });

  it('取消安装同时提示', () => {
    appState.currentInstallSessionId = 's6';

    mod.cancelInstall();

    expect(API.cancelInstall).toHaveBeenCalledWith('s6');
    expect(toast).toHaveBeenCalledWith('安装已取消', 'info');
  });
});

describe('pollInstallProgress', () => {
  const base = {
    sessionId: 's1',
    progress: 80,
    status: 'downloading',
    stage: 'libraries',
    currentFile: 'client.jar',
    speed: 1024,
    totalFiles: 10,
    completedFiles: 5,
    bytesDownloaded: 2048,
    totalBytes: 4096,
    versionId: '1.20.1',
  };

  it('任务不存在时不查询', async () => {
    await mod.pollInstallProgress('s1');
    await settle();

    expect(API.getInstallProgress).not.toHaveBeenCalled();
  });

  it('无会话数据时停止', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    API.getInstallProgress.mockResolvedValue(null);

    await mod.pollInstallProgress('s1');
    await settle();

    expect(API.getInstallProgress).toHaveBeenCalledWith('s1');
    expect(dlManagerMock.update).not.toHaveBeenCalled();
  });

  it('下载中更新进度与文件明细', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    API.getInstallProgress.mockResolvedValue(base);

    await mod.pollInstallProgress('s1');
    await settle();

    const update = dlManagerMock.update.mock.calls[0];
    expect(update[0]).toBe('version-s1');
    expect(update[1].progress).toBe(12);
    expect(update[1].status).toBe('downloading');
    expect(update[1].message).toBe('下载依赖库...');
    expect(update[1].files).toHaveLength(4);
    expect(update[1].files[0]).toEqual({
      name: '当前文件: client.jar',
      progress: 50,
      status: 'downloading',
      size: '1.0 KB/s',
    });
    expect(update[1].files[1].name).toBe('文件进度: 5 / 10');
    expect(update[1].files[2].name).toBe('下载量: 2.0 KB / 4.0 KB');
    expect(update[1].files[3]).toEqual({
      name: '当前阶段: 下载依赖库...',
      progress: 12,
      status: 'downloading',
    });
  });

  it('无 stage 时使用接口消息或默认文案', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    API.getInstallProgress.mockResolvedValue({ sessionId: 's1', progress: 10, status: 'downloading', message: '拉取元数据' });

    await mod.pollInstallProgress('s1');
    await settle();

    expect(dlManagerMock.update.mock.calls[0][1].message).toBe('拉取元数据');
  });

  it('完成时提示、清空会话并刷新版本列表', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    API.getInstallProgress.mockResolvedValue({ sessionId: 's1', progress: 100, status: 'completed', stage: 'completed', versionId: '1.20.1' });

    await mod.pollInstallProgress('s1');
    await settle(4);

    expect(toast).toHaveBeenCalledWith('1.20.1 安装完成！', 'success');
    expect(appState.currentInstallSessionId).toBeNull();
    expect(loadVersionsMock).toHaveBeenCalledWith(true);
    expect(dlManagerMock.update.mock.calls[0][1].files).toEqual([
      { name: '当前阶段: 安装完成', progress: 100, status: 'completed' },
    ]);
  });

  it('完成后自动安装待处理 Fabric API', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    S._pendingFabricApiAfterInstall = { gameVersion: '1.20.1', apiId: 'api1', url: 'u', filename: 'f' };
    API.getInstallProgress.mockResolvedValue({ sessionId: 's1', progress: 100, status: 'completed', versionId: '1.20.1' });
    API.installFabricApi.mockResolvedValue({ success: true });

    await mod.pollInstallProgress('s1');
    await settle(6);

    expect(API.installFabricApi).toHaveBeenCalledWith('1.20.1', 'api1', '1.20.1', 'u', 'f');
    expect(toast).toHaveBeenCalledWith('Fabric API 已一并安装！', 'success');
    expect(S._pendingFabricApiAfterInstall).toBeNull();
  });

  it('Fabric API 安装失败时警告', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    S._pendingFabricApiAfterInstall = { gameVersion: '1.20.1', apiId: 'api1' };
    API.getInstallProgress.mockResolvedValue({ sessionId: 's1', progress: 100, status: 'completed', versionId: '1.20.1' });
    API.installFabricApi.mockResolvedValue({ success: false, error: '冲突' });

    await mod.pollInstallProgress('s1');
    await settle(6);

    expect(toast).toHaveBeenCalledWith('Fabric API 安装失败：冲突', 'warning', 5000);
  });

  it('Fabric API 安装异常时警告', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    S._pendingFabricApiAfterInstall = { gameVersion: '1.20.1', apiId: 'api1' };
    API.getInstallProgress.mockResolvedValue({ sessionId: 's1', progress: 100, status: 'completed', versionId: '1.20.1' });
    API.installFabricApi.mockRejectedValue(new Error('offline'));

    await mod.pollInstallProgress('s1');
    await settle(6);

    expect(toast).toHaveBeenCalledWith('Fabric API 安装失败：offline', 'warning', 5000);
  });

  it('失败时提示并停止', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    API.getInstallProgress.mockResolvedValue({ sessionId: 's1', progress: 30, status: 'failed', message: '校验失败' });

    await mod.pollInstallProgress('s1');
    await settle();

    expect(toast).toHaveBeenCalledWith('安装失败: 校验失败', 'error');
    expect(appState.currentInstallSessionId).toBeNull();
    expect(dlManagerMock.update.mock.calls[0][1]).toMatchObject({ status: 'failed', message: '校验失败', progress: 5 });
  });

  it('取消状态标记失败并停止', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    API.getInstallProgress.mockResolvedValue({ sessionId: 's1', progress: 20, status: 'cancelled' });

    await mod.pollInstallProgress('s1');
    await settle();

    expect(appState.currentInstallSessionId).toBeNull();
    expect(dlManagerMock.update.mock.calls.at(-1)[1]).toMatchObject({ status: 'failed', message: '已取消' });
  });

  it('未完成时每 500ms 继续轮询', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    API.getInstallProgress
      .mockResolvedValueOnce({ sessionId: 's1', progress: 20, status: 'downloading' })
      .mockResolvedValueOnce({ sessionId: 's1', progress: 100, status: 'completed', versionId: '1.20.1' });

    await mod.pollInstallProgress('s1');
    await settle();
    expect(API.getInstallProgress).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await settle(4);

    expect(API.getInstallProgress).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith('1.20.1 安装完成！', 'success');
  });

  it('连续查询失败超过五次后停止轮询', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    API.getInstallProgress.mockRejectedValue(new Error('timeout'));

    await mod.pollInstallProgress('s1');
    await settle();
    await vi.advanceTimersByTimeAsync(5000);
    await settle(3);

    expect(API.getInstallProgress).toHaveBeenCalledTimes(6);
    expect(dlManagerMock.update).toHaveBeenCalledWith('version-s1', { status: 'failed', message: '进度查询失败' });
    expect(appState.currentInstallSessionId).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('失败未超过阈值时继续重试', async () => {
    dlManagerMock.tasks.set('version-s1', {});
    API.getInstallProgress
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ sessionId: 's1', progress: 100, status: 'completed', versionId: '1.20.1' });

    await mod.pollInstallProgress('s1');
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle(4);

    expect(API.getInstallProgress).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith('1.20.1 安装完成！', 'success');
  });
});
