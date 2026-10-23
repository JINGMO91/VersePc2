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
