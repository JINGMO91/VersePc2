// vite.config.mjs — 前端构建配置
// 根目录为 frontend，静态资源从 frontend/public 原样复制到产物根目录。
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(rootDir, 'frontend');

export default defineConfig({
  root: frontendDir,
  publicDir: resolve(frontendDir, 'public'),
  base: './',
  plugins: [
    // SFC 支持：新组件使用 .vue，旧页面仍为 JS 模板字符串，两者共存
    vue(),
    // Tailwind CSS v4（样式入口见 frontend/src/styles/tailwind.css）
    tailwindcss(),
    // 包体分析：仅在 ANALYZE=1 时生成，产物写入 gitignored 的 .trae 目录
    process.env.ANALYZE
      ? visualizer({
          filename: resolve(rootDir, '.trae', 'bundle-stats.json'),
          template: 'raw-data',
          gzipSize: true,
        })
      : null,
  ].filter(Boolean),
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      // 现有页面全部使用 template 字符串，需要带编译器的完整 Vue 构建
      vue: 'vue/dist/vue.esm-bundler.js',
      // 组件库与业务组件统一使用 @ 指向 frontend/src
      '@': resolve(frontendDir, 'src'),
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
    include: ['src/**/*.test.js'],
    passWithNoTests: true,
  },
});
