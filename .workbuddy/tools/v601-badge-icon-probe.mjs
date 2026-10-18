/**
 * v601 验证：三个筛选徽标的图标（换 eye-off + 尺寸对齐「品牌」按钮）
 *   I0 构建号 v601
 *   I1 徽标图标 = eye-off（Lucide eye-off 首段 path 以 M9.88 开头，共 4 段，含 M2 2l20 20 对角线）
 *   I2 「品牌」按钮仍是漏斗 filter（单段 path，M22 3H2H...）—— 撞图已解除
 *   I3 徽标图标 14×14，与「品牌」按钮里的 filter 图标**逐像素同尺寸**
 *   I4 图标在 32px 徽标里垂直居中（顶距 ≈ 底距 ±1px）
 *   I5 三个徽标（另有 / 零报单 / 空列若有）图标一致 —— 同一套语言
 *   I6 零页面报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v601-icon'
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

/* 量任意元素内的第一个 svg.ico：几何 + path 指纹 */
const SVG_OF = (hostSel, label) => `(() => {
  const host = document.querySelector(${JSON.stringify(hostSel)})
  if (!host) return JSON.stringify({ ok: false, why: 'no host' })
  const svg = host.querySelector('svg.ico')
  if (!svg) return JSON.stringify({ ok: false, why: 'no svg' })
  const r = svg.getBoundingClientRect(), hr = host.getBoundingClientRect()
  const ps = [...svg.querySelectorAll('path')]
  const ds = ps.map(p => (p.getAttribute('d') || '').slice(0, 26))
  return JSON.stringify({ ok: true, label: ${JSON.stringify(label)},
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    nPath: ps.length,
    first: ds[0] || '',
    hasDiag: ds.some(d => d.includes('M2 2l20 20') || d.includes('2 2l20 20')),
    hasFilterShape: ds.some(d => d.startsWith('M22 3H2')),
    hostH: +hr.height.toFixed(1),
    gapTop: +(r.top - hr.top).toFixed(1),
    gapBottom: +(hr.bottom - r.bottom).toFixed(1),
    vb: svg.getAttribute('viewBox') })
})()`

/* 三个徽标逐个量（含文字 + 图标指纹） */
const JS_BADGES = `(() => {
  const row = document.querySelector('.grid-ctl-row')
  if (!row) return JSON.stringify({ ok: false })
  const out = []
  for (const b of row.querySelectorAll('.confirm-badge.filter')) {
    const svg = b.querySelector('svg.ico')
    const ds = svg ? [...svg.querySelectorAll('path')].map(p => (p.getAttribute('d') || '').slice(0, 26)) : []
    const sr = svg ? svg.getBoundingClientRect() : null
    const br = b.getBoundingClientRect()
    out.push({ text: (b.textContent || '').trim().slice(0, 22),
      iw: sr ? +sr.width.toFixed(1) : null, ih: sr ? +sr.height.toFixed(1) : null,
      nPath: ds.length, first: ds[0] || '',
      hasFilterShape: ds.some(d => d.startsWith('M22 3H2')),
      bh: +br.height.toFixed(1),
      x: +(br.left + br.width / 2).toFixed(1), y: +(br.top + br.height / 2).toFixed(1) })
  }
  return JSON.stringify({ ok: true, badges: out })
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

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4500)

  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.i0 = String(build).includes('v601')

  /* ── I1/I2/I3/I4 226 徽标 vs 品牌按钮 ─────────────────────── */
  const bd = JSON.parse(await page.eval(SVG_OF('.grid-ctl-row .confirm-badge.filter.filter-act', 'badge226')))
  const br = JSON.parse(await page.eval(SVG_OF('.grid-ctl-row .btn.btn-sm.btn-ghost', 'brand')))
  log('226 徽标图标:', JSON.stringify(bd))
  log('品牌按钮图标:', JSON.stringify(br))
  res.i1 = bd.ok && bd.nPath === 4 && bd.first.startsWith('M9.88') && bd.hasDiag === true && bd.hasFilterShape === false
  res.i2 = br.ok && br.nPath === 1 && br.hasFilterShape === true
  res.i3 = bd.ok && br.ok && bd.w === 14 && bd.h === 14 && bd.w === br.w && bd.h === br.h
  res.i4 = bd.ok && Math.abs(bd.gapTop - bd.gapBottom) <= 1 && bd.hostH === 32
  await page.screenshot(OUT + '/I1-徽标eye-off与品牌漏斗.png')

  /* ── I5 三个徽标图标一致 ─────────────────────────────────── */
  const a0 = JSON.parse(await page.eval(JS_BADGES))
  log('I5 初始徽标:', JSON.stringify(a0.badges))
  await page.eval(JS_TOGGLE('仅显示有报单'))
  await sleep(1600)
  const a1 = JSON.parse(await page.eval(JS_BADGES))
  log('I5 勾零报单后:', JSON.stringify(a1.badges))
  const all = [...(a0.badges || []), ...(a1.badges || [])]
  const sig = new Set(all.map(b => b.nPath + '|' + b.first + '|' + b.iw))
  log('I5 图标指纹集合:', JSON.stringify([...sig]))
  res.i5 = all.length >= 2 && sig.size === 1 && all.every(b => b.iw === 14 && b.ih === 14 && b.hasFilterShape === false)
  await page.screenshot(OUT + '/I5-两个徽标同图标.png')

  res.i6 = (page.errors || []).length === 0
  log('I6 页面报错:', JSON.stringify(page.errors || []))

  for (const k of ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6']) log(k.toUpperCase(), res[k] ? 'PASS' : 'FAIL')
  log('汇总:', Object.values(res).every(Boolean) ? 'ALL PASS' : 'HAS FAIL')
} catch (e) {
  console.error('探针异常:', e && e.message)
} finally {
  try { await browser.close() } catch (e) {}
}
