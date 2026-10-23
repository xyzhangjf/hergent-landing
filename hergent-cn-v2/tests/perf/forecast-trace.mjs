/* 用 Chrome Tracing 抓「单键 ~120ms」到底是什么任务（只读，演示/会话同 forecast-profile）
   用法：node tests/perf/forecast-trace.mjs
*/
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class PipeCDP {
  constructor(w, r) {
    this.w = w; this.seq = 0; this.pending = new Map(); this.buf = ''; this.events = []
    this.onEvent = null
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
        } else if (m.method) {
          if (this.onEvent) this.onEvent(m)
        }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 60000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v) }, reject: e => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const udd = path.join(os.tmpdir(), 'hg-trace-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new',
  '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--user-data-dir=${udd}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
chrome.stderr.on('data', () => {})

const out = { meta: {}, top: [], samples: [] }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) { try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) } }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 60000) => cdp.send(m, p, sessionId, t)

  await S('Page.enable'); await S('Runtime.enable')
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await S('Network.enable')

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 90000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) { try { if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true } catch {} await sleep(120) }
    throw new Error('waitFor 超时: ' + expr)
  }

  // 认证（token）
  const TOKEN_FILE = path.join(OUT_DIR, '.tmp-token')
  const TOKEN = (process.env.HG_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).trim()
  if (!TOKEN) throw new Error('缺 .tmp-token')
  const csrf = 'perfprobe' + Date.now()
  for (const [name, value, httpOnly] of [['erp_token', TOKEN, true], ['hergent_auth', '1', false], ['hergent_tenant', '1', false], ['csrf_token', csrf, false]]) {
    await S('Network.setCookie', { name, value, url: 'https://hergent.cn/', httpOnly, secure: true, sameSite: 'Lax' })
  }
  await S('Page.navigate', { url: BASE + '/#/forecast' }, 90000)
  await waitFor(`document.querySelector('.cross-tbl')`)
  await sleep(1800)
  out.meta.build = await evalJS('window.__HG_BUILD__ || null')

  // 进编辑态
  await evalJS(`(()=>{const el=[...document.querySelectorAll('button')].find(e=>/改单/.test((e.textContent||'').trim())&&e.offsetParent!==null);if(el)el.click();})()`)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length>50`, 120000)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl .cell-qty').length>0`)
  await sleep(1500)
  out.meta.dom = await evalJS(`({tr:document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length,td:document.querySelectorAll('.cross-tbl.edit-tbl tbody td').length,inputs:document.querySelectorAll('.cross-tbl.edit-tbl input').length})`)

  // 选格
  await evalJS(`(()=>{const rows=[...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')];for(const r of rows){const i=r.querySelector('.cell-qty');if(i){i.setAttribute('data-perf-target','1');i.value='';i.focus();return true}}return false})()`)
  await sleep(300)

  // ---- Tracing ----
  const chunks = []
  cdp.onEvent = (m) => {
    if (m.method === 'Tracing.dataCollected') chunks.push(...(m.params.value || []))
    if (m.method === 'Tracing.tracingComplete') out.__done = true
  }
  await S('Tracing.start', {
    traceConfig: {
      includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'viz', 'gpu', 'disabled-by-default-devtools.timeline.frame'],
    },
    transferMode: 'ReportEvents',
  }, 60000)

  // 打 6 个键
  for (let i = 0; i < 6; i++) { await S('Input.insertText', { text: String(i + 1) }); await sleep(140) }

  const endPromise = (async () => { const t0 = Date.now(); while (!out.__done && Date.now() - t0 < 20000) await sleep(150) })()
  await S('Tracing.end', {}, 30000)
  await endPromise

  // ---- 聚合：只看渲染主线程 ----
  const threadName = new Map()   // `${pid}:${tid}` -> name
  for (const e of chunks) {
    if (e.ph === 'M' && e.name === 'thread_name' && e.args && e.args.name) threadName.set(`${e.pid}:${e.tid}`, e.args.name)
  }
  const agg = new Map()   // name -> {dur, n, cat}
  for (const e of chunks) {
    if (e.ph !== 'X' || e.dur == null) continue
    const tn = threadName.get(`${e.pid}:${e.tid}`) || ''
    if (tn !== 'CrRendererMain') continue
    const k = e.name
    const a = agg.get(k) || { dur: 0, n: 0, cat: e.cat || '' }
    a.dur += e.dur; a.n += 1
    agg.set(k, a)
  }
  out.top = [...agg.entries()]
    .map(([name, v]) => ({ name, totalMs: +(v.dur / 1000).toFixed(1), count: v.n, avgMs: +(v.dur / 1000 / v.n).toFixed(2), cat: v.cat }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 25)

  // 单次键的 Top 长任务（dur > 20ms 的 X 事件，按时间序）
  const longEv = chunks
    .filter(e => e.ph === 'X' && e.dur > 20000 && (threadName.get(`${e.pid}:${e.tid}`) || '') === 'CrRendererMain')
    .map(e => ({ name: e.name, ms: +(e.dur / 1000).toFixed(1), cat: e.cat, ts: e.ts }))
    .sort((a, b) => a.ts - b.ts)
  out.samples = longEv.slice(0, 40)
  out.meta.traceEvents = chunks.length

  // 全量主线程 X 事件（供父子嵌套拆解）—— 只留必要字段，控制体积
  out.mainEvents = chunks
    .filter(e => e.ph === 'X' && e.dur != null && (threadName.get(`${e.pid}:${e.tid}`) || '') === 'CrRendererMain')
    .map(e => ({ n: e.name, t: e.ts, d: e.dur, c: e.cat }))
} catch (e) {
  out.error = String(e && e.message).slice(0, 400)
} finally {
  const f = path.join(OUT_DIR, 'forecast-trace.json')
  fs.writeFileSync(f, JSON.stringify(out, null, 2))
  console.log(JSON.stringify({ meta: out.meta, error: out.error, top: out.top, samples: out.samples }, null, 2))
  try { chrome.kill('SIGKILL') } catch {}
  try { fs.rmSync(udd, { recursive: true, force: true }) } catch {}
  process.exit(0)
}
