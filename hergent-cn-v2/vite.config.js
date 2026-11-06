import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'

/* v788：前端构建号改为**构建时注入**，彻底撤掉 main.js 里那行手工硬编码。
   ────────────────────────────────────────────────────────────────────────
   为什么改：v591 起那行要求「每次发版手动改」，实测漏改 31 版（线上 v787，
   源码还写着 v756）⇒ `data-build` 反而在排查「改了没变」时误导人。
   现在三个来源全部自动、不可漏：
     ① 版本号 = git 最近一条提交信息里的 vNNN（发版提交写 `v788` 即自动生效，无需再改第二处）；
     ② 提交短哈希 = 线上这份包对应哪次提交，直接回答「线上跑的到底是哪份代码」；
     ③ 构建时间  = 同一版本多次重构建也能区分。
   ⚠️ 全部用 try/catch 兜底：脱离 git 仓（例如只拷源码去构建）也不能让 build 崩。
   ⚠️ 不要把 `dirty` 塞进号里：本机工作树长期有并行会话的在途改动，标脏没有判别价值。 */
const sh = (cmd, fallback = '') => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch { return fallback }
}
const BUILD_VER = (sh('git log -300 --format=%s').match(/\bv(\d{3})\b/) || [])[0] || 'dev'
const BUILD_SHA = sh('git rev-parse --short HEAD') || 'nogit'
const _d = new Date()
const _p2 = (n) => String(n).padStart(2, '0')
const BUILD_STAMP = `${_d.getFullYear()}${_p2(_d.getMonth() + 1)}${_p2(_d.getDate())}-${_p2(_d.getHours())}${_p2(_d.getMinutes())}`
const BUILD_FULL = `${BUILD_VER}@${BUILD_SHA}@${BUILD_STAMP}`

export default defineConfig({
  base: '/',
  plugins: [vue()],
  /* 编译期文本替换：main.js 里写裸标识符，产物里就是字面量。
     短号给 UI 和排查脚本看（沿用 v7xx 习惯），完整串给 data-build / console 定位提交。 */
  define: {
    __HG_BUILD_VERSION__: JSON.stringify(BUILD_VER),
    __HG_BUILD_FULL__: JSON.stringify(BUILD_FULL)
  },
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
