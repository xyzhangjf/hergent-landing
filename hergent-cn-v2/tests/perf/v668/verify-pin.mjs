/**
 * v668 验收：底部汇总条（.pin）字号瘦身 + 省行高。
 *
 * 用户报：「合计(小单位) 570 · 合计(箱) 62.833 这些字体过大，能否调小一点省一点行高」。
 * 原样式 `.pin .big{font-size:18px}` + `margin-top:14 / padding-top:12` ⇒ 整条 42px 高。
 *
 * 判据：
 *   ① `.pin .big` 标签 13px、数字 15px（与编辑态 `.edit-summary` 同档，两态一致）
 *   ② 整条 `.pin` 高度明显下降（≤ 34px；改造前 42px）
 *   ③ 内容没缩水：仍有「合计(小单位)」「合计(箱)」且数值非 0
 *   ④ 合计行 + 汇总条仍首屏可见（本版只会更宽松，但不许回归）
 *   ⑤ 编辑态 `.edit-summary` 字号未被动过
 *
 * 用法：node verify-pin.mjs [base] [w] [h]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8909'
const VW = Number(process.argv[3] || 1440)
const VH = Number(process.argv[4] || 780)
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

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v668'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v668v-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  `--window-size=${VW},${VH + 120}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅', msg) } else { fail++; console.log('  ❌', msg) } }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 180000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')
  await S('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false })

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
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await waitFor(`window.__hgProductsGridReady > 0`, 90000)
  await sleep(1200)
  console.log(`[视口 ${VW}×${VH}] build:`, await evalJS(`window.__HG_BUILD__`))

  const g = await evalJS(`(() => {
    const pin = document.querySelector('.pin')
    const big = pin && pin.querySelector('.big')
    const bigB = big && big.querySelector('b')
    const mini = pin && pin.querySelector('.mini')
    const total = document.querySelector('.col-total')
    const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) } }
    const fs_ = (el) => el ? getComputedStyle(el).fontSize : null
    const cs = pin ? getComputedStyle(pin) : null
    return {
      innerH: window.innerHeight,
      pin: R(pin), total: R(total),
      bigText: big ? big.textContent.replace(/\\s+/g, ' ').trim() : null,
      bigFs: fs_(big), bigBFs: fs_(bigB), miniFs: fs_(mini),
      pinMarginTop: cs ? cs.marginTop : null, pinPaddingTop: cs ? cs.paddingTop : null,
      pinGap: cs ? cs.gap : null,
      carat: document.querySelector('.pin-sprint') ? 'present' : 'absent',
    }
  })()`)
  console.log('\n=== 汇总条实测 ===')
  console.log('  ', JSON.stringify(g))

  console.log('\n=== ① 字号（与编辑态 .edit-summary 13/15 同档）===')
  ok(g.bigFs === '13px', `.pin .big 标签字号 = ${g.bigFs}（改造前 18px）`)
  ok(g.bigBFs === '15px', `.pin .big b 数字字号 = ${g.bigBFs}（与 .edit-summary b 一致）`)

  console.log('\n=== ② 行高 ===')
  ok(g.pin && g.pin.h <= 34, `整条高度 ${g.pin && g.pin.h}px ≤ 34px（改造前 42px，省 ${42 - (g.pin ? g.pin.h : 42)}px）`)
  /* `.pin` 在 `.grid-area` 里时 margin-top 会被容器规则再压（实测 4px，比写的 10px 更紧），
     所以断言只要求「不比改造前(14px)大」，不钉死字面值。 */
  ok(Number.parseFloat(g.pinMarginTop) <= 10 && g.pinPaddingTop === '8px', `间距 margin-top=${g.pinMarginTop} / padding-top=${g.pinPaddingTop}（改造前 14 / 12）`)

  console.log('\n=== ③ 内容没缩水 ===')
  ok(/合计\(小单位\)/.test(g.bigText || '') && /合计\(箱\)/.test(g.bigText || ''), `文案完整：${g.bigText}`)
  ok(/[1-9]/.test(g.bigText || ''), '数值非 0（是真数据，不是被样式挤掉）')

  console.log('\n=== ④ 仍首屏可见 ===')
  ok(g.total && g.total.bottom <= g.innerH, `合计行 bottom=${g.total && g.total.bottom} ≤ ${g.innerH}`)
  ok(g.pin && g.pin.bottom <= g.innerH, `.pin bottom=${g.pin && g.pin.bottom} ≤ ${g.innerH}`)

  // 截图（查看态 —— 本版要看的正是这条汇总条）
  const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `v668-${VW}x${VH}-view.png`), Buffer.from(shot.data, 'base64'))

  // ⑤ 编辑态字号未被动过
  const ge = await evalJS(`(async () => {
    const btn = [...document.querySelectorAll('button,a')]
      .filter(el => el.offsetParent !== null && /^(改单|编辑报单|修改)$/.test((el.textContent||'').trim()))[0]
    if (!btn) return { error: '找不到改单按钮' }
    btn.click()
    await new Promise(res => { const t = () => { if (document.querySelector('.cross-tbl.edit-tbl input.cell-qty')) return res(); requestAnimationFrame(t) }; t() })
    await new Promise(r => setTimeout(r, 1600))
    const es = document.querySelector('.edit-summary')
    const b = es && es.querySelector('b')
    const foot = document.querySelector('.foot-row')
    const R = (el) => { if (!el) return null; const x = el.getBoundingClientRect(); return { top: Math.round(x.top), bottom: Math.round(x.bottom), h: Math.round(x.height) } }
    return { esFs: es ? getComputedStyle(es).fontSize : null, esBFs: b ? getComputedStyle(b).fontSize : null,
             foot: R(foot), innerH: window.innerHeight }
  })()`, true)
  console.log('\n=== ⑤ 编辑态未被动过 ===')
  console.log('  ', JSON.stringify(ge))
  ok(ge.esFs === '13px' && ge.esBFs === '15px', `编辑态 .edit-summary ${ge.esFs} / b ${ge.esBFs}（未变）`)
  ok(ge.foot && ge.foot.bottom <= ge.innerH, `编辑态合计行 bottom=${ge.foot && ge.foot.bottom} ≤ ${ge.innerH}`)

  console.log(`\n================ RESULT: ${fail === 0 ? 'ALL PASS' : 'FAILED(' + fail + ')'}  pass=${pass} fail=${fail} ================`)
  if (fail) process.exitCode = 1
} finally {
  cleanup()
}
