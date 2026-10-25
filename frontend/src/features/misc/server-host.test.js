// @vitest-environment jsdom
// server-host.test.js — 开服页 HTML 转义与状态组件单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _shGetCreateInputs,
  _shLoaderChip,
  _shStatusBadge,
  escapeHtmlAttr,
  escapeHtmlText,
} from './server-host.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('escapeHtmlText', () => {
  it('转义文本中的 HTML 特殊字符', () => {
    expect(escapeHtmlText('<script>&"')).toBe('&lt;script&gt;&amp;&quot;');
  });

  it('非字符串输入自动转字符串', () => {
    expect(escapeHtmlText(123)).toBe('123');
    expect(escapeHtmlText(null)).toBe('null');
  });
});

describe('escapeHtmlAttr', () => {
  it('在文本转义基础上处理单引号', () => {
    expect(escapeHtmlAttr(`a'b`)).toBe('a&#39;b');
  });
});

describe('状态徽章与加载器标签', () => {
  it('已知状态映射为中文与颜色', () => {
    expect(_shStatusBadge('running')).toContain('运行中');
    expect(_shStatusBadge('running')).toContain('#22c55e');
    expect(_shStatusBadge('unknown')).toContain('已停止');
  });

  it('加载器标签区分原版与模组加载器', () => {
    expect(_shLoaderChip('vanilla')).toContain('原版');
    expect(_shLoaderChip('forge', '47.2.0')).toContain('Forge 47.2.0');
    expect(_shLoaderChip('neoforge')).toContain('NeoForge');
    expect(_shLoaderChip('fabric')).toContain('Fabric');
  });
});

describe('_shGetCreateInputs', () => {
  it('读取表单并应用默认值', () => {
    document.body.innerHTML = `
      <input id="server-host-name" value="" />
      <input id="server-host-port" value="26666" />
      <input id="server-host-mem" value="" />
    `;
    expect(_shGetCreateInputs()).toMatchObject({
      name: 'MyServer',
      port: 26666,
      maxMem: 2048,
      onlineMode: true,
      syncMods: true,
    });
  });

  it('未勾选时关闭在线模式与模组同步', () => {
    document.body.innerHTML = `
      <input id="server-host-online" type="checkbox" />
      <input id="server-host-sync-mods" type="checkbox" />
    `;
    expect(_shGetCreateInputs()).toMatchObject({
      onlineMode: false,
      syncMods: false,
    });
  });

  it('读取显式名称与开启选项', () => {
    document.body.innerHTML = `
      <input id="server-host-name" value="测试服" />
      <input id="server-host-port" value="25565" />
      <input id="server-host-mem" value="4096" />
      <input id="server-host-online" type="checkbox" checked />
      <input id="server-host-sync-mods" type="checkbox" checked />
    `;
    expect(_shGetCreateInputs()).toMatchObject({
      name: '测试服',
      maxMem: 4096,
      onlineMode: true,
      syncMods: true,
    });
  });
});
