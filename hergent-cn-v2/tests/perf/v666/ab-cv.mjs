/**
 * v666 A/B 实验：屏幕外行「不参与布局/绘制」能省多少。
 *
 * 现状（4x CPU 模拟笔记本，实测）：点改单 → 首个输入框 850ms、行数稳定 2984ms、
 * 单次长任务最长 930ms。编辑网格 295 行 × 28 列 = 8252 个 input、约 2.3 万节点，
 * 一次性同步建完 ⇒ 那一帧必然长。
 *
 * 本实验不改代码，只在运行时注入 CSS 对比三种做法（先量收益，再决定改哪儿）：
 *   基线      ：不动
 *   CV-row    ：tr { content-visibility: auto } —— 屏幕外行跳过 layout/paint
 *   CV-tbody  ：把 tbody 拆成每 40 行一个，各加 content-visibility（table 里 tr 支持差时的退路）
 *   CV+contain：再加 contain-intrinsic-size 固定占位，避免滚动条跳动
 *
 * 用法：node ab-cv.mjs [throttle=4]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8906'
const THROTTLE = Number(process.argv[3] || 4)
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

async function runOnce(label, injectCss) {
  const udd = path.join(os.tmpdir(), 'hg-ab-' + label + '-' + Date.now())
  const chrome = spawn(CHROME, [
    '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
    '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--window-size=1440,900', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  try {
    const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
    let created = null
    for (let i = 0; i < 30; i++) {
      try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
    }
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
    const S = (m, p = {}, t = 180000) => cdp.send(m, p, sessionId, t)
    await S('Page.enable'); await S('Runtime.enable')
    if (THROTTLE > 1) await S('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
    const evalJS = async (expr, awaitPromise = false) => {
      const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true })
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
      return r.result?.value
    }
    const waitFor = async (expr, timeout = 180000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < timeout) {
        if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) === true) return true
        await sleep(150)
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
    // 等主档预取完成，排除网络差异（本实验只比渲染）
    await waitFor(`window.__hgProductsGridReady > 0`, 60000)
    await sleep(1500)

    if (injectCss) await evalJS(`(()=>{const s=document.createElement('style');s.id='cvtest';s.textContent=${JSON.stringify(injectCss)};document.head.appendChild(s);return true})()`)

    const res = await evalJS(`(async () => {
      const lt = []
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(+e.duration.toFixed(0)) })
        .observe({ entryTypes: ['longtask'] }) } catch (e) {}
      const btn = [...document.querySelectorAll('button,a')]
        .filter(el => el.offsetParent !== null && /^(改单|编辑报单|修改)$/.test((el.textContent||'').trim()))[0]
      const t0 = performance.now()
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
      let stable = 0, last = -1, tStable = 0
      while (stable < 8) {
        await new Promise(r => requestAnimationFrame(r))
        const n = document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length
        if (n === last) stable++; else { stable = 0; last = n }
        tStable = +(performance.now() - t0).toFixed(0)
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      // 打字：键 → 下一帧
      const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
      const input = rows[5] && rows[5].querySelector('input.cell-qty')
      let paint = 0
      if (input) {
        input.focus()
        await new Promise(r => setTimeout(r, 400))
        const before = input.value
        const marks = lt.length
        const t1 = performance.now()
        input.value = String((parseInt(before || '0', 10) || 0) + 1)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        paint = +(performance.now() - t1).toFixed(1)
        input.value = before
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise(r => setTimeout(r, 200))
      }
      return {
        tFirst, tStable, paint,
        rows: document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length,
        nodes: document.querySelectorAll('*').length,
        ltN: lt.length, ltSum: lt.reduce((a, b) => a + b, 0), ltMax: lt.length ? Math.max(...lt) : 0,
      }
    })()`, true)
    return res
  } finally {
    try { chrome.kill('SIGKILL') } catch {}
    try { fs.rmSync(udd, { recursive: true, force: true }) } catch {}
  }
}

const CASES = [
  ['基线', ''],
  ['CV-row', '.cross-tbl.edit-tbl tbody tr{content-visibility:auto;contain-intrinsic-size:auto 26px}'],
  ['CV+contain', '.cross-tbl.edit-tbl tbody tr{content-visibility:auto;contain-intrinsic-size:auto 26px;contain:content}'],
]

console.log(`[CPU ${THROTTLE}x] A/B：屏幕外行不参与布局能省多少\n`)
const out = []
for (const [label, css] of CASES) {
  const r = await runOnce(label.replace(/[^\w]/g, ''), css)
  out.push({ label, ...r })
  console.log(`${label.padEnd(12)} 首帧 ${String(r.tFirst).padStart(5)}ms | 稳定 ${String(r.tStable).padStart(5)}ms | 打字 ${String(r.paint).padStart(5)}ms | 长任务 ${String(r.ltN).padStart(2)}个/${String(r.ltMax).padStart(4)}msmax | 节点 ${r.nodes}`)
}
const base = out[0]
console.log('\n=== 相对基线 ===')
for (const r of out.slice(1)) {
  const d = (k, inv) => {
    const v = base[k] ? ((r[k] - base[k]) / base[k]) * 100 : 0
    return `${v > 0 ? '+' : ''}${v.toFixed(0)}%`
  }
  console.log(`${r.label.padEnd(12)} 首帧 ${d('tFirst')} | 稳定 ${d('tStable')} | 打字 ${d('paint')} | 长任务峰值 ${d('ltMax')}`)
}
