/* 「点改单 → 表格可用」的端到端计时 + 期间网络请求明细。
   ============================================================
   用来验证 v653 的商品主档预取是否真的把这 0.31 秒省掉：
     · 若预取生效 ⇒ 点改单期间**不应再出现** `/api/products/grid` 请求，
       或它已提前在页面加载期完成。
     · 同时给出剩余耗时由谁构成（summary / validation-spec / 主线程建 DOM）。
   纪律：只读 —— 只点「改单」再关闭，不输入、不保存。
   用法：node tests/perf/forecast-open-timing.mjs [tag]
*/
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const TAG = process.argv[2] || 'run'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class PipeCDP {
  constructor(w, r) {
    this.w = w; this.seq = 0; this.pending = new Map(); this.buf = ''
    this.onEvent = null            // (msg) => void —— 用于旁路 Network.* 事件
    r.setEncoding('utf8')
    r.on('data', (chunk) => {
      this.buf += chunk
      let i
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const s = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1)
        if (!s) continue
        let m; try { m = JSON.parse(s) } catch { continue }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
        } else if (m.method && this.onEvent) {
          try { this.onEvent(m) } catch { /* 监听器异常不得影响协议循环 */ }
        }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 60000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const udd = path.join(os.tmpdir(), 'hg-open-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new',
  '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--user-data-dir=${udd}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })

let chromeErr = ''
chrome.stderr.on('data', d => { chromeErr += String(d) })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

const out = { tag: TAG, build: null, reqs: [], runs: [], errors: [] }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  if (!created) throw new Error('Chrome 未就绪')
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })

  const reqs = new Map()
  cdp.onEvent = (msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      reqs.set(msg.params.requestId, { url: msg.params.request.url, start: Date.now(), method: msg.params.request.method })
    } else if (msg.method === 'Network.loadingFinished') {
      const r = reqs.get(msg.params.requestId)
      if (r) { r.end = Date.now(); r.ms = r.end - r.start; r.encoded = msg.params.encodedDataLength }
    } else if (msg.method === 'Network.loadingFailed') {
      const r = reqs.get(msg.params.requestId)
      if (r) { r.end = Date.now(); r.ms = r.end - r.start; r.failed = msg.params.errorText }
    }
  }

  const S = (m, p = {}, t = 60000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 90000, label = '') => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try { if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true } catch {}
      await sleep(80)
    }
    throw new Error('waitFor 超时: ' + (label || expr))
  }

  const TOKEN_FILE = path.join(OUT_DIR, '.tmp-token')
  const TOKEN = (process.env.HG_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).trim()
  if (!TOKEN) throw new Error('缺少 tests/perf/.tmp-token')
  const csrf = 'openprobe' + Date.now()
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', csrf, false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' }, 60000)
  await waitFor(`document.readyState==='complete'`, 60000, 'load')
  await waitFor(`!!document.querySelector('.cross-tbl')`, 90000, '查看表')
  out.build = await evalJS(`window.__HG_BUILD__ || '-'`)

  /* 等预取落地：最多 4 秒（requestIdleCallback timeout=3000） */
  const prefetchDone = await evalJS(`(async()=>{
    const t0=Date.now()
    while(Date.now()-t0<4000){ if(window.__hgProductsGridReady) return window.__hgProductsGridReady; await new Promise(r=>setTimeout(r,50)) }
    return 0 })()`, true)

  /* 第一轮：点改单 */
  const t0 = Date.now()
  await evalJS(`(()=>{
    const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null);
    if(!c.length) return false; c[0].click(); return true })()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 90000, '编辑表')
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`, 90000, '294 行')
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl input.cell-qty').length > 100`, 90000, '数量输入框')
  const t1 = Date.now()
  out.runs.push({ label: '首次点改单', ms: t1 - t0, prefetchDone })

  await sleep(1200)

  /* 第二轮：退出再进（验证缓存复用，应显著更快） */
  const t2 = Date.now()
  await evalJS(`(()=>{
    const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(完成|退出改单|返回|取消编辑|查看)$/.test((el.textContent||'').trim())&&el.offsetParent!==null);
    if(!c.length) return false; c[0].click(); return true })()`)
  await sleep(900)
  await evalJS(`(()=>{
    const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null);
    if(!c.length) return false; c[0].click(); return true })()`)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`, 90000, '二次 294 行')
  const t3 = Date.now()
  out.runs.push({ label: '退出后再进改单', ms: t3 - t2 })

  out.reqs = [...reqs.values()]
    .filter(r => /\/api\//.test(r.url))
    .map(r => ({ url: r.url.replace(BASE, ''), ms: r.ms, kb: r.encoded ? +(r.encoded / 1024).toFixed(1) : null, failed: r.failed || null }))
    .filter(r => r.ms != null)

  fs.writeFileSync(path.join(OUT_DIR, `open-${TAG}.json`), JSON.stringify(out, null, 1))

  console.log('build:', out.build, '| 预取完成:', prefetchDone)
  out.runs.forEach(r => console.log(`  ${r.label}: ${r.ms} ms`))
  console.log('--- 期间 API 请求 ---')
  const products = out.reqs.filter(r => r.url.includes('/products/grid'))
  console.log(`  /products/grid 请求次数: ${products.length}`, products.map(p => p.ms + 'ms').join(','))
  out.reqs.slice(0, 14).forEach(r => console.log(`  ${String(r.ms).padStart(6)}ms  ${r.kb == null ? '?' : r.kb + 'KB'}  ${r.url.slice(0, 70)}`))
} catch (e) {
  out.errors.push(String(e && e.message || e))
  fs.writeFileSync(path.join(OUT_DIR, `open-${TAG}.json`), JSON.stringify(out, null, 1))
  console.error('FAILED:', e && e.message)
  if (chromeErr) console.error('chrome stderr:', chromeErr.slice(-300))
  process.exitCode = 1
} finally {
  cleanup()
}
