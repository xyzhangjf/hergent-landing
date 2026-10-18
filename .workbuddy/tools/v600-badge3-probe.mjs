/**
 * v600 验证：三个筛选徽标（已隐藏零报单 / 已收起空列 / 另有 N 个未显示）
 *   T0 构建号 v600
 *   T1 226 徽标去掉浅青底 ⇒ 背景透明、文字色与「显示全部商品」完全一致
 *   T2 三个徽标与同行 .tb-toggle 同构：高 32 / 字 13 / 1px 边框 / pointer / 顶边差 0
 *   T3 点 226 ⇒ 自动勾「显示全部商品」+ 徽标消失 + 内容真展开（scrollHeight 翻倍）
 *   T4 勾「仅显示有报单」⇒ 出现「已隐藏 N 个零报单」⇒ 点它 ⇒ 复选框自动取消、徽标消失
 *   T5 「已收起 N 个空列」（数据里有全空列时才出现）：点它 ⇒「显示空列」自动勾上
 *   T6 零页面报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v600-badge'
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

/* 通用的「量一个元素」：几何 + 关键排印 + 归属信息 */
const BOX = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return JSON.stringify({ ok: false })
  const cs = getComputedStyle(el), r = el.getBoundingClientRect()
  return JSON.stringify({ ok: true,
    w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
    fontSize: cs.fontSize, border: cs.borderTopWidth, radius: cs.borderRadius,
    cursor: cs.cursor, bg: cs.backgroundColor, color: cs.color,
    role: el.getAttribute('role') || '', text: (el.textContent || '').trim().slice(0, 24) })
})()`

const JS_ALL_BADGES = `(() => {
  const row = document.querySelector('.grid-ctl-row')
  const tgl = [...row.querySelectorAll('.tb-toggle')].find(l => (l.textContent || '').includes('显示全部商品'))
  const out = { tglTop: tgl ? +tgl.getBoundingClientRect().top.toFixed(1) : null,
    tglH: tgl ? +tgl.getBoundingClientRect().height.toFixed(1) : null,
    tglBg: tgl ? getComputedStyle(tgl).backgroundColor : '', tglColor: tgl ? getComputedStyle(tgl).color : '',
    badges: [] }
  for (const b of row.querySelectorAll('.confirm-badge.filter')) {
    const cs = getComputedStyle(b), r = b.getBoundingClientRect()
    out.badges.push({ text: (b.textContent || '').trim().slice(0, 20), h: +r.height.toFixed(1),
      top: +r.top.toFixed(1), w: +r.width.toFixed(1), fontSize: cs.fontSize, border: cs.borderTopWidth,
      cursor: cs.cursor, bg: cs.backgroundColor, color: cs.color, role: b.getAttribute('role') || '',
      x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
  }
  return JSON.stringify(out)
})()`

const JS_SCROLLH = `(() => {
  /* 虚拟滚动：DOM 行数恒定，总高看滚动容器 scrollHeight */
  const area = document.querySelector('.grid-area')
  let sc = null
  if (area) {
    const cands = [area, ...area.querySelectorAll('*')]
    sc = cands.find(e => { const cs = getComputedStyle(e); return e.scrollHeight > e.clientHeight + 40 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll') }) || null
  }
  const cbs = [...document.querySelectorAll('.grid-ctl-row .tb-toggle')].map(l => ({ t: (l.textContent||'').trim().slice(0,6), on: l.querySelector('input').checked }))
  return JSON.stringify({ scrollH: sc ? sc.scrollHeight : -1, cbs,
    badges: document.querySelectorAll('.grid-ctl-row .confirm-badge.filter').length })
})()`

const JS_TOGGLE = (word) => `(() => {
  const l = [...document.querySelectorAll('.grid-ctl-row .tb-toggle')].find(x => (x.textContent||'').includes(${JSON.stringify(word)}))
  if (!l) return JSON.stringify({ ok: false })
  l.querySelector('input').click()
  return JSON.stringify({ ok: true, on: l.querySelector('input').checked })
})()`

let browser
const log = (...a) => console.log(...a)
const res = {}
try {
  fs.mkdirSync(OUT, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  const clickAt = async (x, y) => {
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    await sleep(140)
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(1500)
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4500)

  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.t0 = String(build).includes('v600')

  /* ── T1/T2 三个徽标的几何与配色 ──────────────────────────── */
  const a0 = JSON.parse(await page.eval(JS_ALL_BADGES))
  log('T2 同行基准 .tb-toggle:', JSON.stringify({ top: a0.tglTop, h: a0.tglH, bg: a0.tglBg, color: a0.tglColor }))
  for (const b of a0.badges) log('T2 徽标:', JSON.stringify(b))
  const b226 = a0.badges.find(b => b.text.includes('另有'))
  res.t1 = !!b226 && b226.bg === 'rgba(0, 0, 0, 0)' && b226.color === a0.tglColor
  res.t2 = a0.badges.length > 0 && a0.badges.every(b =>
    b.h === a0.tglH && b.fontSize === '13px' && b.border === '1px' &&
    b.cursor === 'pointer' && b.role === 'button' && Math.abs(b.top - a0.tglTop) <= 1)
  await page.screenshot(OUT + '/T1-三徽标统一.png')

  /* ── T3 点 226 展开 ─────────────────────────────────────── */
  const s0 = JSON.parse(await page.eval(JS_SCROLLH))
  await clickAt(b226.x, b226.y)
  const s1 = JSON.parse(await page.eval(JS_SCROLLH))
  log('T3 内容高:', s0.scrollH, '→', s1.scrollH, '| 勾选:', JSON.stringify(s1.cbs), '| 剩余徽标:', s1.badges)
  res.t3 = s1.scrollH > s0.scrollH * 2 && s1.cbs.some(c => c.t === '显示全部商品' && c.on) && s1.badges === 0

  /* 复原：取消「显示全部商品」，让徽标回来 */
  await page.eval(JS_TOGGLE('显示全部商品'))
  await sleep(1500)

  /* ── T4 零报单徽标 ─────────────────────────────────────── */
  const t41 = JSON.parse(await page.eval(JS_TOGGLE('仅显示有报单')))
  await sleep(1500)
  const a1 = JSON.parse(await page.eval(JS_ALL_BADGES))
  const z = a1.badges.find(b => b.text.includes('零报单'))
  log('T4 勾上仅显示有报单:', JSON.stringify(t41), '| 徽标:', JSON.stringify(z))
  await page.screenshot(OUT + '/T4-零报单徽标.png')
  let t4 = false
  if (z) {
    const okStyle = z.h === a1.tglH && z.fontSize === '13px' && z.border === '1px' && z.cursor === 'pointer' && z.role === 'button'
    await clickAt(z.x, z.y)
    const s2 = JSON.parse(await page.eval(JS_SCROLLH))
    const a2 = JSON.parse(await page.eval(JS_ALL_BADGES))
    log('T4 点击后 → 勾选:', JSON.stringify(s2.cbs), '| 徽标数:', s2.badges, '| 内容高:', s2.scrollH)
    /* ⚠️ cbs 的 t 只截了 6 个字（'仅显示有报单'），别拿 5 字的 '仅显示有报' 去 === 比 */
    t4 = okStyle && s2.cbs.some(c => c.t.includes('仅显示有报') && !c.on) && !a2.badges.some(b => b.text.includes('零报单'))
  } else log('T4 徽标没出现')
  res.t4 = t4

  /* ── T5 空列徽标（数据里得有全空列才会出现）─────────────── */
  let t5 = null
  const t51 = JSON.parse(await page.eval(JS_TOGGLE('显示空列')))
  await sleep(1500)
  const a3 = JSON.parse(await page.eval(JS_ALL_BADGES))
  const e = a3.badges.find(b => b.text.includes('空列'))
  log('T5 勾上显示空列:', JSON.stringify(t51), '| 徽标:', JSON.stringify(e))
  if (e) {
    const okStyle = e.h === a3.tglH && e.fontSize === '13px' && e.border === '1px' && e.cursor === 'pointer' && e.role === 'button'
    await clickAt(e.x, e.y)
    const s3 = JSON.parse(await page.eval(JS_SCROLLH))
    log('T5 点击后 → 勾选:', JSON.stringify(s3.cbs), '| 徽标数:', s3.badges)
    t5 = okStyle && s3.cbs.some(c => c.t === '显示空列' && c.on)
    await page.screenshot(OUT + '/T5-空列展开.png')
  } else {
    log('T5 本期无「全空列」⇒ 该徽标不渲染，跳过（不是失败）')
  }
  res.t5 = t5 === null ? true : t5

  res.t6 = (page.errors || []).length === 0
  log('T6 页面报错:', JSON.stringify(page.errors || []))
  log('T5 状态:', t5 === null ? 'SKIP(无全空列)' : (t5 ? 'PASS' : 'FAIL'))
  for (const k of ['t0', 't1', 't2', 't3', 't4', 't6']) log(k.toUpperCase(), res[k] ? 'PASS' : 'FAIL')
  log('汇总:', Object.values(res).every(Boolean) ? 'ALL PASS' : 'HAS FAIL')
} catch (e) {
  console.error('探针异常:', e && e.message)
} finally {
  try { await browser.close() } catch (e) {}
}
