/**
 * v667 验收：查看态（非编辑）表体高度自适应 —— 合计行 + 底部汇总条必须"首屏就在视口内"。
 *
 * 背景（用户 2026-10-24 报）：点「改单」后合计行首屏可见，**非编辑状态下要往下翻才看得到**。
 * 根因：编辑态 `.edit-grid-wrap` 的 max-height 由 JS 按「表格顶到视口底」反推（v602），
 * 而查看态 `.cross-viewport` 写死 `max-height: calc(72vh + 119px)` ⇒ 在笔记本视口下
 * 表体底边溢出视口（页头 + 主工具栏 + 工具行约 300px 未被扣除）。
 *
 * 判据（全部是 DOM 几何，不看感觉）：
 *   ① 查看态：合计行 `.col-total` 的 rect.bottom ≤ innerHeight，且 rect.top ≥ 0
 *   ② 查看态：底部汇总条 `.pin` 的 rect.bottom ≤ innerHeight
 *   ③ `.cross-viewport` 上有 JS 写入的内联 max-height（不是退回 72vh 兜底）
 *   ④ 判别力自证：把内联 max-height 清掉（= 修复前行为）⇒ 必须复现「合计行溢出」
 *      —— 这一条不过就说明本探针量不出问题，前面 PASS 全部作废
 *   ⑤ 表格仍能内部滚动（scrollHeight > clientHeight），行没被压没
 *   ⑥ 虚拟滚动没坏：滚到底能看到末行、spacer 仍在
 *   ⑦ 编辑态（点改单）合计栏仍在视口内 —— 不许回归
 *   ⑧ 全屏态不写内联 max-height（交回 CSS 的 max-height:none）
 *   ⑨ 逐单补录视图切回后内联值自动恢复
 *
 * 用法：node verify-crossfoot.mjs [base] [w] [h]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8908'
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

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v667'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v667v-' + Date.now())
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

  // 页面内通用的几何量测
  const GEOM = `(() => {
    const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) } }
    const vp = document.querySelector('.cross-viewport')
    const bar = document.querySelector('.col-total-bar')
    const total = document.querySelector('.col-total')
    const pin = document.querySelector('.pin')
    return {
      innerH: window.innerHeight,
      mode: document.querySelector('.edit-grid-wrap') ? 'edit' : 'view',
      vpMaxH: vp ? getComputedStyle(vp).maxHeight : null,
      vpInline: vp ? (vp.style.maxHeight || '') : '',
      vpClientH: vp ? vp.clientHeight : null,
      vpScrollH: vp ? vp.scrollHeight : null,
      vp: R(vp), bar: R(bar), total: R(total), pin: R(pin),
      docScrollH: document.documentElement.scrollHeight,
      pageScrollable: document.querySelector('.view-wrap') ? (document.querySelector('.view-wrap').scrollHeight > document.querySelector('.view-wrap').clientHeight) : null,
      rowCount: document.querySelectorAll('.cross-tbl tbody tr[role="row"]').length,
      hasSpacer: !!document.querySelector('.vs-spacer'),
      ariaRowCount: (document.querySelector('.cross-tbl[role="grid"]') || {}).getAttribute ? document.querySelector('.cross-tbl[role="grid"]').getAttribute('aria-rowcount') : null,
    }
  })()`

  const g0 = await evalJS(GEOM)
  console.log('\n=== 查看态首屏几何 ===')
  console.log('  ', JSON.stringify({ innerH: g0.innerH, vpMaxH: g0.vpMaxH, vpInline: g0.vpInline, vpClientH: g0.vpClientH, total: g0.total, pin: g0.pin, mode: g0.mode }))

  console.log('\n=== ① 合计行首屏可见 ===')
  ok(g0.total && g0.total.bottom <= g0.innerH, `合计行 bottom=${g0.total && g0.total.bottom} ≤ 视口 ${g0.innerH}`)
  ok(g0.total && g0.total.top >= 0, `合计行 top=${g0.total && g0.total.top} ≥ 0（没有被推到视口上方）`)

  console.log('\n=== ② 底部汇总条可见 ===')
  ok(g0.pin && g0.pin.bottom <= g0.innerH, `.pin bottom=${g0.pin && g0.pin.bottom} ≤ 视口 ${g0.innerH}`)

  console.log('\n=== ③ JS 接管（内联 max-height）===')
  ok(/px$/.test(g0.vpInline), `.cross-viewport 内联 max-height = ${g0.vpInline || '(空)'}`)
  /* 🔴 不能拿 `getComputedStyle(vp).maxHeight` 当"CSS 兜底值"比 —— 内联值会覆盖它，
     两者恒等（本次第一版探针就栽在这，把修复读成"没生效"）。兜底公式是 CSS 里写死的
     `calc(72vh + 119px)`，直接按公式算出来比。 */
  const fallback = Math.round(0.72 * g0.innerH + 119)
  ok(Number.parseFloat(g0.vpInline) > 0 && Number.parseFloat(g0.vpInline) < fallback, `反推值 ${g0.vpInline} 小于 CSS 兜底公式值 ${fallback}px（72vh+119）`)

  console.log('\n=== ④ 判别力自证（清掉内联值 = 修复前行为）===')
  const g1 = await evalJS(`(() => {
    const vp = document.querySelector('.cross-viewport')
    const saved = vp.style.maxHeight
    vp.style.maxHeight = ''
    const b = document.querySelector('.col-total').getBoundingClientRect()
    const out = { totalBottom: Math.round(b.bottom), innerH: window.innerHeight, oldMaxH: getComputedStyle(vp).maxHeight }
    vp.style.maxHeight = saved
    return out
  })()`)
  console.log('  ', JSON.stringify(g1))
  ok(g1.totalBottom > g1.innerH, `去掉反推后合计行 bottom=${g1.totalBottom} > 视口 ${g1.innerH} ⇒ 修复前确实溢出（探针有判别力）`)

  console.log('\n=== ⑤ 表格仍能内部滚动 ===')
  ok(g0.vpScrollH > g0.vpClientH, `scrollHeight ${g0.vpScrollH} > clientHeight ${g0.vpClientH}（行没被压没）`)
  ok(g0.vpClientH >= 180, `表体可视高 ${g0.vpClientH} ≥ 180（下限兜底生效，不是两三行）`)

  console.log('\n=== ⑥ 虚拟滚动未坏 ===')
  const gs = await evalJS(`(async () => {
    const vp = document.querySelector('.cross-viewport')
    vp.scrollTop = vp.scrollHeight
    await new Promise(r => setTimeout(r, 400))
    const rows = [...document.querySelectorAll('.cross-tbl tbody tr[role="row"]')]
    const last = rows[rows.length - 1]
    const lb = last ? last.getBoundingClientRect() : null
    const grid = document.querySelector('.cross-tbl[role="grid"]')
    return {
      rowCount: rows.length,
      lastBottom: lb ? Math.round(lb.bottom) : null,
      lastTop: lb ? Math.round(lb.top) : null,
      innerH: window.innerHeight,
      hasSpacer: !!document.querySelector('.vs-spacer'),
      ariaRowCount: grid ? grid.getAttribute('aria-rowcount') : null,
      vpBottom: Math.round(vp.getBoundingClientRect().bottom),
    }
  })()`, true)
  console.log('  ', JSON.stringify(gs))
  ok(gs.hasSpacer, '虚拟滚动 spacer 仍在')
  ok(gs.rowCount > 0 && gs.lastBottom <= gs.vpBottom + 2, `滚到底后末行在表体可视区内（lastBottom ${gs.lastBottom} ≤ 表体底 ${gs.vpBottom}）`)

  // ⑦ 全屏态（查看态）—— 必须在进编辑态之前测：进编辑态后 `.cross-viewport` 整块被 v-if 卸载
  console.log('\n=== ⑦ 全屏态不写内联值，退出后自动恢复 ===')
  const gf = await evalJS(`(async () => {
    const b = document.querySelector('.grid-fs-btn')
    if (!b) return { error: '找不到全屏按钮' }
    b.click()
    await new Promise(r => setTimeout(r, 900))
    const vp = document.querySelector('.cross-viewport')
    const out = {
      exists: !!vp,
      inline: vp ? vp.style.maxHeight : '(无元素)',
      css: vp ? getComputedStyle(vp).maxHeight : null,
      isFs: !!document.querySelector('.grid-area.is-fs'),
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 1000))
    const vp2 = document.querySelector('.cross-viewport')
    out.afterInline = vp2 ? vp2.style.maxHeight : '(无元素)'
    out.afterFs = !!document.querySelector('.grid-area.is-fs')
    const t = document.querySelector('.col-total')
    out.afterTotalBottom = t ? Math.round(t.getBoundingClientRect().bottom) : null
    out.innerH = window.innerHeight
    return out
  })()`, true)
  console.log('  ', JSON.stringify(gf))
  ok(gf.exists && gf.isFs, '进入全屏成功（.cross-viewport 仍在、.grid-area.is-fs 存在）')
  ok(gf.exists && !gf.inline, `全屏下内联 max-height 为空（实测 "${gf.inline}"），交回 CSS 的 ${gf.css}`)
  ok(gf.afterFs === false, 'Esc 退出全屏成功')
  ok(/px$/.test(gf.afterInline || ''), `退出全屏后内联值自动恢复（"${gf.afterInline}"）`)
  ok(gf.afterTotalBottom !== null && gf.afterTotalBottom <= gf.innerH, `退出全屏后合计行 bottom=${gf.afterTotalBottom} ≤ ${gf.innerH}`)

  // ⑧ 编辑态（点改单）合计栏回归
  console.log('\n=== ⑧ 编辑态（点改单）合计栏仍首屏可见 ===')
  const ge = await evalJS(`(async () => {
    const btn = [...document.querySelectorAll('button,a')]
      .filter(el => el.offsetParent !== null && /^(改单|编辑报单|修改)$/.test((el.textContent||'').trim()))[0]
    if (!btn) return { error: '找不到改单按钮' }
    btn.click()
    await new Promise(res => {
      const tick = () => { if (document.querySelector('.cross-tbl.edit-tbl input.cell-qty')) return res(); requestAnimationFrame(tick) }
      tick()
    })
    await new Promise(r => setTimeout(r, 1800))
    const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) } }
    const foot = document.querySelector('.foot-row')
    const wrap = document.querySelector('.edit-grid-wrap')
    return { foot: R(foot), innerH: window.innerHeight, wrapInline: wrap ? wrap.style.maxHeight : null,
             viewGone: !document.querySelector('.cross-viewport') }
  })()`, true)
  console.log('  ', JSON.stringify(ge))
  ok(ge.viewGone, '进编辑态后查看态表体已卸载（两态互斥，符合 v-else-if）')
  ok(ge.foot && ge.foot.bottom <= ge.innerH, `编辑态合计行 bottom=${ge.foot && ge.foot.bottom} ≤ 视口 ${ge.innerH}（无回归）`)
  ok(/px$/.test(ge.wrapInline || ''), `编辑态表体内联 max-height = ${ge.wrapInline}（v602 逻辑未受影响）`)

  // 截图
  const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `v667-${VW}x${VH}-view.png`), Buffer.from(shot.data, 'base64'))

  console.log(`\n================ RESULT: ${fail === 0 ? 'ALL PASS' : 'FAILED(' + fail + ')'}  pass=${pass} fail=${fail} ================`)
  if (fail) process.exitCode = 1
} finally {
  cleanup()
}
