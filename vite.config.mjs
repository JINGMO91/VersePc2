// vite.config.mjs — 前端构建配置
// 根目录为 frontend，静态资源从 frontend/public 原样复制到产物根目录。
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(rootDir, 'frontend');

export default defineConfig({
  root: frontendDir,
  publicDir: resolve(frontendDir, 'public'),
  base: './',
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      // 现有页面全部使用 template 字符串，需要带编译器的完整 Vue 构建
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
  build: {
    outDir: resolve(rootDir, 'frontend-dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(frontendDir, 'index.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['frontend/src/**/*.test.js', 'tests/**/*.test.js'],
    passWithNoTests: true,
  },
});
