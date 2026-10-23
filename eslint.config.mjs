// eslint.config.mjs — 前端与脚本的 ESLint 配置
// 阶段 1 只检查新迁移到 frontend/src 的模块与构建脚本；旧全局脚本暂不纳入。
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'frontend/public/**',
      'frontend-tauri/**',
      'frontend-dist/**',
      'dist/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['frontend/src/**/*.js', 'vite.config.mjs', 'scripts/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // 迁移过渡：ui-components.js 尚未模块化，仍以全局函数提供
        showToast: 'readonly',
      },
    },
    rules: {
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },
  {
    // 过渡期：功能模块仍会读取 app.js 中的全局状态（如 allVersions），
    // 且迁移自旧脚本的代码保留原有写法，先关闭结构性规则，Phase 7 再逐步收紧。
    files: ['frontend/src/features/**/*.js', 'frontend/src/vue/**/*.js'],
    rules: {
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
    },
  },
];
