// 资源页共享状态：分页游标、请求竞态编号与类型名称/图标。
export const resourceState = {
  modpack: { offset: 0, total: 0, query: '' },
  datapack: { offset: 0, total: 0, query: '' },
  resourcepack: { offset: 0, total: 0, query: '' },
  shader: { offset: 0, total: 0, query: '' },
};

// 资源列表请求竞态保护：每次请求递增 _reqId，await 后校验是否为最新请求
// 避免快速切换时旧请求覆盖新请求导致图标/列表错乱
export const _resourceReqId = { modpack: 0, datapack: 0, resourcepack: 0, shader: 0 };

export const typeNames = {
  modpack: '整合包', datapack: '数据包',
  resourcepack: '材质包', shader: '光影包'
};

export const typeIcons = {
  modpack: '📦', datapack: '🗄️',
  resourcepack: '🎨', shader: '☀️'
};
