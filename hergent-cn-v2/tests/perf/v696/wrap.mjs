import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await chromium.launch({ headless: true, executablePath: CHROME })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto(BASE + '/?__p=696', { waitUntil: 'domcontentloaded' })
await sleep(2500)
if (!(await p.$('.topbar'))) {
  const d = p.getByRole('button', { name: /先看看演示效果/ })
  await d.first().waitFor({ timeout: 20000 }); await d.first().click()
  await p.waitForSelector('.topbar', { timeout: 30000 }); await sleep(1500)
}
await p.goto(BASE + '/#/inventory/purchase/1', { waitUntil: 'domcontentloaded' })
await sleep(2500)
const r = await p.evaluate(() => {
  let v = ''
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules } catch (e) { continue }
    if (!rules) continue
    for (const x of rules) { const t = x.selectorText || ''; if (t.includes('ipd-edit-in')) { const m = t.match(/data-v-[0-9a-z]+/); if (m) v = m[0] } }
  }
  const out = {}
  // 真实内容区宽度（侧栏展开时约 1150）
  for (const W of [1150, 1280, 1400]) {
    document.querySelectorAll('.__v696w').forEach(e => e.remove())
    const bar = document.createElement('div')
    bar.className = 'ipd-barhd __v696w'; bar.setAttribute(v, '')
    bar.style.cssText = 'position:fixed;left:0;top:0;width:' + W + 'px'
    const add = (tag, cls, val, lb, dis) => {
      const w = document.createElement('div'); w.className = 'ipd-bf'; w.setAttribute(v, '')
      const l = document.createElement('span'); l.className = 'ipd-lb'; l.setAttribute(v, '')
      l.innerHTML = '<i class="ipd-req">*</i>' + lb
      const el = document.createElement(tag); el.className = cls; el.setAttribute(v, '')
      if (tag === 'select') { const o = document.createElement('option'); o.textContent = '中转仓'; el.appendChild(o) }
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
    const h = bar.getBoundingClientRect().height
    // 数一行里有几个 ipd-bf（看折成几行）：按 top 分组
    const tops = new Set([...bar.querySelectorAll('.ipd-bf')].map(e => Math.round(e.getBoundingClientRect().top)))
    out['W' + W] = { 高度: Math.round(h), 折行数: tops.size }
    bar.remove()
  }
  return out
})
console.log(JSON.stringify(r, null, 2))
await b.close()
