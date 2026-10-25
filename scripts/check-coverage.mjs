// check-coverage.mjs — 覆盖率棘轮检查
// 用法：node scripts/check-coverage.mjs [--report]
// 读取 coverage/coverage-summary.json，按 core/features/total 三组统计行覆盖率。
// 默认与 scripts/coverage-baseline.json 比较，低于基线即失败；--report 只输出当前数值。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const summaryPath = join(root, 'coverage', 'coverage-summary.json');
const baselinePath = join(root, 'scripts', 'coverage-baseline.json');
const reportOnly = process.argv.includes('--report');

if (!existsSync(summaryPath)) {
  console.error('[覆盖率] 未找到 coverage/coverage-summary.json，请先运行 npm run test:coverage');
  process.exit(1);
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));

function normalize(file) {
  return file.split('\\').join('/');
}

function groupCoverage(needle) {
  let covered = 0;
  let total = 0;
  let files = 0;
  for (const [file, value] of Object.entries(summary)) {
    if (file === 'total') continue;
    if (!normalize(file).includes(needle)) continue;
    covered += value.lines.covered;
    total += value.lines.total;
    files += 1;
  }
  return {
    files,
    lines: total ? Number(((covered / total) * 100).toFixed(2)) : 0,
    covered,
    total,
  };
}

const current = {
  core: groupCoverage('/frontend/src/core/'),
  features: groupCoverage('/frontend/src/features/'),
  total: { lines: summary.total.lines.pct, covered: summary.total.lines.covered, total: summary.total.lines.total },
};

if (reportOnly) {
  console.log('[覆盖率] 当前统计：');
  for (const [name, value] of Object.entries(current)) {
    console.log(`  ${name}: ${value.lines}%（${value.covered}/${value.total} 行）`);
  }
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('[覆盖率] 缺少 scripts/coverage-baseline.json');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const failures = [];
for (const [name, min] of Object.entries(baseline)) {
  const actual = current[name]?.lines ?? 0;
  if (actual + 1e-6 < min.lines) {
    failures.push(`${name} 行覆盖率 ${actual}%，低于基线 ${min.lines}%`);
  }
}

if (failures.length) {
  console.error('[覆盖率] 棘轮检查失败：');
  for (const message of failures) console.error(`  ✗ ${message}`);
  process.exit(1);
}

console.log('[覆盖率] 棘轮检查通过');
for (const [name, value] of Object.entries(current)) {
  console.log(`  ${name}: ${value.lines}%（基线 ${baseline[name]?.lines ?? 0}%）`);
}
