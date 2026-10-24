// v661 本地验证服务：静态 dist（与线上同 hash）+ /api 反代到 ssh 隧道 127.0.0.1:8899
// 为什么不开 source-map / 不直接连生产域名：生产域名上 SPA 守卫判不出会话（见探针日志），
// 而 v660 已验证「localhost + cookie」这条路可靠。
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../../dist')
const PORT = Number(process.env.PORT || 8901)
const API_HOST = '127.0.0.1'
const API_PORT = Number(process.env.API_PORT || 8899)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const headers = { ...req.headers, host: 'localhost:' + API_PORT }
    delete headers['accept-encoding']
    const proxy = http.request({ hostname: API_HOST, port: API_PORT, path: req.url, method: req.method, headers }, (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers)
      pres.pipe(res)
    })
    proxy.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('proxy error: ' + e.message)
    })
    req.pipe(proxy)
    return
  }
  let p = decodeURIComponent(req.url.split('?')[0])
  let file = path.join(DIST, p)
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end('forbidden'); return }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) file = path.join(DIST, 'index.html')
  const ext = path.extname(file).toLowerCase()
  const stream = fs.createReadStream(file)
  stream.on('error', () => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found') })
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' })
  stream.pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`v661 server: http://127.0.0.1:${PORT}  dist=${DIST}  api->${API_HOST}:${API_PORT}`)
})
