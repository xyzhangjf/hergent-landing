/**
 * v666：把页面**全部** resource 条目倒出来（含改单前就在飞的请求）。
 *
 * 为什么需要：diag-enter 的 fetch hook 只能看到点「改单」之后**新发出**的请求。
 * 而 productsCache 会在进页面时经 requestIdleCallback 预取商品主档（`/api/products/grid`，
 * 未压缩 454KB），点改单时 `fetchProductsGrid()` 会 `return _inflight` —— **等那个已经在飞的请求**。
 * 这种「等别人的请求」在 hook 里是完全隐形的，但 performance resource timeline 一定有记录。
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
const udd = path.join(os.tmpdir(), 'hg-v666r-' + Date.now())
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
  await S('Page.enable'); await S('Runtime.enable')

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

  const dump = await evalJS(`(async () => {
    const t0 = performance.now()
    const snap = () => performance.getEntriesByType('resource')
      .filter(e => /\\/api\\//.test(e.name))
      .map(e => ({
        url: e.name.replace(location.origin, ''),
        start: +e.startTime.toFixed(0),
        end: +(e.responseEnd || e.startTime).toFixed(0),
        dur: +e.duration.toFixed(0),
        size: e.transferSize || 0,
        state: e.responseStatus || 0,
      }))
    const before = snap()
    const btn = [...document.querySelectorAll('button,a')]
      .filter(el => el.offsetParent !== null && /^(改单|编辑报单|修改)$/.test((el.textContent || '').trim()))[0]
    const ready0 = window.__hgProductsGridReady
    const tClick = +t0.toFixed(0)
    btn.click()
    await new Promise(res => {
      const tick = () => {
        const inp = document.querySelector('.cross-tbl.edit-tbl input.cell-qty')
        if (inp && inp.offsetParent !== null) return res()
        requestAnimationFrame(tick)
      }
      tick()
    })
    const tFirst = +(performance.now() - t0).toFixed(0)
    const after = snap()
    return {
      tClick, tFirst, ready0, ready1: window.__hgProductsGridReady,
      beforeCount: before.length, after,
      // 点改单时**还在飞**的请求 = before 里有、且 end 在 tClick 之后
      inflightAtClick: before.filter(e => e.end > tClick),
    }
  })()`, true)

  console.log('商品主档预取标志 __hgProductsGridReady: 点击时 =', dump.ready0, '→ 之后 =', dump.ready1)
  console.log('点改单时刻 +' + dump.tClick + 'ms | 首个输入框 +' + dump.tFirst + 'ms')
  console.log('\n=== 点改单时**仍在飞**的请求（隐形等待的真凶候选）===')
  if (!dump.inflightAtClick.length) console.log('  （无）')
  for (const e of dump.inflightAtClick) {
    console.log(`  start +${e.start}  结束 +${e.end}  用时 ${e.dur}ms  ${(e.size / 1024).toFixed(0)}KB  ${e.url.slice(0, 70)}`)
  }
  console.log('\n=== 全部 API 请求（按开始时间）===')
  for (const e of dump.after.sort((a, b) => a.start - b.start)) {
    console.log(`  +${String(e.start).padStart(5)} → +${String(e.end).padStart(5)}  ${String(e.dur).padStart(5)}ms  ${String((e.size / 1024).toFixed(0)).padStart(5)}KB  ${e.url.slice(0, 66)}`)
  }
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
