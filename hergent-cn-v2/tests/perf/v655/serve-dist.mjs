// v655 本地终验服务：静态 dist + SPA fallback + /api 反代生产后端（erp.hergent.cn）
// 用途：在生产构建产物（与线上 md5 一致）上跑 parentRenders 终验探针
import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../../' + (process.env.HG_DIST || 'dist'))
const PORT = Number(process.env.PORT || 8901)
const API_TARGET = 'erp.hergent.cn'

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
    // 反代生产后端：透传方法与头，仅改 host
    const headers = { ...req.headers, host: API_TARGET }
    delete headers['accept-encoding'] // 避免压缩内容长度处理
    const proxy = https.request({
      hostname: API_TARGET, port: 443, path: req.url, method: req.method, headers,
    }, (pres) => {
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
  if (!fs.existsSync(file)) file = path.join(DIST, 'index.html') // SPA fallback
  const ext = path.extname(file).toLowerCase()
  const stream = fs.createReadStream(file)
  stream.on('error', () => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found') })
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' })
  stream.pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`v655 local verify server: http://127.0.0.1:${PORT}  dist=${DIST}  api->${API_TARGET}`)
})
