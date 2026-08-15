import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/',
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // 现有后端（hergent-erp FastAPI）
      // 本地开发用 127.0.0.1:8700；连生产数据改 https://erp.hergent.cn
      '/api': {
        target: 'https://erp.hergent.cn',
        changeOrigin: true,
        secure: false
      },
      // Hermes OpenAI 兼容 API server（本机 18765）
      // 代理层注入 API_SERVER_KEY 认证头（key 不暴露给前端）
      '/hermes': {
        target: 'http://127.0.0.1:18765',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/hermes/, ''),
        headers: {
          'Authorization': 'Bearer hergent-local-gateway-key-2026'
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  }
})
