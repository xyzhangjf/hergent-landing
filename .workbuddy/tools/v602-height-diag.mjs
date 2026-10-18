/**
 * v602 诊断：矮窗口下编辑网格底部（含横向滚动条）落在视口外
 *   量 3 档视口高度（913 / 780 / 660）下：
 *   - .edit-grid-wrap 的 rect（top/bottom/height）、clientHeight、scrollHeight
 *   - 页面滚动容器（向上找第一个能滚的祖先）的 scrollHeight / clientHeight / 可滚距离
 *   - 合计栏 .col-total-bar 的 bottom
 *   - 「滚到底之后」表格底边是否进视口
 * 只诊断，不改代码。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true})})'

const JS_ENTER_EDIT = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('改单') && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true })
})()`
const JS_CONFIRM = `(() => {
  const m = document.querySelector('.imp-modal, .modal, [role="dialog"]')
  if (!m) return JSON.stringify({ ok: false })
  const b = [...m.querySelectorAll('button')].find(x => /仍要|确定|进入|确认/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true })
})()`

/* 找出「能滚」的祖先链，并给出各自的几何 */
const JS_PROBE = `(() => {
  const R = (el) => { const r = el.getBoundingClientRect(); return {
    top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1) } }
  const out = { innerH: window.innerHeight, innerW: window.innerWidth,
    docScrollH: document.documentElement.scrollHeight,
    bodyScrollH: document.body.scrollHeight }
  const wrap = document.querySelector('.edit-grid-wrap')
  if (wrap) {
    out.wrap = { ...R(wrap), clientH: wrap.clientHeight, scrollH: wrap.scrollHeight,
      offsetH: wrap.offsetHeight, overflowY: getComputedStyle(wrap).overflowY,
      maxHeight: getComputedStyle(wrap).maxHeight }
    /* 横向滚动条占用：scrollHeight > clientHeight - 条高 —— 直接看 offset..client 差 */
    out.wrapScrollbarV = +(wrap.offsetHeight - wrap.clientHeight).toFixed(1)
  }
  const bar = document.querySelector('.col-total-bar')
  if (bar) out.totalBar = R(bar)
  /* 祖先链：逐层打印谁在滚 */
  out.chain = []
  let el = wrap
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    out.chain.push({ cls: (el.className || el.tagName).toString().slice(0, 40),
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      canScroll: el.scrollHeight > el.clientHeight + 1,
      overflowY: cs.overflowY, height: cs.height, maxHeight: cs.maxHeight,
      top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) })
    el = el.parentElement
  }
  const sc = out.chain.find(c => c.canScroll && (c.overflowY === 'auto' || c.overflowY === 'scroll'))
  out.scroller = sc ? { cls: sc.cls, max: sc.scrollH - sc.clientH } : null
  return JSON.stringify(out)
})()`

const JS_SCROLL_TO_END = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap')
  if (!wrap) return JSON.stringify({ ok: false })
  let el = wrap.parentElement, sc = null
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el)
    if (el.scrollHeight > el.clientHeight + 1 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')) { sc = el; break }
    el = el.parentElement
  }
  if (!sc) return JSON.stringify({ ok: false, why: 'no scroller' })
  sc.scrollTop = sc.scrollHeight
  const r = wrap.getBoundingClientRect()
  return JSON.stringify({ ok: true, scrollerCls: (sc.className || '').toString().slice(0, 30),
    scrollTop: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight,
    wrapBottom: +r.bottom.toFixed(1), wrapTop: +r.top.toFixed(1), innerH: window.innerHeight })
})()`

let browser
const log = (...a) => console.log(...a)
try {
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4500)
  log('构建号:', await page.eval(`(() => document.documentElement.dataset.build || '?')()`))
  log('进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1200)
  log('确认:', await page.eval(JS_CONFIRM))
  await sleep(4000)

  for (const h of [913, 780, 660]) {
    await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: h, deviceScaleFactor: 1, mobile: false })
    await sleep(900)
    const d = JSON.parse(await page.eval(JS_PROBE))
    log(`\n===== 视口高 ${h} =====`)
    log('innerH:', d.innerH, '| docScrollH:', d.docScrollH, '| bodyScrollH:', d.bodyScrollH)
    log('wrap:', JSON.stringify(d.wrap))
    log('合计栏:', JSON.stringify(d.totalBar))
    log('横向条占高(offset-client):', d.wrapScrollbarV)
    log('scroller:', JSON.stringify(d.scroller))
    for (const c of d.chain) log('  链:', JSON.stringify(c))
    const s = JSON.parse(await page.eval(JS_SCROLL_TO_END))
    log('滚到底:', JSON.stringify(s))
    log('底边是否进视口:', s.ok ? (s.wrapBottom <= s.innerH) : 'n/a', '| 露出多少:', s.ok ? (s.innerH - s.wrapBottom).toFixed(1) : 'n/a')
  }
  await page.raw.send('Emulation.clearDeviceMetricsOverride')
} catch (e) {
  console.error('探针异常:', e && e.message)
} finally {
  try { await browser.close() } catch (e) {}
}
