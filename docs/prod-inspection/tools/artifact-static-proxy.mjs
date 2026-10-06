/**
 * artifact-static-proxy.mjs —— 「本地新构建 + 真后端」预发代理（**只读**）
 *
 * 为什么需要它：
 *   真机探针要打真实后端，但新前端还没上传。若直接开 vite dev，构建产物 ≠ 待上线产物
 *   （dev 不压缩、不 tree-shake、chunk 名不同）⇒ 验的就不是打算上线的那份。
 *   本脚本把 **dist-* 静态目录原样**供在 127.0.0.1，`/api/*` 反向代理到生产，
 *   于是浏览器认为是同源 ⇒ 探针里 fetch/XHR 一条都不用改，本地/线上通用。
 *
 * 🔴 上一轮（批次 1.1）把等价的脚本写在 /tmp，被系统清理后无法复现 ⇒ 本次入库。
 *   （项目纪律 §「探针脚本别放 /tmp」）
 *
 * 🔴 只读承诺：本脚本不写任何文件、不改任何上游状态；只透传 HTTP。
 *   唯一的写动作来自页面上你自己点的东西 —— 探针已用零写入哨兵看住。
 *
 * 用法：
 *   DIST=hergent-cn-v2/dist-v387-1-2 PORT=8791 \
 *     node docs/prod-inspection/tools/artifact-static-proxy.mjs
 *   （长跑进程请用 run_in_background，`nohup ... &` 会被沙箱回收）
 */
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const DIST = path.resolve(ROOT, process.env.DIST || 'hergent-cn-v2/dist')
const PORT = Number(process.env.PORT || 8791)
const HOST = process.env.HOST || '127.0.0.1'
const UPSTREAM = process.env.UPSTREAM || 'https://hergent.cn'
const UP = new URL(UPSTREAM)
const PROXY = process.env.HTTP_PROXY || process.env.http_proxy || ''
const STRIP_CSP = process.env.STRIP_CSP !== '0'

if (!fs.existsSync(DIST)) { console.error('DIST 不存在：' + DIST); process.exit(2) }
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('DIST 下没有 index.html：' + DIST); process.exit(2) }

console.log('[preview] dist   = ' + DIST)
console.log('[preview] listen = http://' + HOST + ':' + PORT)
console.log('[preview] upstream = ' + UPSTREAM + (PROXY ? '  (经代理 ' + PROXY + ')' : '  (直连)'))

/* ---------------- 出网：可选 CONNECT 隧道（本机有本地代理时必须有） ---------------- */
let upstreamAgent = undefined
if (PROXY) {
  const pu = new URL(PROXY)
  upstreamAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 8,
    createConnection(opts, cb) {
      const req = http.request({
        host: pu.hostname,
        port: Number(pu.port || 80),
        method: 'CONNECT',
        path: opts.host + ':' + (opts.port || 443),
        headers: { Host: opts.host + ':' + (opts.port || 443) },
      })
      req.once('connect', (res, socket) => {
        if (res.statusCode !== 200) { socket.destroy(); return cb(new Error('CONNECT ' + res.statusCode)) }
        const t = tls.connect({ socket, servername: opts.host }, () => cb(null, t))
        t.once('error', cb)
      })
      req.once('error', cb)
      req.end()
    },
  })
}

/* ---------------- 静态：MIME ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
}

function safeJoin(root, urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0])
  const abs = path.normalize(path.join(root, p))
  return abs.startsWith(root) ? abs : null
}

/* ---------------- 反代 ---------------- */
function proxyApi(req, res) {
  const headers = { ...req.headers, host: UP.host }
  delete headers['accept-encoding']            // 让上游别压，省得解压
  const opts = {
    host: UP.hostname, port: Number(UP.port || 443),
    method: req.method, path: req.url, headers, agent: upstreamAgent,
  }
  const up = https.request(opts, (ur) => {
    const h = { ...ur.headers }
    delete h['content-encoding']
    delete h['transfer-encoding']
    if (STRIP_CSP) delete h['content-security-policy']   // 本地 127.0.0.1 不在上游 CSP 白名单里
    delete h['content-security-policy-report-only']
    h['x-preview-proxied'] = '1'
    res.writeHead(ur.statusCode || 502, h)
    ur.pipe(res)
  })
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ detail: 'preview proxy error: ' + String(e && e.message || e) }))
  })
  req.pipe(up)
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return proxyApi(req, res)

  let f = safeJoin(DIST, req.url)
  if (f && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html')

  /* SPA 回退：非静态、非 /api 的路径一律给 index.html（同 nginx try_files） */
  if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) f = path.join(DIST, 'index.html')

  const ext = path.extname(f).toLowerCase()
  const h = { 'content-type': MIME[ext] || 'application/octet-stream' }
  if (ext === '.html') h['cache-control'] = 'no-store'
  res.writeHead(200, h)
  fs.createReadStream(f).pipe(res)
})

server.listen(PORT, HOST, () => console.log('[preview] READY'))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))
