// vset-repair-stages.js — 版本修复阶段文案（纯函数）
export function getRepairStageText(stage) {
  const map = {
    preparing: '准备修复...',
    directories: '检查目录结构...',
    resolve: '解析版本信息...',
    scanning: '扫描库文件...',
    client_jar: '检查客户端JAR...',
    downloading: '下载缺失文件...',
    complete: '修复完成',
    failed: '修复失败',
    cancelled: '已取消',
  };
  return map[stage] || stage || '';
}
