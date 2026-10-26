import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await chromium.launch({ headless: true, executablePath: CHROME })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
await p.goto(BASE + '/?__p=696', { waitUntil: 'domcontentloaded' })
await sleep(2500)
if (!(await p.$('.topbar'))) {
  const d = p.getByRole('button', { name: /先看看演示效果/ })
  await d.first().waitFor({ timeout: 20000 }); await d.first().click()
  await p.waitForSelector('.topbar', { timeout: 30000 }); await sleep(1500)
}
await p.goto(BASE + '/#/inventory/purchase/1', { waitUntil: 'domcontentloaded' })
await sleep(2500)

const build = async (mode) => p.evaluate((mode) => {
  document.querySelectorAll('.__v696res').forEach(e => e.remove())
  let v = ''
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules } catch (e) { continue }
    if (!rules) continue
    for (const x of rules) { const t = x.selectorText || ''; if (t.includes('ipd-edit-in')) { const m = t.match(/data-v-[0-9a-z]+/); if (m) v = m[0] } }
  }
  // 改造前的旧规则（写死白底 + 40px 圆角框），只在 mode==='before' 时注入
  if (mode === 'before') {
    const st = document.createElement('style'); st.className = '__v696res'
    st.textContent = `.ipd-edit-in[${v}],.ipd-edit-sel[${v}]{height:40px;padding:0 14px;border:1px solid var(--t3);border-radius:6px;background:#fff;color:var(--t1)}`
    document.head.appendChild(st)
  }
  const bar = document.createElement('div')
  bar.className = 'ipd-barhd'; bar.id = '__v696bar2'; bar.setAttribute(v, '')
  bar.style.cssText = 'position:fixed;left:24px;top:100px;z-index:99999;width:1180px;padding:6px 16px 10px;'
    + 'border-radius:10px;background:var(--bg);border:1px solid var(--border-subtle);box-shadow:var(--shadow-md)'
  const add = (tag, cls, val, lb, dis) => {
    const w = document.createElement('div'); w.className = 'ipd-bf'; w.setAttribute(v, '')
    const l = document.createElement('span'); l.className = 'ipd-lb'; l.setAttribute(v, '')
    l.innerHTML = '<i class="ipd-req">*</i>' + lb
    const el = document.createElement(tag); el.className = cls; el.setAttribute(v, '')
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
  return Math.round(bar.getBoundingClientRect().height)
}, mode)

for (const theme of ['light', 'dark']) {
  await p.evaluate((t) => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(t) }, theme)
  await sleep(300)
  for (const mode of ['before', 'after']) {
    const h = await build(mode)
    await sleep(250)
    const el = await p.$('#__v696bar2')
    if (el) await el.screenshot({ path: `/tmp/v696-${mode}-${theme}.png` }).catch(() => {})
    console.log(theme + ' / ' + mode + ' → 信息带高 ' + h + 'px')
  }
}
await b.close()
