/**
 * v599 验证：「另有 N 个在售商品未显示」徽标对齐同行控件，且点击能真的展开
 *   T0 构建号 v599
 *   T1 几何：高 32 / 字号 13 / 有 1px 边框 / cursor:pointer（对齐 .tb-toggle 与 .btn-sm）
 *   T2 基线：与同行「显示全部商品」勾选框顶边等高（±1px），不再是矮一截
 *   T3 点击 ⇒「显示全部商品」自动勾上 + 徽标消失 + 数据行数变多（真展开，不是只改样式）
 *   T4 键盘 Enter 也能触发（role=button 的可达性）
 *   T5 零页面报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v599-badge'
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

const JS_M = `(() => {
  const row = document.querySelector('.grid-area:not(.is-fs) .grid-ctl-row') || document.querySelector('.grid-ctl-row')
  if (!row) return JSON.stringify({ ok: false, reason: 'no grid-ctl-row' })
  const badge = row.querySelector('.confirm-badge.filter')
  const tgl = [...row.querySelectorAll('.tb-toggle')].find(l => (l.textContent || '').includes('显示全部商品'))
  const btn = row.querySelector('button.btn.btn-sm')
  const g = (el) => { if (!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1), left: +r.left.toFixed(1),
      x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
      fontSize: cs.fontSize, border: cs.borderTopWidth, radius: cs.borderRadius, cursor: cs.cursor,
      bg: cs.backgroundColor, color: cs.color, text: (el.textContent || '').trim().slice(0, 20) } }
  const rows = document.querySelectorAll('table.tbl tbody tr[data-r], table.tbl tbody tr')
  const checked = tgl ? tgl.querySelector('input').checked : null
  return JSON.stringify({ ok: !!badge, badge: g(badge), toggle: g(tgl), btn: g(btn),
    checked, rows: rows.length })
})()`

const JS_COUNT = `(() => {
  /* ⚠️ 只读表是虚拟滚动：DOM 里只渲染视口附近那几十行，行数与总行数无关（上一轮就踩在这，
     点击明明生效却被判 FAIL）。总行数的稳定信号 = 滚动容器的 scrollHeight（spacer 撑出来的总高）。
     另外 table.tbl 在页面上不止一个，querySelector 抓到的未必是要看的那张，故 dump 出来对照。 */
  const area = document.querySelector('.grid-area')
  let sc = null
  if (area) {
    const cands = [area, ...area.querySelectorAll('*')]
    sc = cands.find(e => { const cs = getComputedStyle(e); return e.scrollHeight > e.clientHeight + 40 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll') }) || null
  }
  const tbls = [...document.querySelectorAll('table.tbl')].map(t => ({ cls: t.className.replace(/\\s+/g,' ').slice(0,26), rowcount: t.getAttribute('aria-rowcount'), tr: t.querySelectorAll('tbody tr').length }))
  const cbs = [...document.querySelectorAll('.grid-ctl-row .tb-toggle')].map(l => ({ t: (l.textContent||'').trim().slice(0,8), on: l.querySelector('input').checked }))
  return JSON.stringify({ scrollH: sc ? sc.scrollHeight : -1, clientH: sc ? sc.clientHeight : -1, tbls, cbs })
})()`

let browser
const log = (...a) => console.log(...a)
const res = {}
try {
  fs.mkdirSync(OUT, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4500)

  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.t0 = String(build).includes('v599')

  const m = JSON.parse(await page.eval(JS_M))
  if (!m.ok) throw new Error('找不到徽标（hiddenByRowBase 为 0？）')
  log('T1 徽标:', JSON.stringify(m.badge))
  log('T1 勾选框:', JSON.stringify(m.toggle))
  log('T1 品牌按钮:', JSON.stringify(m.btn))
  res.t1 = m.badge.h === 32 && m.badge.fontSize === '13px' && m.badge.border === '1px' && m.badge.cursor === 'pointer'
  res.t2 = Math.abs(m.badge.top - m.toggle.top) <= 1 && Math.abs(m.badge.h - m.toggle.h) <= 1
  log('T2 顶边差:', (m.badge.top - m.toggle.top).toFixed(1), '| 高度差:', (m.badge.h - m.toggle.h).toFixed(1))
  await page.screenshot(OUT + '/T1-统一前尺寸.png')

  /* T3 点击展开 */
  const before = JSON.parse(await page.eval(JS_COUNT))
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: m.badge.x, y: m.badge.y, button: 'none' })
  await sleep(120)
  await page.screenshot(OUT + '/T3-hover.png')
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: m.badge.x, y: m.badge.y, button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: m.badge.x, y: m.badge.y, button: 'left', clickCount: 1 })
  await sleep(1800)
  const after = JSON.parse(await page.eval(JS_COUNT))
  log('T3 滚动内容高:', before.scrollH, '→', after.scrollH, '| 视口高:', before.clientH, '| 表格:', JSON.stringify(after.tbls), '| 勾选框:', JSON.stringify(after.cbs))
  const badgeGone = JSON.parse(await page.eval(`(() => JSON.stringify({ n: document.querySelectorAll('.grid-ctl-row .confirm-badge.filter').length }))()`))
  res.t3 = after.scrollH > before.scrollH * 2 && after.cbs.some(c => c.t.includes('显示全部商品') && c.on) && badgeGone.n === 0
  log('T3 剩余徽标数:', badgeGone.n)
  await page.screenshot(OUT + '/T3-点击后展开.png')

  /* T4 键盘可达：先关掉勾选让徽标回来，再 Enter 触发 */
  await page.eval(`(() => { const l = [...document.querySelectorAll('.grid-ctl-row .tb-toggle')].find(x => (x.textContent||'').includes('显示全部商品')); l.querySelector('input').click(); return 1 })()`)
  await sleep(1600)
  const back = JSON.parse(await page.eval(JS_M))
  const backC = JSON.parse(await page.eval(JS_COUNT))
  let t4 = false
  if (back.ok) {
    await page.eval(`(() => { const b = document.querySelector('.grid-ctl-row .confirm-badge.filter.filter-act'); b.focus(); return document.activeElement === b })()`)
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(1600)
    const k = JSON.parse(await page.eval(JS_COUNT))
    t4 = k.scrollH > backC.scrollH * 2 && k.cbs.some(c => c.t.includes('显示全部商品') && c.on)
    log('T4 Enter 后滚动内容高:', backC.scrollH, '→', k.scrollH, '| 勾选框:', JSON.stringify(k.cbs))
  } else log('T4 徽标没回来（取消勾选后应为 true）')
  res.t4 = t4

  res.t5 = (page.errors || []).length === 0
  log('T5 页面报错:', JSON.stringify(page.errors || []))
  for (const k of ['t0', 't1', 't2', 't3', 't4', 't5']) log(k.toUpperCase(), res[k] ? 'PASS' : 'FAIL')
  log('汇总:', Object.values(res).every(Boolean) ? 'ALL PASS' : 'HAS FAIL')
} catch (e) {
  console.error('探针异常:', e && e.message)
} finally {
  try { await browser.close() } catch (e) {}
}
