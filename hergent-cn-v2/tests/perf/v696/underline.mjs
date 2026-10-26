/**
 * v696 编辑态改「下划线式」—— 验收探针
 * ==========================================================================
 * 老板选 B：透明底 + 只留底边 + 高度收到 26px，信息带不被撑高。
 *
 * 验的是用户看得见/摸得着的东西：
 *   U1  背景是透明（不是任何实色，尤其不是白）
 *   U2  浅色下不再是 #fff（旧值），且与全站 .input 的关系合理
 *   U3  文字与其**真实视觉底**（透明 ⇒ 取祖先容器底色）对比度 ≥ 4.5
 *   U4  暗色下不再出现纯白（亮度 < 0.2）
 *   U5  高度 ≤ 28px（原来继承 .input 的 40px）
 *   U6  只留底边（其余三边宽度为 0）
 *   U7  聚焦时底线转主色并加厚（box-shadow 出现）
 *   U8  禁用态与可用态**可区分**（背景不同 或 底边虚线）
 *   U9  信息带整行高度（旧 57px → 目标 ≤ 44px）
 *   U10 无页面级 JS 异常
 *
 * 用法：node tests/perf/v696/underline.mjs [BASE_URL]
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

const inspect = (page) => page.evaluate(() => {
  /* scoped 域从 CSSOM 取（文件名改过 hash 会变，不能写死） */
  let vattr = ''
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules } catch (e) { continue }
    if (!rules) continue
    for (const r of rules) {
      const t = r.selectorText || ''
      if (t.includes('ipd-edit-in') || t.includes('ipd-edit-sel')) {
        const m = t.match(/data-v-[0-9a-z]+/); if (m) vattr = m[0]
      }
    }
  }
  if (!vattr) return { err: '组件 scoped 规则未加载' }

  /* 复刻信息带的排版环境（flex + baseline），量高度才准 */
  const bar = document.createElement('div')
  bar.className = 'ipd-barhd'; bar.setAttribute(vattr, '')
  bar.id = '__v696bar'
  bar.style.cssText = 'position:fixed;left:0;top:0;width:1400px'
  document.body.appendChild(bar)

  const mk = (tag, cls, val, wrapBar = true) => {
    const el = document.createElement(tag); el.className = cls; el.setAttribute(vattr, '')
    if (tag === 'select') { const o = document.createElement('option'); o.textContent = '中转仓'; el.appendChild(o) }
    else el.value = val
    if (wrapBar) {
      const w = document.createElement('div'); w.className = 'ipd-bf'; w.setAttribute(vattr, '')
      const lb = document.createElement('span'); lb.className = 'ipd-lb'; lb.setAttribute(vattr, '')
      lb.textContent = '字段'
      w.appendChild(lb); w.appendChild(el); bar.appendChild(w)
    } else { document.body.appendChild(el) }
    return el
  }
  const inp = mk('input', 'input ipd-edit-in', '张三')
  inp.id = '__v696focus'
  const sel = mk('select', 'input ipd-edit-sel', '')
  const date = mk('input', 'input ipd-edit-in ipd-edit-in-sm', '2026-10-26')
  const dis = mk('select', 'input ipd-edit-sel', '')
  dis.disabled = true
  const std = mk('input', 'input', '标准', false)

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
  const snap = (el) => {
    const c = getComputedStyle(el), r = el.getBoundingClientRect()
    return {
      bg: c.backgroundColor, color: c.color,
      h: +r.height.toFixed(1), w: +r.width.toFixed(1),
      bw: [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth],
      bStyle: c.borderBottomStyle, bColor: c.borderBottomColor,
      shadow: c.boxShadow === 'none' ? '' : c.boxShadow.slice(0, 60),
      realBg: bgOf(el)
    }
  }

  const out = {
    vattr,
    inp: snap(inp), sel: snap(sel), date: snap(date), dis: snap(dis), std: snap(std),
    barH: +bar.getBoundingClientRect().height.toFixed(1),
    focus: null
  }
  /* 聚焦态留给外面读：这里挂了 transition .15s，当场读会读到过渡起点（透明/0px），
     造成「聚焦没生效」的假报警 —— 2026-10-26 已踩过一次。 */
  return out
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
  const build = await page.evaluate(() => window.__HG_BUILD__ || '')
  ck('构建号 v696', /^v696/.test(build), 'got=' + build)

  await page.goto(BASE + '/#/inventory/purchase/1', { waitUntil: 'domcontentloaded' })
  await sleep(3000)

  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.classList.remove('light', 'dark')
      document.documentElement.classList.add(t)
      localStorage.setItem('hergent_theme', t)
    }, theme)
    await sleep(350)
    console.log('\n━━━ ' + (theme === 'light' ? '浅色主题' : '暗色主题'))

    const r = await inspect(page)
    if (r.err) { ck('能取到组件样式', false, r.err); continue }

    /* 聚焦态：真聚焦 + 等过渡走完再读（当场读会读到过渡起点） */
    await page.focus('#__v696focus')
    await sleep(300)
    const focusInfo = await page.evaluate(() => {
      const el = document.getElementById('__v696focus')
      if (!el) return { ok: false }
      const c = getComputedStyle(el)
      return { ok: true, gotFocus: document.activeElement === el, borderBottomColor: c.borderBottomColor, shadow: c.boxShadow }
    })
    await page.evaluate(() => { const b = document.getElementById('__v696bar'); if (b) b.remove() })

    const bg = parseRGB(r.inp.bg)
    const realBg = parseRGB(r.inp.realBg)
    const fg = parseRGB(r.inp.color)

    console.log('    输入框: bg=' + r.inp.bg + '  color=' + hex(fg) + '  高=' + r.inp.h + 'px  真实底=' + hex(realBg))
    console.log('    下拉  : bg=' + r.sel.bg + '  禁用 bg=' + r.dis.bg + '  底边=' + r.dis.bStyle)
    console.log('    标准  : bg=' + r.std.bg + '（全站基准）')
    console.log('    信息带整行高=' + r.barH + 'px（改造前 57px / 纯文本态约 21px）')

    ck('背景透明（不写死任何实色）', r.inp.bg === 'rgba(0, 0, 0, 0)', r.inp.bg)
    ck('不是白底', lum(bg) === 0 || r.inp.bg === 'rgba(0, 0, 0, 0)', 'bg=' + r.inp.bg)
    ck('文字 vs 真实视觉底 对比度 ≥ 4.5', contrast(fg, realBg) >= 4.5,
      contrast(fg, realBg).toFixed(2) + ':1  (' + hex(fg) + ' on ' + hex(realBg) + ')')
    ck('高度 ≤ 28px', r.inp.h <= 28, r.inp.h + 'px')
    ck('只留底边（上/右/左 = 0）',
      r.inp.bw[0] === '0px' && r.inp.bw[1] === '0px' && r.inp.bw[3] === '0px',
      'top/right/left=' + [r.inp.bw[0], r.inp.bw[1], r.inp.bw[3]].join('/'))
    ck('底边存在且是实线', parseFloat(r.inp.bw[2]) > 0 && r.inp.bStyle === 'solid', r.inp.bStyle + ' ' + r.inp.bw[2])
    ck('聚焦底线变主色', focusInfo.ok && focusInfo.borderBottomColor !== r.inp.bColor,
      (focusInfo.ok ? focusInfo.borderBottomColor : 'n/a') + ' vs 常态 ' + r.inp.bColor)
    ck('聚焦有加厚（box-shadow 非 none 非零）',
      focusInfo.ok && /rgba?\(\d/.test(focusInfo.shadow) && !/0px 0px 0px 0px/.test(focusInfo.shadow),
      focusInfo.ok ? focusInfo.shadow : 'n/a')
    ck('禁用态与可用态可区分',
      r.dis.bg !== r.sel.bg || r.dis.bStyle !== r.sel.bStyle,
      '可用 ' + r.sel.bg + '/solid  vs  禁用 ' + r.dis.bg + '/' + r.dis.bStyle)
    ck('信息带整行高 ≤ 44px', r.barH <= 44, r.barH + 'px')
    ck('日期输入宽度仍是 140px', r.date.w === 140, r.date.w + 'px')
  }

  /* 造三张对照截图，肉眼复核 */
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.classList.remove('light', 'dark')
      document.documentElement.classList.add(t)
    }, theme)
    await sleep(300)
    await page.evaluate(() => {
      const old = document.getElementById('__v696box'); if (old) old.remove()
      let vattr = ''
      for (const ss of document.styleSheets) {
        let rules; try { rules = ss.cssRules } catch (e) { continue }
        if (!rules) continue
        for (const r of rules) {
          const t = r.selectorText || ''
          if (t.includes('ipd-edit-in')) { const m = t.match(/data-v-[0-9a-z]+/); if (m) vattr = m[0] }
        }
      }
      const bar = document.createElement('div')
      bar.className = 'ipd-barhd'; bar.setAttribute(vattr, '')
      bar.id = '__v696box'
      bar.style.cssText = 'position:fixed;left:30px;top:110px;z-index:99999;width:1200px;padding:6px 16px 10px;'
        + 'border-radius:10px;background:var(--bg);border:1px solid var(--border-subtle);box-shadow:var(--shadow-md)'
      const add = (tag, cls, val, lb, dis) => {
        const w = document.createElement('div'); w.className = 'ipd-bf'; w.setAttribute(vattr, '')
        const l = document.createElement('span'); l.className = 'ipd-lb'; l.setAttribute(vattr, '')
        l.innerHTML = '<i class="ipd-req" style="font-style:normal;color:#d8453b">*</i>' + lb
        const el = document.createElement(tag); el.className = cls; el.setAttribute(vattr, '')
        if (tag === 'select') { const o = document.createElement('option'); o.textContent = dis ? '中转仓（已锁定）' : '中转仓'; el.appendChild(o) }
        else el.value = val
        if (dis) el.disabled = true
        w.appendChild(l); w.appendChild(el); bar.appendChild(w)
      }
      add('select', 'input ipd-edit-sel', '', '业务员')
      add('select', 'input ipd-edit-sel', '', '部门')
      add('select', 'input ipd-edit-sel', '', '仓库', true)
      add('input', 'input ipd-edit-in', '月底结账前到', '备注')
      add('input', 'input ipd-edit-in ipd-edit-in-sm', '2026-10-26', '单据日期')
      add('input', 'input ipd-edit-in ipd-edit-in-sm', '2026-10-30', '预计到货')
      document.body.appendChild(bar)
    })
    await sleep(300)
    const el = await page.$('#__v696box')
    if (el) await el.screenshot({ path: '/tmp/v696b-bar-' + theme + '.png' }).catch(() => {})
  }

  ck('无页面级 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '))
  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAILURE') + '  pass=' + pass + ' fail=' + fail)
  await browser.close()
}

main().catch((e) => { console.error('探针崩溃:', e); process.exit(1) })
