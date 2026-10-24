/**
 * v666：对「点改单 → 可打字」这段做 CPU Profile，把 2 秒的纯计算定名。
 *
 * 为什么必须用 profiler：diag-enter 已证明这 2 秒**不是网络**（请求在 +2161ms 才发）、
 * **不是 DOM**（节点在 +2578ms 才长），且只报出 1 个 345ms 长任务 ⇒ 其余是大量 <50ms
 * 的同步任务。这种形状只能靠采样定名（与 v652「输入卡」的定法一致：先测，不猜）。
 *
 * 输出：self-time 前 30 名（含源码首行），以及按 url 聚合。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8906'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class PipeCDP {
  constructor(w, r) {
    this.w = w; this.seq = 0; this.pending = new Map(); this.buf = ''
    r.setEncoding('utf8')
    r.on('data', (c) => {
      this.buf += c
      let i
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const s = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1)
        if (!s) continue
        let m; try { m = JSON.parse(s) } catch { continue }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
        }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 180000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v666'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v666p-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 180000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Profiler.enable')

  const evalJS = async (expr, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 120000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) === true) return true
      await sleep(120)
    }
    throw new Error('waitFor 超时: ' + expr)
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await sleep(2500)

  await S('Profiler.setSamplingInterval', { interval: 200 })   // 200µs 采样，够细
  await S('Profiler.start')
  await evalJS(`(()=>{const b=[...document.querySelectorAll('button,a')].filter(el=>el.offsetParent!==null&&/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim()))[0]; if(!b) return false; b.click(); return true})()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl input.cell-qty')`, 120000)
  await sleep(300)
  const { profile } = await S('Profiler.stop')

  // ── 聚合 self time ──
  const byId = new Map()
  for (const n of profile.nodes) byId.set(n.id, n)
  const selfCount = new Map()     // nodeId -> samples
  for (const s of profile.samples || []) selfCount.set(s, (selfCount.get(s) || 0) + 1)
  const dt = (profile.endTime - profile.startTime) / (profile.samples || []).length
  const rows = []
  for (const [nid, c] of selfCount) {
    const n = byId.get(nid)
    if (!n) continue
    const cf = n.callFrame || {}
    rows.push({
      ms: +(c * dt / 1000).toFixed(1),
      name: cf.functionName || '(anon)',
      url: (cf.url || '').split('/').pop().split('?')[0],
      line: (cf.lineNumber || 0) + 1,
    })
  }
  rows.sort((a, b) => b.ms - a.ms)
  const total = rows.reduce((s, r) => s + r.ms, 0)
  console.log('\n=== 采样总时长 ===', total.toFixed(0), 'ms （样本', (profile.samples || []).length, '个）')
  console.log('\n=== self time 前 30 ===')
  for (const r of rows.slice(0, 30)) {
    console.log(`${String(r.ms).padStart(8)} ms  ${r.name.slice(0, 42).padEnd(42)} ${r.url}:${r.line}`)
  }
  const byUrl = new Map()
  for (const r of rows) byUrl.set(r.url, (byUrl.get(r.url) || 0) + r.ms)
  console.log('\n=== 按文件聚合 ===')
  ;[...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([u, ms]) => console.log(`${String(ms.toFixed(0)).padStart(8)} ms  ${u}`))
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
