/**
 * v696 采购详情「编辑态输入框背景变白」—— 取证探针（最终版）
 * ==========================================================================
 * 报障：点「备注」后的铅笔 → 业务员/部门/仓库/备注/单据日期/预计到货
 *       六个控件的背景变成白色。
 *
 * 取证方式（不靠眼睛、不靠猜）：
 *   ① 从 CSSOM 取组件真实的 scoped 规则（含 data-v 域），确认写入值就是 #fff；
 *   ② 把带同样 class + 同样 data-v 域的控件注入**真实页面容器**，
 *      读 getComputedStyle ⇒ 得到浏览器最终使用的底色；
 *   ③ 与全局 `.input`（全站标准输入框，var(--bg3)）做差；
 *   ④ 浅色 / 暗色各测一遍，算 WCAG 对比度（暗色下 #fff 是致命的）；
 *   ⑤ 截图存档。
 *
 * ⚠️ 已知边界：demo 账号是只读租户，没有铅笔按钮，也打不开别人的采购单，
 *    所以这里验的是**样式**（根因所在），不是"点铅笔"这条交互路径。
 *
 * 用法：node tests/perf/v696/edit-bg.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const parseRGB = (s) => {
  const m = String(s).match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const p = m[1].split(',').map((x) => parseFloat(x.trim()))
  return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]
}
const contrast = (fg, bg) => {
  const a = lum(fg), b = lum(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const hex = (rgb) => rgb ? '#' + rgb.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : '?'

let pass = 0, fail = 0
const ck = (label, ok, extra) => {
  if (ok) { pass++; console.log('    ✅ ' + label + (extra ? '  ← ' + extra : '')) }
  else { fail++; console.log('    ❌ ' + label + (extra ? '  ← ' + extra : '')) }
}

const readStyles = (page) => page.evaluate(() => {
  /* 1) 找出组件 scoped 规则与其 data-v 域 */
  let vattr = '', decl = {}, sel = ''
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules } catch (e) { continue }
    if (!rules) continue
    for (const r of rules) {
      const t = r.selectorText || ''
      if (!t.includes('ipd-edit-in') && !t.includes('ipd-edit-sel')) continue
      const m = t.match(/data-v-[0-9a-z]+/)
      if (m) vattr = m[0]
      decl[t] = r.style.cssText
      sel = t
    }
  }
  if (!vattr) return { err: '未找到组件 scoped 规则（组件未加载？）' }

  /* 2) 找一个真实容器（详情页主体），把控件注入进去 */
  const host = document.querySelector('.ipd-barhd')
    || document.querySelector('.tab-pane')
    || document.querySelector('.page') || document.querySelector('main')
    || document.querySelector('.content') || document.body

  const mk = (tag, cls) => {
    const el = document.createElement(tag)
    el.className = cls
    el.setAttribute(vattr, '')
    if (tag === 'select') {
      const o = document.createElement('option'); o.textContent = '中转仓'; el.appendChild(o)
    } else { el.value = '张三' }
    host.appendChild(el)
    return el
  }
  const a = mk('input', 'input ipd-edit-in')
  const b = mk('select', 'input ipd-edit-sel')
  const c = mk('input', 'input')

  const bgOf = (el) => {
    let p = el.parentElement, bg = 'rgba(0, 0, 0, 0)'
    while (p) {
      const s = getComputedStyle(p).backgroundColor
      const m = s.match(/rgba?\(([^)]+)\)/)
      const al = m ? parseFloat(m[1].split(',')[3] ?? 1) : 0
      if (s !== 'transparent' && al > 0.9) { bg = s; break }
      p = p.parentElement
    }
    return bg
  }
  const cs = (el) => {
    const s = getComputedStyle(el)
    return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor, ancestorBg: bgOf(el) }
  }
  const r = {
    vattr,
    editIn: cs(a), editSel: cs(b), std: cs(c),
    host: host.className || host.tagName,
    dark: document.documentElement.classList.contains('dark')
  }
  a.remove(); b.remove(); c.remove()
  return r
})

const main = async () => {
  const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  let browser
  try { browser = await chromium.launch({ headless: true, executablePath: CHROME }) }
  catch (_) { browser = await chromium.launch({ headless: true }) }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))

  console.log('\n━━━ 打开 ' + BASE)
  await page.goto(BASE + '/?__p=696', { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  if (!(await page.$('.topbar'))) {
    const demo = page.getByRole('button', { name: /先看看演示效果/ })
    await demo.first().waitFor({ timeout: 20000 })
    await demo.first().click()
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await sleep(1500)
  }

  /* demo 租户下采购单接口的真实响应（判断能否拿到真单） */
  const api = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/psi/purchase-orders?limit=3', { credentials: 'same-origin' })
      const j = await r.json()
      return { status: r.status, keys: Object.keys(j || {}), n: (j.rows || j.data || j.items || []).length }
    } catch (e) { return { status: 0, err: String(e) } }
  })
  console.log('    采购单接口 ' + JSON.stringify(api))

  await page.goto(BASE + '/#/inventory/purchase/1', { waitUntil: 'domcontentloaded' })
  await sleep(3000)

  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.classList.remove('light', 'dark')
      document.documentElement.classList.add(t)
      localStorage.setItem('hergent_theme', t)
    }, theme)
    await sleep(400)
    console.log('\n━━━ ' + (theme === 'light' ? '浅色主题（默认）' : '暗色主题'))

    const r = await readStyles(page)
    if (r.err) { ck('能取到组件 scoped 规则', false, r.err); continue }

    console.log('    scoped 域: ' + r.vattr + '   容器: ' + r.host)
    console.log('    .ipd-edit-in  背景 ' + hex(parseRGB(r.editIn.bg)) + '   文字 ' + hex(parseRGB(r.editIn.color)) + '   边框 ' + hex(parseRGB(r.editIn.border)))
    console.log('    .ipd-edit-sel 背景 ' + hex(parseRGB(r.editSel.bg)) + '   文字 ' + hex(parseRGB(r.editSel.color)))
    console.log('    全局 .input   背景 ' + hex(parseRGB(r.std.bg)) + '  ← 全站标准值')
    console.log('    控件所在容器底色 ' + hex(parseRGB(r.editIn.ancestorBg)))

    const bgIn = parseRGB(r.editIn.bg)
    const bgStd = parseRGB(r.std.bg)
    const bgPar = parseRGB(r.editIn.ancestorBg)
    const fgIn = parseRGB(r.editIn.color)

    ck('两个编辑控件与全局 .input 同底色？（不一致即为 bug）',
      hex(bgIn) === hex(bgStd), '编辑框=' + hex(bgIn) + ' vs 标准=' + hex(bgStd))
    ck('背景与容器的对比度 < 1.3（不该跳出来当白块）',
      contrast(bgIn, bgPar) < 1.3,
      'ratio=' + contrast(bgIn, bgPar).toFixed(3) + ':1  (' + hex(bgIn) + ' on ' + hex(bgPar) + ')')
    ck('文字/背景对比度 ≥ 4.5（AA）',
      contrast(fgIn, bgIn) >= 4.5, 'ratio=' + contrast(fgIn, bgIn).toFixed(2) + ':1')
    if (theme === 'dark') {
      ck('暗色下不是白底（亮度 < 0.2）', lum(bgIn) < 0.2, 'luminance=' + lum(bgIn).toFixed(3))
    }
  }

  /* 截图：暗色主题下把三件并排画出来，肉眼可见白块 */
  await page.evaluate(() => {
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add('dark')
  })
  await sleep(350)
  const shot = await page.evaluate(() => {
    const host = document.querySelector('.ipd-barhd') || document.querySelector('.page') || document.querySelector('main') || document.body
    const box = document.createElement('div')
    box.id = '__v696demo'
    box.style.cssText = 'position:fixed;left:40px;top:120px;z-index:99999;padding:16px 20px;border-radius:12px;'
      + 'background:var(--bg2);border:1px solid var(--bd);box-shadow:var(--shadow-md);display:flex;gap:14px;align-items:center;'
      + 'font-size:13px;color:var(--t1)'
    const vattr = 'data-v-3173e2df'
    const mk = (tag, cls, label) => {
      const w = document.createElement('div')
      w.style.cssText = 'display:flex;align-items:center;gap:7px'
      const lb = document.createElement('span')
      lb.textContent = label
      lb.style.cssText = 'font-size:11.5px;color:var(--t3)'
      const el = document.createElement(tag)
      el.className = cls
      el.setAttribute(vattr, '')
      if (tag === 'select') { const o = document.createElement('option'); o.textContent = '中转仓'; el.appendChild(o) }
      else el.value = '张三'
      w.appendChild(lb); w.appendChild(el)
      return w
    }
    box.appendChild(mk('select', 'input ipd-edit-sel', '业务员'))
    box.appendChild(mk('input', 'input ipd-edit-in', '备注'))
    box.appendChild(mk('input', 'input', '标准输入框'))
    document.body.appendChild(box)
    return true
  })
  await sleep(300)
  const el = await page.$('#__v696demo')
  if (el) await el.screenshot({ path: '/tmp/v696-compare-dark.png' }).catch(() => {})
  const elL = await page.evaluate(() => {
    document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light')
  })
  await sleep(300)
  const el2 = await page.$('#__v696demo')
  if (el2) await el2.screenshot({ path: '/tmp/v696-compare-light.png' }).catch(() => {})

  ck('无页面级 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '))

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAILURE') + '  pass=' + pass + ' fail=' + fail)
  await browser.close()
}

main().catch((e) => { console.error('探针崩溃:', e); process.exit(1) })
