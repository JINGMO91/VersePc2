// check-architecture.mjs — 架构护栏检查
// 用法：node scripts/check-architecture.mjs [--strict]
// 默认只输出报告；--strict 时把违规项作为错误退出，供 CI 使用。

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const errors = [];
const warnings = [];

function trackedFiles(dir) {
  try {
    const out = execSync(`git ls-files "${dir}"`, { encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function countLines(file) {
  const text = readFileSync(file, 'utf8');
  return text.split('\n').length;
}

// 1. 生成目录不得被 Git 跟踪
for (const dir of ['frontend-tauri', 'frontend-dist']) {
  const files = trackedFiles(dir);
  if (files.length > 0) {
    errors.push(`${dir} 仍被 Git 跟踪（${files.length} 个文件），应改为构建生成物`);
  }
}

// 2. index.html 业务脚本数量
const htmlPath = join(root, 'frontend', 'index.html');
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*\bsrc\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const isVendor = (src) =>
    /(^|\/)(three[^/]*\.bundle\.js|three-glb[^/]*\.bundle\.js|skinview3d[^/]*\.bundle\.js|vue\.global\.prod\.js|marked\.min\.js)$/.test(src);
  const business = scripts.filter((s) => !isVendor(s));
  if (business.length > 1) {
    errors.push(`frontend/index.html 仍有 ${business.length} 个业务脚本标签，目标为 1 个模块入口`);
  }
}

// 3. window.* 赋值只允许集中在 legacy 过渡层
const jsRoots = [join(root, 'frontend', 'js'), join(root, 'frontend', 'src')];
const vendorPattern = /(three[^/]*\.bundle\.js|skinview3d[^/]*\.bundle\.js|vue\.global\.prod\.js|marked\.min\.js)$/;
const windowAssignments = [];
for (const dir of jsRoots) {
  for (const file of walk(dir)) {
    if (!file.endsWith('.js') || vendorPattern.test(file)) continue;
    if (file.includes(`${join('src', 'legacy')}`)) continue;
    // 插件兼容层是唯一允许向 window 暴露插件接口的文件
    if (relative(root, file).replace(/\\/g, '/') === 'frontend/src/core/plugin-compat.js') continue;
    const text = readFileSync(file, 'utf8');
    const matches = [...text.matchAll(/^\s*window\.[A-Za-z_$][\w$]*\s*=/gm)];
    if (matches.length) windowAssignments.push({ file: relative(root, file), count: matches.length });
  }
}
if (windowAssignments.length) {
  const total = windowAssignments.reduce((n, x) => n + x.count, 0);
  errors.push(`legacy 层以外仍有 ${total} 处 window.* 赋值（涉及 ${windowAssignments.length} 个文件）`);
}

// 4. 超大业务文件报告（只警告，不阻断）
const sizeTargets = [
  [join(root, 'frontend', 'js', 'app'), 800],
  [join(root, 'frontend', 'js', 'vue'), 800],
  [join(root, 'frontend', 'src'), 800],
  [join(root, 'src-tauri', 'src'), 1500],
];
for (const [dir, limit] of sizeTargets) {
  for (const file of walk(dir)) {
    if (!/\.(js|rs)$/.test(file) || vendorPattern.test(file)) continue;
    const lines = countLines(file);
    if (lines > limit) {
      warnings.push(`${relative(root, file)} ${lines} 行，超过 ${limit} 行`);
    }
  }
}

// 输出
if (errors.length) {
  console.log('\n[架构检查] 违规项：');
  for (const e of errors) console.log(`  ✗ ${e}`);
}
if (warnings.length) {
  console.log('\n[架构检查] 提示项：');
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (!errors.length && !warnings.length) {
  console.log('[架构检查] 通过，未发现问题');
}

if (strict && errors.length) process.exit(1);
