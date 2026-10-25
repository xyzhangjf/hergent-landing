// v675 顶栏高度真机探针（只读 · 演示租户）
// 目的：验证 --topbar-h 由 56 → 48 后，
//   ① .topbar 实际高度 = 48（不是被别的东西撑住）
//   ② 栏内三件（.tb-btn / .tb-copilot / .wx-now）上下呼吸位对称且 ≥6px
//   ③ 没有任何控件被栏边裁掉（rect 不越界 + 无溢出滚动）
//   ④ 与旧值 56px 的 A/B（运行时注入令牌，不改产物）
// 用法：先起 tests/perf/v655/serve-dist.mjs，再 node tests/perf/v675/topbar-probe.mjs
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

const BASE = process.env.BASE || 'http://127.0.0.1:8901'
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '.')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

const logs = []
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
// 真实登录流程：演示入口（httpOnly Cookie 由后端 Set-Cookie，不能用 JS 塞 token）
// ⚠️ domcontentloaded 时 Vue 还没挂载，直接 count() 会得 0 ⇒「点了」其实是没点。
//    必须先等按钮出现（这一坑在 v673 探针里踩过，表现为 waitForSelector('.topbar') 超时）。
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 20000 })
await demo.first().click()
console.log('→ 已点「先看看演示效果」')
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1800)

const measure = async () => page.evaluate(() => {
  const bar = document.querySelector('.topbar')
  const br = bar.getBoundingClientRect()
  const cs = getComputedStyle(document.documentElement)
  /* 🔴 呼吸位必须按 **content box** 算：.topbar 有 border-bottom:1px，
     直接拿 rect.bottom 当底会得出"上 6.5 / 下 7.5"的假不对称（v675 首跑就误判了 4 条）。 */
  const bs = getComputedStyle(bar)
  const padT = parseFloat(bs.borderTopWidth) || 0
  const padB = parseFloat(bs.borderBottomWidth) || 0
  const innerTop = br.top + padT
  const innerBottom = br.bottom - padB
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      sel,
      h: +r.height.toFixed(2),
      top: +r.top.toFixed(2),
      bottom: +r.bottom.toFixed(2),
      gapTop: +(r.top - innerTop).toFixed(2),
      gapBottom: +(innerBottom - r.bottom).toFixed(2),
      radius: getComputedStyle(el).borderTopLeftRadius,
    }
  }
  return {
    token: cs.getPropertyValue('--topbar-h').trim(),
    bar: { h: +br.height.toFixed(2), top: +br.top.toFixed(2), bottom: +br.bottom.toFixed(2) },
    barScroll: { scrollH: bar.scrollHeight, clientH: bar.clientHeight },
    barPad: getComputedStyle(bar).padding,
    ctrls: ['.tb-btn.tb-bell', '.tb-copilot', '.wx-now', '.tb-user', '.tb-brand-logo']
      .map(pick).filter(Boolean),
    bodyTop: (() => { const b = document.querySelector('.body'); return b ? +b.getBoundingClientRect().top.toFixed(2) : null })(),
  }
})

const now = await measure()
console.log('\n=== 当前产物（v675）===')
console.log(JSON.stringify(now, null, 2))

// A/B：运行时把令牌注回 56（模拟 v674），量同一批坐标
const old = await page.evaluate(async () => {
  const de = document.documentElement
  de.style.setProperty('--topbar-h', '56px')
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const bar = document.querySelector('.topbar')
  const br = bar.getBoundingClientRect()
  const bs = getComputedStyle(bar)
  const innerTop = br.top + (parseFloat(bs.borderTopWidth) || 0)
  const innerBottom = br.bottom - (parseFloat(bs.borderBottomWidth) || 0)
  const g = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { sel, gapTop: +(r.top - innerTop).toFixed(2), gapBottom: +(innerBottom - r.bottom).toFixed(2) } }
  const res = { barH: +br.height.toFixed(2), ctrls: ['.tb-btn.tb-bell', '.tb-copilot', '.wx-now'].map(g).filter(Boolean) }
  de.style.removeProperty('--topbar-h')
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return res
})
console.log('\n=== A/B：运行时注回 56px（v674 旧档）===')
console.log(JSON.stringify(old, null, 2))

await page.screenshot({ path: path.join(OUT, 'v675-topbar-1440.png'), clip: { x: 0, y: 0, width: 1440, height: 140 } })
await page.setViewportSize({ width: 1366, height: 768 })
await sleep(600)
const small = await measure()
await page.screenshot({ path: path.join(OUT, 'v675-topbar-1366.png'), clip: { x: 0, y: 0, width: 1366, height: 140 } })
console.log('\n=== 1366×768 ===')
console.log(JSON.stringify({ token: small.token, bar: small.bar, ctrls: small.ctrls }, null, 2))

// 判定
const errs = []
if (now.token !== '48px') errs.push('令牌不是 48px：' + now.token)
if (Math.abs(now.bar.h - 48) > 0.6) errs.push('.topbar 实际高度不是 48：' + now.bar.h)
if (now.barScroll.scrollH > now.barScroll.clientH) errs.push('顶栏内部溢出：scrollH>clientH')
for (const c of now.ctrls) {
  if (c.sel === '.tb-brand-logo') continue
  if (c.top < now.bar.top - 0.5 || c.bottom > now.bar.bottom + 0.5) errs.push(c.sel + ' 越出顶栏边界')
  if (c.gapTop < 6 || c.gapBottom < 6) errs.push(`${c.sel} 呼吸位不足（上${c.gapTop} 下${c.gapBottom}）`)
  if (Math.abs(c.gapTop - c.gapBottom) > 0.6) errs.push(c.sel + ` 上下不对称（上${c.gapTop} 下${c.gapBottom}）`)
}
if (Math.abs((old.barH || 0) - 56) > 0.6) errs.push('A/B 的 56px 档没生效（barH=' + old.barH + '）')
if (!(now.bar.h < old.barH)) errs.push('48 档没有比 56 档矮')
if (small.bar.h !== 48) errs.push('1366 视口下高度不是 48：' + small.bar.h)

console.log('\n' + (errs.length ? 'FAILED:\n - ' + errs.join('\n - ') : 'PASS ✅ 顶栏 48px，控件上下各 7px，无越界/溢出'))
const bad = logs.filter((l) => /pageerror|error:/i.test(l))
if (bad.length) console.log('页面错误：\n' + bad.slice(0, 8).join('\n'))
await browser.close()
process.exit(errs.length ? 1 : 0)
