// check-test-density.mjs — 测试密度棘轮检查
// 用法：node scripts/check-test-density.mjs [--report]
// 统计 frontend/src 下各业务域的测试文件数与用例数，低于 scripts/test-density-baseline.json 即失败。
// 用例数按 it(...) / test(...) 声明计数，用于阻止测试被删除或域覆盖率倒退。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const srcDir = join(root, 'frontend', 'src');
const baselinePath = join(root, 'scripts', 'test-density-baseline.json');
const reportOnly = process.argv.includes('--report');

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function domainOf(file) {
  const rel = relative(srcDir, file).split('\\').join('/');
  const parts = rel.split('/');
  if (parts[0] === 'core') return 'core';
  if (parts[0] === 'features' && parts[1]) return `features/${parts[1]}`;
  return 'other';
}

const stats = {};
for (const file of walk(srcDir)) {
  if (!file.endsWith('.test.js')) continue;
  const domain = domainOf(file);
  const text = readFileSync(file, 'utf8');
  const cases = [...text.matchAll(/\b(?:it|test)\(\s*['"`]/g)].length;
  stats[domain] ||= { files: 0, cases: 0 };
  stats[domain].files += 1;
  stats[domain].cases += cases;
}

const ordered = Object.fromEntries(Object.entries(stats).sort(([a], [b]) => a.localeCompare(b)));

if (reportOnly) {
  console.log('[测试密度] 当前统计：');
  for (const [domain, value] of Object.entries(ordered)) {
    console.log(`  ${domain}: ${value.files} 个文件 / ${value.cases} 个用例`);
  }
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('[测试密度] 缺少 scripts/test-density-baseline.json');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const failures = [];
for (const [domain, min] of Object.entries(baseline)) {
  const actual = ordered[domain] || { files: 0, cases: 0 };
  if (actual.files < min.files) {
    failures.push(`${domain} 测试文件 ${actual.files} 个，低于基线 ${min.files}`);
  }
  if (actual.cases < min.cases) {
    failures.push(`${domain} 测试用例 ${actual.cases} 个，低于基线 ${min.cases}`);
  }
}

if (failures.length) {
  console.error('[测试密度] 棘轮检查失败：');
  for (const message of failures) console.error(`  ✗ ${message}`);
  process.exit(1);
}

console.log('[测试密度] 棘轮检查通过');
for (const [domain, value] of Object.entries(ordered)) {
  const min = baseline[domain] || { files: 0, cases: 0 };
  console.log(`  ${domain}: ${value.files} 个文件 / ${value.cases} 个用例（基线 ${min.files}/${min.cases}）`);
}
