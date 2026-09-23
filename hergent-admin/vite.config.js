import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 独立子站：部署在 /opt/hergent-admin，经 nginx location /admin/ 提供。
// base 必须带尾斜杠，使构建产物里的资源路径以 /admin/ 开头，
// 与 nginx 的 root 目录匹配。路由用 hash 模式，避免服务端 fallback 配置。
export default defineConfig({
  base: '/admin/',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8700',
        changeOrigin: true,
      },
    },
  },
})
