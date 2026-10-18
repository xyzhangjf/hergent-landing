/**
 * v599 诊断探针：「另有 N 个在售商品未显示」徽标 vs 同行其它控件
 * 只量、不改。判据全部取 getComputedStyle / getBoundingClientRect 实测值。
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

const JS_MEASURE = `(() => {
  const pick = (el, label) => {
    if (!el) return { label, found: false }
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { label, found: true,
      tag: el.tagName.toLowerCase(),
      cls: el.className && el.className.baseVal === undefined ? el.className : '',
      w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1),
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight,
      padding: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft,
      borderRadius: cs.borderRadius,
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
      background: cs.backgroundColor,
      color: cs.color,
      cursor: cs.cursor,
      display: cs.display, align: cs.alignItems,
    }
  }
  const row = document.querySelector('.grid-area:not(.is-fs) .grid-ctl-row') || document.querySelector('.grid-ctl-row')
  if (!row) return JSON.stringify({ ok: false, reason: 'no grid-ctl-row' })
  const out = []
  out.push(pick(row.querySelector('.confirm-badge.filter:not(.badge-slim)'), 'BADGE 目标(另有N个)'))
  out.push(pick(row.querySelector('.tb-toggle'), 'LABEL 勾选框(仅显示有报单)'))
  out.push(pick(row.querySelector('button.btn.btn-sm'), 'BTN 品牌(btn-sm btn-ghost)'))
  const zoom = row.querySelector('.gz-btn') || row.querySelector('button')
  out.push(pick(zoom, 'ZOOM 缩放控件首按钮'))
  // 徽标是否可点击（有 click 监听无法直接看，退而看标签与 cursor）
  const b = row.querySelector('.confirm-badge.filter')
  if (b) {
    out.push({ label: 'BADGE 元素信息', found: true, tag: b.tagName.toLowerCase(),
      title: b.getAttribute('title') || '', role: b.getAttribute('role') || '(无)',
      tabindex: b.getAttribute('tabindex') || '(无)' })
  }
  const rr = row.getBoundingClientRect()
  return JSON.stringify({ ok: true, rowH: +rr.height.toFixed(1), rowTop: +rr.top.toFixed(1),
    rowLeft: +rr.left.toFixed(1), rowW: +rr.width.toFixed(1), items: out })
})()`

let browser
const log = (...a) => console.log(...a)
try {
  fs.mkdirSync(OUT, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4500)
  log('构建号:', await page.eval(`(() => document.documentElement.dataset.build || '?')()`))
  const m = JSON.parse(await page.eval(JS_MEASURE))
  if (!m.ok) { log('测量失败:', m.reason); }
  else {
    log('行高:', m.rowH, '| 行宽:', m.rowW)
    for (const it of m.items) {
      if (!it.found) { log('—', it.label, '未找到'); continue }
      if (!it.h) { log('—', it.label, JSON.stringify(it)); continue }
      log('——————', it.label)
      log('   ', it.tag, '|', it.w + '×' + it.h, '| top', it.top)
      log('    font', it.fontSize, it.fontWeight, '| lh', it.lineHeight)
      log('    pad', it.padding, '| radius', it.borderRadius)
      log('    border', it.border)
      log('    bg', it.background, '| color', it.color, '| cursor', it.cursor)
    }
    await page.screenshot(OUT + '/row.png')
  }
} catch (e) {
  console.error('探针异常:', e && e.message)
} finally {
  try { await browser.close() } catch (e) {}
}
