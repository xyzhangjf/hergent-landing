/**
 * v666：改单全链路耗时拆解探针。
 *
 * 为什么需要它：v654~v656 只优化了「敲键 → reactive flush」这一段（现测 11.5ms），
 * 但用户报的是「点改单、修改数据时卡顿严重」。flush 之外还有四段从没量过：
 *   ① 点「改单」→ 编辑网格首帧可见（295 行 × ~20 列 input 的建 DOM 成本）
 *   ② 敲键 → **下一帧真的画出来**（flush 只到 vnode，不含 layout/paint）
 *   ③ 滚动（5900 个 input 在 DOM 里，滚动时 paint 面积大）
 *   ④ 弱 CPU（笔记本）下以上各项被放大多少倍 —— 用 CDP CPU throttling 模拟
 *
 * 判据全部来自 PerformanceObserver(longtask) + Performance.getMetrics() 差分，
 * 不用「感觉」。用法：node measure-edit.mjs [throttle=1|4]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || process.env.HG_BASE || 'http://127.0.0.1:8906'
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
  send(method, params = {}, sessionId, timeout = 120000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v666'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v666-' + Date.now())
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
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable'); await S('Performance.enable')

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
  const metrics = async () => {
    const r = await S('Performance.getMetrics')
    const m = {}
    for (const x of r.metrics) m[x.name] = x.value
    return m
  }
  const diff = (a, b) => ({
    script: +((b.ScriptDuration - a.ScriptDuration) * 1000).toFixed(1),
    style: +((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(1),
    layout: +((b.LayoutDuration - a.LayoutDuration) * 1000).toFixed(1),
    task: +((b.TaskDuration - a.TaskDuration) * 1000).toFixed(1),
    nodes: b.Nodes - a.Nodes,
  })

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await sleep(2500)
  console.log(`[CPU 限速 ${THROTTLE}x] build:`, await evalJS(`window.__HG_BUILD__`))

  // 常驻 longtask 观察器
  await evalJS(`(()=>{
    window.__lt = []
    try {
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__lt.push(+e.duration.toFixed(1)) })
        .observe({ entryTypes: ['longtask'] })
    } catch (e) {}
    window.__ltReset = () => { window.__lt = [] }
    return true
  })()`)

  const roState = await evalJS(`(()=>({
    rows: document.querySelectorAll('.cross-tbl:not(.edit-tbl) tbody tr').length,
    inputs: document.querySelectorAll('.cross-tbl input').length,
    nodes: document.querySelectorAll('*').length,
  }))()`)
  console.log('只读表: 行', roState.rows, '| input', roState.inputs, '| DOM 节点', roState.nodes)

  /* ── ① 点「改单」→ 编辑网格首帧可见 ── */
  const enter = await evalJS(`(async () => {
    const before = { nodes: document.querySelectorAll('*').length }
    const btn = [...document.querySelectorAll('button,a')]
      .filter(el => el.offsetParent !== null && /^(改单|编辑报单|修改)$/.test((el.textContent||'').trim()))[0]
    if (!btn) return { error: '找不到「改单」按钮' }
    window.__ltReset()
    const t0 = performance.now()
    btn.click()
    // 首个输入框出现即视为「用户看到能打字」
    await new Promise(res => {
      const tick = () => {
        const inp = document.querySelector('.cross-tbl.edit-tbl input.cell-qty')
        if (inp && inp.offsetParent !== null) return res()
        requestAnimationFrame(tick)
      }
      tick()
    })
    const tFirst = performance.now() - t0
    // 再等「行数稳定」= 全部行都建完（这才是视觉上不再闪的时刻）
    let stable = 0, last = -1, tStable = 0
    while (stable < 6) {
      await new Promise(r => requestAnimationFrame(r))
      const n = document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length
      if (n === last) stable++; else { stable = 0; last = n }
      tStable = performance.now() - t0
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    return {
      firstInputMs: +tFirst.toFixed(1),
      stableMs: +tStable.toFixed(1),
      rows: document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length,
      inputs: document.querySelectorAll('.cross-tbl.edit-tbl input').length,
      inputsTotal: document.querySelectorAll('.cross-tbl input').length,
      nodes: document.querySelectorAll('*').length,
      nodesAdded: document.querySelectorAll('*').length - before.nodes,
      longtasks: window.__lt.slice(),
    }
  })()`, true)
  if (enter.error) throw new Error(enter.error)
  console.log('\n=== ① 点「改单」→ 可打字 / 行数稳定 ===')
  console.log('首个输入框可见:', enter.firstInputMs, 'ms | 行数稳定:', enter.stableMs, 'ms')
  console.log('编辑网格: 行', enter.rows, '| 输入框', enter.inputs, '| 全表输入框', enter.inputsTotal)
  console.log('DOM 节点:', enter.nodes, '（新增', enter.nodesAdded, '）')
  console.log('longtask:', enter.longtasks.length, '个 | 合计', enter.longtasks.reduce((a, b) => a + b, 0).toFixed(1),
    'ms | 最大', enter.longtasks.length ? Math.max(...enter.longtasks) : 0, 'ms')
  if (enter.longtasks.length) console.log('  明细(>50ms):', enter.longtasks.filter(d => d > 50).slice(0, 15).join(', '))

  await sleep(2000)

  /* ── ② 敲一个键 → 下一帧真的画出来（含 layout/paint） ── */
  const typeOne = await evalJS(`(async () => {
    const tbl = document.querySelector('.cross-tbl.edit-tbl')
    const rows = [...tbl.querySelectorAll('tbody tr')]
    const input = rows[5] && rows[5].querySelector('input.cell-qty')
    if (!input) return { error: '没找到数量输入框' }
    input.focus()
    await new Promise(r => setTimeout(r, 400))
    const before = input.value
    window.__ltReset()
    // 事件 → 两个 rAF（确保这一帧的 layout/paint 都做完）
    const t0 = performance.now()
    input.value = String((parseInt(before || '0', 10) || 0) + 1)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const tPaint = performance.now() - t0
    // 防抖 150ms 后的那次 flush 也要等它画完
    await new Promise(r => setTimeout(r, 600))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const tAll = performance.now() - t0
    const after = input.value
    input.value = before
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    return { before, after, paintMs: +tPaint.toFixed(1), totalMs: +tAll.toFixed(1), longtasks: window.__lt.slice() }
  })()`, true)
  if (typeOne.error) throw new Error(typeOne.error)

  const m0 = await metrics()
  const typeMetrics = await evalJS(`(async () => {
    const tbl = document.querySelector('.cross-tbl.edit-tbl')
    const input = [...tbl.querySelectorAll('tbody tr')][5].querySelector('input.cell-qty')
    input.focus()
    await new Promise(r => setTimeout(r, 300))
    return input.value
  })()`, true)
  const m1 = await metrics()

  console.log('\n=== ② 敲一个键 ===')
  console.log('键 → 下一帧(含 layout/paint):', typeOne.paintMs, 'ms')
  console.log('键 → 防抖落定并画完:', typeOne.totalMs, 'ms（含 150ms 防抖，不是卡顿）')
  console.log('longtask:', typeOne.longtasks.length, '个', typeOne.longtasks.length ? '最大 ' + Math.max(...typeOne.longtasks) + 'ms' : '')

  /* ── ③ 滚动 ── */
  const scroll = await evalJS(`(async () => {
    const sc = document.scrollingElement
    const tbl = document.querySelector('.cross-tbl.edit-tbl')
    const box = tbl.closest('[class*=wrap]') || document.scrollingElement
    window.__ltReset()
    const t0 = performance.now()
    const steps = 20
    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, 180)
      await new Promise(r => requestAnimationFrame(r))
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const ms = performance.now() - t0
    window.scrollTo(0, 0)
    await new Promise(r => setTimeout(r, 300))
    return { ms: +ms.toFixed(1), perFrame: +(ms / steps).toFixed(1), longtasks: window.__lt.slice() }
  })()`, true)
  console.log('\n=== ③ 连续滚动 20 帧 ===')
  console.log('总', scroll.ms, 'ms | 每帧', scroll.perFrame, 'ms（16.7 = 满 60fps）')
  console.log('longtask:', scroll.longtasks.length, '个', scroll.longtasks.length ? '最大 ' + Math.max(...scroll.longtasks) + 'ms' : '')

  /* ── ④ 汇总：一次「进改单 + 改一格」的 metric 差分 ── */
  console.log('\n=== ④ 进程级累计（仅供参照）===')
  console.log('LayoutDuration 累计:', +(m1.LayoutDuration * 1000).toFixed(0), 'ms | RecalcStyle 累计:', +(m1.RecalcStyleDuration * 1000).toFixed(0), 'ms')
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
