/**
 * v691 迁移后「弹窗骨架」回归探针
 * ==========================================================================
 * 目标不是比对像素，是确认**迁移没把弹窗弄坏**。每条都对应一个真实会翻车的点：
 *
 *   ① 弹窗真的打开了吗（v-if 挂载 / teleport 是否还通）
 *   ② 卡片尺寸还在不在（width / 圆角 / 遮罩层是否存在且铺满）
 *   ③ **字段布局没塌**（grid 两列 → 一列是最典型的静默回归：样式没生效但不报错）
 *   ④ ESC 能关（迁移前 16 页没有，现在必须有）
 *   ⑤ 点遮罩能关
 *   ⑥ 层级够高（不再被工具栏 1120 浮在上面）—— 量 z-index 必须 ≥ 1125
 *   ⑦ 标签文案没丢（slot 内容搬运时最容易被截断）
 *
 * 用法：node tests/perf/v691/modal-regression.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0, skip = 0
const say = (label, v, extra) => {
  if (v === 'PASS') { pass++; console.log('  ✅ ' + label) }
  else if (v === 'SKIP') { skip++; console.log('  ⏭️  ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
}

/* 量「当前打开的对话框」：找 z-index 最高、含 ≥2 输入控件的可见容器。
   不写死类名 —— 迁移后骨架类名是组件统一的 .ui-modal-card。 */
const MEASURE = () => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  let panel = null, bestZ = -1
  for (const el of document.querySelectorAll('div,section,form')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 200 || r.height < 80) continue
    if (el.querySelectorAll('input:not([type=hidden]),select,textarea').length < 2) continue
    const z = Number(getComputedStyle(el).zIndex) || 0
    if (z > bestZ) { bestZ = z; panel = el }
  }
  if (!panel) return null
  const cs = getComputedStyle(panel)
  const box = panel.getBoundingClientRect()
  // 遮罩：与卡片同时可见、铺满视口的 fixed 层
  let mask = null
  for (const el of document.querySelectorAll('div')) {
    if (el === panel || !vis(el)) continue
    const s = getComputedStyle(el)
    if (s.position !== 'fixed') continue
    const r = el.getBoundingClientRect()
    if (r.width >= innerWidth - 2 && r.height >= innerHeight - 2) {
      const bg = s.backgroundColor
      if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) { mask = { z: Number(s.zIndex) || 0, bg }; break }
    }
  }
  // 字段标签：弹窗里 <label><span>文字</span> 或 class 含 -field/-f 的第一列
  const labels = [...panel.querySelectorAll('label > span:first-child')]
    .map((el) => (el.textContent || '').replace(/[*＊]/g, '').trim())
    .filter(Boolean)
  // 触发按钮（打开弹窗的那颗「新增」是否浮在弹窗之上 —— v617 踩过）
  const floats = []
  for (const b of document.querySelectorAll('.tb-pop,.tb-pop-below,button')) {
    if (!vis(b)) continue
    const s = getComputedStyle(b)
    const z = Number(s.zIndex) || 0
    if (z > bestZ && b.className && /pop/.test(b.className)) floats.push({ cls: b.className, z })
  }
  return {
    cls: panel.className,
    w: Math.round(box.width), h: Math.round(box.height),
    radius: cs.borderRadius, z: bestZ,
    title: (() => {
      const b = panel.querySelector('b,h3,h2')
      return b ? (b.textContent || '').trim() : ''
    })(),
    labels,
    inputs: panel.querySelectorAll('input:not([type=hidden]),select,textarea').length,
    mask,
    floats,
  }
}

const openAndMeasure = async (page, openFn, closeFn) => {
  await openFn()
  await sleep(600)
  const m = await page.evaluate(MEASURE)
  return m
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 30000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1500)
  say('进入演示租户', 'PASS')

  /* ══════════ 品牌档案（v691 首个迁移页，最典型的两列 grid 表单） ══════════ */
  console.log('\n=== 品牌档案 · 新建品牌 ===')
  await page.evaluate(() => { location.hash = '/archive/brands' })
  await sleep(3000)
  const hasAdd = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => /^\s*\+?\s*添加品牌\s*$/.test(b.textContent || '')))
  say('品牌档案页有「+ 添加品牌」', hasAdd ? 'PASS' : 'FAIL')
  if (hasAdd) {
    await page.getByRole('button', { name: /添加品牌/ }).first().click()
    await sleep(700)
    const m = await page.evaluate(MEASURE)
    if (!m) { say('弹窗能打开', 'FAIL', '量不到任何对话框'); }
    else {
      say('弹窗能打开', 'PASS')
      say('卡片宽度 = 460（与迁移前一致）', Math.abs(m.w - 460) <= 2 ? 'PASS' : 'FAIL', m.w)
      say('标题 = 新建品牌', /新建品牌/.test(m.title) ? 'PASS' : 'FAIL', m.title)
      say('标题字号 16px（统一后）', await page.evaluate(() => {
        const b = [...document.querySelectorAll('.ui-modal-hd b')][0]
        return b ? getComputedStyle(b).fontSize : ''
      }).then((v) => v === '16px' ? 'PASS' : 'FAIL'), await page.evaluate(() => {
        const b = [...document.querySelectorAll('.ui-modal-hd b')][0]
        return b ? getComputedStyle(b).fontSize : '(none)'
      }))
      /* 圆角：比对 CSS 变量 --radius-lg 的解析值（token 就是 16px，
         直接写死 16px 会在以后调 token 时误报，故读变量） */
      const lgToken = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--radius-lg').trim())
      say('圆角 = 统一 token --radius-lg', m.radius === lgToken ? 'PASS' : 'FAIL', { got: m.radius, token: lgToken })
      say('层级 ≥ 1125（不再被工具栏 1120 压住）', m.z >= 1125 ? 'PASS' : 'FAIL', m.z)
      say('有遮罩层', m.mask ? 'PASS' : 'FAIL', m.mask)
      say('字段数 = 7', m.labels.length === 7 ? 'PASS' : 'FAIL', m.labels)
      say('标签含「品牌名称」', m.labels.some((l) => /品牌名称/.test(l)) ? 'PASS' : 'FAIL')
      say('标签含「备注」', m.labels.some((l) => /备注/.test(l)) ? 'PASS' : 'FAIL')
      /* 🔴 关键：两列布局是否还在。原 .ba-modal-body 是 grid 1fr 1fr，
         迁移后若样式没生效会静默变成一列（界面不报错，但排版变了）。 */
      const cols = await page.evaluate(() => {
        const w = document.querySelector('.ba-fields')
        if (!w) return null
        const cs = getComputedStyle(w)
        return { display: cs.display, cols: cs.gridTemplateColumns }
      })
      say('表单仍是 grid 两列（.ba-fields 生效）', cols && cols.display === 'grid' && cols.cols.split(' ').length === 2 ? 'PASS' : 'FAIL', cols)
      say('无触发按钮浮在弹窗之上', m.floats.length === 0 ? 'PASS' : 'FAIL', m.floats)

      /* ESC 关闭 */
      await page.keyboard.press('Escape')
      await sleep(400)
      const stillOpen = await page.evaluate(MEASURE)
      say('ESC 能关闭', !stillOpen ? 'PASS' : 'FAIL', stillOpen ? stillOpen.cls : '')
    }
  }

  console.log('\n=== 品牌档案 · 点遮罩关闭 ===')
  if (hasAdd) {
    await page.getByRole('button', { name: /添加品牌/ }).first().click()
    await sleep(600)
    const before = await page.evaluate(MEASURE)
    if (before) {
      await page.mouse.click(30, 30)   // 遮罩左上角空白处
      await sleep(500)
      const after = await page.evaluate(MEASURE)
      say('点遮罩能关闭', !after ? 'PASS' : 'FAIL', after ? after.cls : '')
    } else say('点遮罩能关闭', 'SKIP', '弹窗未打开')
  }
} catch (e) {
  fail++
  console.log('\n💥 探针异常：' + e.message)
}

console.log('\n═══════════════════════════════════════')
console.log(`  结果：PASS ${pass} / FAIL ${fail} / SKIP ${skip}`)
console.log('═══════════════════════════════════════')

await browser.close()
process.exit(fail ? 1 : 0)
