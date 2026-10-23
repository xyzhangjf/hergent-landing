/**
 * v654 本地验证服务：静态托管 dist，并把 /api 反代到生产后端。
 *
 * 为什么需要它：拆组件的样式回归只能在真浏览器里用计算样式指纹比对，
 * 但把半成品直接发到 hergent.cn 会让老板看到一张错位的表。本地起一份
 * 同源环境，浏览器里跑同样的探针，比对通过再发布。
 *
 * 用法：node tests/perf/v654/local-server.mjs [port] [--target=https://hergent.cn]
 */
import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.argv[2]) || 8899
const targetArg = process.argv.find((a) => a.startsWith('--target='))
const TARGET = targetArg ? targetArg.slice(9) : 'https://hergent.cn'
const TARGET_HOST = new URL(TARGET).hostname

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const headers = { ...req.headers, host: TARGET_HOST }
    const up = https.request(
      { hostname: TARGET_HOST, port: 443, path: req.url, method: req.method, headers },
      (r) => {
        res.writeHead(r.statusCode || 502, r.headers)
        r.pipe(res)
      }
    )
    up.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'proxy failed: ' + e.message }))
    })
    req.pipe(up)
    return
  }

  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/') p = '/index.html'
  const file = path.join(DIST, p)
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // SPA 回退
    const idx = path.join(DIST, 'index.html')
    if (fs.existsSync(idx)) {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
      res.end(fs.readFileSync(idx))
      return
    }
    res.writeHead(404); res.end('not found'); return
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  })
  res.end(fs.readFileSync(file))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`local: http://127.0.0.1:${PORT}  (dist=${DIST})  /api -> ${TARGET}`)
})
