// @vitest-environment jsdom
// features/versions/vset-repair.test.js — 修复阶段文案映射单元测试
import { describe, expect, it } from 'vitest';
import { getRepairStageText } from './vset-repair-stages.js';

describe('getRepairStageText', () => {
  it('已知阶段返回中文文案', () => {
    expect(getRepairStageText('preparing')).toBe('准备修复...');
    expect(getRepairStageText('scanning')).toBe('扫描库文件...');
    expect(getRepairStageText('complete')).toBe('修复完成');
    expect(getRepairStageText('failed')).toBe('修复失败');
  });

  it('覆盖目录、解析、客户端与下载阶段', () => {
    expect(getRepairStageText('directories')).toBe('检查目录结构...');
    expect(getRepairStageText('resolve')).toBe('解析版本信息...');
    expect(getRepairStageText('client_jar')).toBe('检查客户端JAR...');
    expect(getRepairStageText('downloading')).toBe('下载缺失文件...');
    expect(getRepairStageText('cancelled')).toBe('已取消');
  });

  it('未知阶段回退为原值或空串', () => {
    expect(getRepairStageText('custom-stage')).toBe('custom-stage');
    expect(getRepairStageText('')).toBe('');
    expect(getRepairStageText(null)).toBe('');
  });
});
