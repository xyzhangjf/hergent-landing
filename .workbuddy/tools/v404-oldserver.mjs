/**
 * v404 相位反转用「旧版静态服务」—— 把已上线的 v403 旧构建在本地起服务，
 * 所有 /api/* 反向代理到生产 https://hergent.cn（只读 GET，本服务不写任何东西）。
 *
 * 目的（判据纪律）：让同一套 v404 断言在**改动前**的产物上跑一遍，
 * 新功能相关的判据必须**变红** —— 否则「46 PASS」只是恒真，没有判别力。
 *
 * 运行：node .workbuddy/tools/v404-oldserver.mjs [distDir] [port]
 */
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = process.argv[2] || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/dist-v403'
const PORT = Number(process.argv[3] || 8799)
const UPSTREAM = 'https://hergent.cn'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1')

  /* ── /api/* → 反代到生产（方法/头/体原样透传） ── */
  if (u.pathname.startsWith('/api/')) {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const headers = { ...req.headers, host: 'hergent.cn' }
      delete headers['accept-encoding']          // 免解压
      const up = https.request(`${UPSTREAM}${req.url}`, { method: req.method, headers }, r => {
        res.writeHead(r.statusCode || 502, r.headers)
        r.pipe(res)
      })
      up.on('error', e => { res.writeHead(502); res.end('proxy error: ' + e.message) })
      if (body.length) up.write(body)
      up.end()
    })
    return
  }

  /* ── 静态文件（/ 与未知路径都回落 index.html，SPA） ── */
  let p = path.join(DIST, decodeURIComponent(u.pathname))
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html')
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' })
    res.end(buf)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[v404-oldserver] dist=${DIST}`)
  console.log(`[v404-oldserver] http://127.0.0.1:${PORT}  (api → ${UPSTREAM})`)
})
