/**
 * v666：拆解「点改单 → 可打字」那 ~3.8 秒花在哪。
 *
 * 三个怀疑对象，逐个量化：
 *   A. 网络：loadEditGrid 打了几个接口、各多久、串行还是并行
 *   B. Vue 建实例：295 行 × 28 列 = 8252 个输入框，组件实例创建耗时
 *   C. 浏览器排布：DOM 从 378 涨到 28098 的 layout/recalc 成本
 *
 * 手法：页面内 hook fetch/XHR（统一 performance.now 基准）+ MutationObserver 观察
 * 编辑网格的 DOM 增长节奏 + longtask 对齐。零生产写入（只进编辑态，不改值）。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8906'
const THROTTLE = Number(process.argv[3] || 1)
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
const udd = path.join(os.tmpdir(), 'hg-v666b-' + Date.now())
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
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')
  if (THROTTLE > 1) await S('Emulation.setCPUThrottlingRate', { rate: THROTTLE })

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
  console.log(`[CPU ${THROTTLE}x] build:`, await evalJS(`window.__HG_BUILD__`))

  const res = await evalJS(`(async () => {
    // ── 页面内打点基建（统一 performance.now 基准）──
    const T0 = performance.now()
    const at = () => +(performance.now() - T0).toFixed(1)
    const reqs = []
    const longtasks = []
    const marks = []
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) longtasks.push({ t: +(e.startTime - T0).toFixed(0), d: +e.duration.toFixed(1) }) })
        .observe({ entryTypes: ['longtask'] })
    } catch (e) {}

    const _fetch = window.fetch
    window.fetch = function (...a) {
      const url = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || ''
      const st = at()
      const p = _fetch.apply(this, a)
      p.then(() => reqs.push({ url, s: st, e: at() }), () => reqs.push({ url, s: st, e: at(), fail: 1 }))
      return p
    }
    // DOM 增长节奏：每 50ms 采样一次节点数，找出「停下来」的时刻
    let sampling = true
    const growth = []
    const sample = () => {
      if (!sampling) return
      growth.push({ t: at(), n: document.querySelectorAll('*').length })
      setTimeout(sample, 50)
    }
    sample()

    const btn = [...document.querySelectorAll('button,a')]
      .filter(el => el.offsetParent !== null && /^(改单|编辑报单|修改)$/.test((el.textContent || '').trim()))[0]
    if (!btn) return { error: '找不到改单按钮' }
    btn.click()

    await new Promise(res => {
      const tick = () => {
        const inp = document.querySelector('.cross-tbl.edit-tbl input.cell-qty')
        if (inp && inp.offsetParent !== null) return res()
        requestAnimationFrame(tick)
      }
      tick()
    })
    const tFirst = at()
    let stable = 0, last = -1, tStable = 0
    while (stable < 8) {
      await new Promise(r => requestAnimationFrame(r))
      const n = document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length
      if (n === last) stable++; else { stable = 0; last = n }
      tStable = at()
    }
    sampling = false
    window.fetch = _fetch
    return {
      tFirst, tStable,
      rows: document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length,
      inputs: document.querySelectorAll('.cross-tbl.edit-tbl input').length,
      rowsReadonly: document.querySelectorAll('.cross-tbl:not(.edit-tbl) tbody tr').length,
      reqs, longtasks,
      growth: growth.filter((g, i) => i === 0 || g.n !== growth[i - 1].n).slice(0, 60),
      dialog: [...document.querySelectorAll('.modal,.dialog,[class*=mask]')].filter(x => x.offsetParent !== null).length,
    }
  })()`, true)
  if (res.error) throw new Error(res.error)

  console.log('\n=== 时间线 ===')
  console.log('首个输入框可见:', res.tFirst, 'ms | 行数稳定:', res.tStable, 'ms')
  console.log('行:', res.rows, '（只读表原来', res.rowsReadonly, '行）| 输入框:', res.inputs, '| 可见弹层:', res.dialog)

  console.log('\n=== A. 网络（点改单后发出的请求）===')
  if (!res.reqs.length) console.log('  （无请求 —— 说明编辑态数据是本地矩阵算出来的，不是现拉的）')
  const sorted = [...res.reqs].sort((a, b) => a.s - b.s)
  for (const q of sorted) console.log(`  +${q.s}ms → +${q.e}ms (${(q.e - q.s).toFixed(0)}ms) ${q.url.replace(BASE, '').slice(0, 90)}`)
  const netEnd = sorted.length ? Math.max(...sorted.map(q => q.e)) : 0
  console.log('  网络总跨度:', netEnd, 'ms')

  console.log('\n=== B. DOM 增长节奏（节点数变化 < 稳定时刻）===')
  for (const g of res.growth) console.log(`  +${g.t}ms  ${g.n} 节点`)

  console.log('\n=== C. 长任务对齐 ===')
  if (!res.longtasks.length) console.log('  （无 >50ms 任务）')
  for (const lt of res.longtasks) console.log(`  +${lt.t}ms 持续 ${lt.d}ms`)

  console.log('\n=== 结论参照 ===')
  console.log('网络结束 +' + netEnd + 'ms，DOM 稳定 +' + res.tStable + 'ms ⇒ 网络占',
    netEnd ? ((netEnd / res.tStable) * 100).toFixed(0) + '%' : '0%',
    '，其余（建实例/布局/样式）占', (100 - (netEnd ? (netEnd / res.tStable) * 100 : 0)).toFixed(0) + '%')
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
