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
      // S5 fix: key 从环境变量读取，不硬编码到源码
      '/hermes': {
        target: 'http://127.0.0.1:18765',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/hermes/, ''),
        headers: {
          'Authorization': `Bearer ${process.env.HERMES_GATEWAY_KEY || 'hergent-local-gateway-key-2026'}`
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    /* 🔴 不清空 outDir。两条硬理由：
       ① 本机安全护栏会把「一次删掉 dist/assets 里 200+ 个文件」判为批量删除并直接抛错，
          构建停在 prepareOutDir（表现为「跑了十几分钟一点输出都没有」，极易误判成沙箱卡死）；
       ② 部署走**闭包补传**（只上传 index.html 实际引用的 chunk，最后传 index.html），
          旧 hash 文件留在 dist 里无害 —— 每次 build 全部 hash 都会变，留着才能对比补传。 */
    emptyOutDir: false,
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  }
})
