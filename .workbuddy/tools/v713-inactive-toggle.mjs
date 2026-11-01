/**
 * v713 生产真机验证 —— 「已停用记录默认收起」公共件在 7 个页面的实际表现
 *
 * 判据设计（每条都能证伪）：
 *   A. 商品档案：有 104 条停用 ⇒ 开关必须存在，且点击后 `.pa-stat b`（后端 total）必须变化。
 *      🔴 用后端 total 而不是 DOM 行数：本页服务端分页每页 50 行，行数恒等于 50，看不出效果。
 *   B. 员工/品牌/渠道/告警/买赠：当前停用数为 0 ⇒ 开关必须**不渲染**（「（0）」是噪音）。
 *      ⚠️ 这里验的是「不存在」，不能算作「没验到」—— 反过来若它出现了，就是 count 判据写错了。
 *   C. 报单对象：6 条停用 ⇒ 回归 v712 的 21/27 行，确认收敛到公共件后行为不变。
 *   D. 几何：开关必须是 32 高 / 13px / radius 8 / padding 0 12px（= .btn-sm 那一档）。
 *      这条同时证明**组件自带的 scoped 样式真的加载了**（它落在共享 chunk 的 css 里）。
 */
import { launch } from './lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const FAIL = []
const check = (l, c, e = '') => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '  ' + e : '')); if (!c) FAIL.push(l) }

const b = await launch({ headless: true })
const page = await b.newPage()
await page.enable()
await page.raw.send('Network.enable')
await page.goto(BASE + '/login', 3200)
for (const c of [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' },
  { name: 'csrf_token', value: 'x' },
  { name: 'hergent_tenant', value: '1' },
]) await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })

/* JS 报错收集 —— 任何一页有异常都不该算过 */
const jsErrors = []
page.raw.onEvent((m) => {
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    jsErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text)
  }
})

const mouseClick = async (x, y) => {
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
}

/* 读开关：是否存在 + 文案 + 几何 + 中心坐标 */
const readToggle = () => page.eval(`(() => {
  const el = [...document.querySelectorAll('.tb-toggle')].find(e => /显示已停用/.test(e.textContent) && e.getBoundingClientRect().width > 10)
  if (!el) return { exists: false }
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
  const num = (el.textContent.match(/（(\\d+)/) || [])[1]
  return {
    exists: true, text: el.textContent.trim().replace(/\\s+/g, ' '), count: num ? Number(num) : null,
    h: +r.height.toFixed(1), w: +r.width.toFixed(1),
    fs: cs.fontSize, rad: cs.borderRadius, padL: cs.paddingLeft, padR: cs.paddingRight,
    on: el.classList.contains('on'),
    cx: r.left + r.width / 2, cy: r.top + r.height / 2,
  }
})()`)

const checkGeom = (t, label) => {
  check(`${label} 开关高 32（与 .btn-sm 同档）`, Math.abs(t.h - 32) < 0.6, 'h=' + t.h)
  check(`${label} 字号 13px`, t.fs === '13px', t.fs)
  check(`${label} 圆角 8px`, t.rad === '8px', t.rad)
  check(`${label} 左右内边距 12px`, t.padL === '12px' && t.padR === '12px', `${t.padL}/${t.padR}`)
}

/* ═══════════ A. 商品档案（104 条停用，唯一有真实数据的页面） ═══════════ */
console.log('\n══════ A. 商品档案（停用 104 / 启用 390） ══════')
await page.goto(BASE + '/#/archive/products', 8000)
await sleep(2200)

const prodTotal = () => page.eval(`(() => { const el = document.querySelector('.pa-stat b'); return el ? Number(el.textContent.replace(/[^0-9]/g, '')) : null })()`)

let t0 = await readToggle()
check('开关存在（有 104 条停用，必须给出口）', t0.exists === true, t0.exists ? '' : '未找到 .tb-toggle')
if (t0.exists) {
  console.log('   文案:', t0.text, '| 计数:', t0.count)
  checkGeom(t0, '商品档案')
  check('计数 = 104（生产停用商品数）', t0.count === 104, 'count=' + t0.count)
  check('默认未勾选（默认收起）', t0.on === false, 'class on=' + t0.on)

  const before = await prodTotal()
  check('默认总数 = 390（只含启用）', before === 390, 'total=' + before)

  await mouseClick(t0.cx, t0.cy)
  await sleep(2600)
  const after = await prodTotal()
  const t1 = await readToggle()
  check('点开后总数 = 494（全量）', after === 494, `${before} → ${after}`)
  check('点开后开关进入高亮态', t1.on === true, 'class on=' + t1.on)

  /* 收回 */
  if (t1.exists) {
    await mouseClick(t1.cx, t1.cy)
    await sleep(2600)
    const back = await prodTotal()
    check('再点一次回到 390（可逆）', back === 390, `${after} → ${back}`)
  }
}

/* ═══════════ B. 其余 5 页：停用数为 0 ⇒ 开关必须不渲染 ═══════════ */
const zeroPages = [
  { name: '员工档案', path: '/#/archive/employees' },
  { name: '品牌档案', path: '/#/archive/brands' },
  { name: '渠道与价格', path: '/#/archive/prices' },
  { name: '告警规则', path: '/#/alerts' },
  { name: '买赠活动', path: '/#/mkt/promotions' },
]

for (const p of zeroPages) {
  console.log(`\n══════ B. ${p.name}（停用 0 条） ══════`)
  await page.goto(BASE + p.path, 7500)
  await sleep(1800)
  const t = await readToggle()
  const body = await page.eval(`(() => {
    const el = document.querySelector('.page')
    return el ? (el.innerText || '').trim().slice(0, 200) : ''
  })()`)
  const hasErr = /失败|错误|加载中/.test(body) && body.length < 40
  check('页面正常渲染（非报错页）', !hasErr, hasErr ? body.slice(0, 60) : '')
  check('开关不渲染（停用 0 条，「（0）」是噪音）', t.exists === false, t.exists ? '竟然存在：' + t.text : '')
}

/* ═══════════ C. 报单对象：v712 回归（6 条停用 / 21 启用） ═══════════ */
console.log('\n══════ C. 报单对象（停用 6 / 启用 21） ══════')
await page.goto(BASE + '/#/forecast?tab=config', 9000)
await sleep(2200)

const rows = () => page.eval(`(() => {
  const trs = [...document.querySelectorAll('.tbl tbody tr')].filter(tr => !tr.querySelector('td.empty'))
  return trs.length
})()`)

let r0 = await rows()
let tc = await readToggle()
check('开关存在', tc.exists === true, tc.exists ? '' : '未找到')
if (tc.exists) {
  checkGeom(tc, '报单对象')
  check('计数 = 6', tc.count === 6, 'count=' + tc.count)
  check('默认 21 行（= 启用数）', r0 === 21, 'rows=' + r0)
  await mouseClick(tc.cx, tc.cy)
  await sleep(1400)
  const r1 = await rows()
  const tc1 = await readToggle()
  check('展开 27 行（= 全量）', r1 === 27, `${r0} → ${r1}`)
  if (tc1.exists) {
    await mouseClick(tc1.cx, tc1.cy)
    await sleep(1200)
    check('收回报 21 行', (await rows()) === 21, '')
  }
}

/* ═══════════ D. 375px 窄屏：商品档案筛选行加控件后会不会溢出 ═══════════ */
console.log('\n══════ D. 375px 窄屏（商品档案筛选行） ══════')
await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true })
await page.goto(BASE + '/#/archive/products', 8000)
await sleep(2000)
const nar = await page.eval(`(() => {
  const box = document.querySelector('.pa-filters')
  const el = [...document.querySelectorAll('.tb-toggle')].find(e => /显示已停用/.test(e.textContent) && e.getBoundingClientRect().width > 10)
  const r = el ? el.getBoundingClientRect() : null
  return {
    overflowX: document.documentElement.scrollWidth - innerWidth,
    toggleRight: r ? +r.right.toFixed(1) : null,
    toggleW: r ? +r.width.toFixed(1) : null,
    toggleRows: r ? +r.height.toFixed(1) : null,
    wrap: box ? getComputedStyle(box).flexWrap : null,
  }
})()`)
console.log('   ', JSON.stringify(nar))
check('375px 无横向溢出', nar.overflowX <= 0, '溢出 ' + nar.overflowX + 'px')
check('开关在视口内', nar.toggleRight === null || nar.toggleRight <= 375.5, 'right=' + nar.toggleRight)
check('开关未被压变形（宽 > 100）', nar.toggleW !== null && nar.toggleW > 100, 'w=' + nar.toggleW)

/* ═══════════ E. JS 报错 ═══════════ */
console.log('\n══════ E. 运行时异常 ══════')
check('全程无未捕获 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '))

console.log('\n' + '='.repeat(56))
if (FAIL.length) { console.log('FAILED ' + FAIL.length + ' 项：'); FAIL.forEach(x => console.log('  · ' + x)) }
else console.log('RESULT: ALL PASS')
console.log('='.repeat(56))
await b.close()
process.exit(FAIL.length ? 1 : 0)
