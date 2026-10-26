import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await chromium.launch({ headless: true, executablePath: CHROME })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto(BASE + '/?__p=696', { waitUntil: 'domcontentloaded' })
await sleep(2000)
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
    for (const x of rules) { const t = x.selectorText || ''; if (t.includes('ipd-edit-sel')) { const m = t.match(/data-v-[0-9a-z]+/); if (m) v = m[0] } }
  }
  const mk = (cls, dis, tag = 'select') => {
    const el = document.createElement(tag); el.className = cls; el.setAttribute(v, '')
    if (tag === 'select') { const o = document.createElement('option'); o.textContent = '中转仓'; el.appendChild(o) }
    el.disabled = dis; document.body.appendChild(el); return el
  }
  const selOn = mk('input ipd-edit-sel', false)
  const selOff = mk('input ipd-edit-sel', true)
  const inOn = mk('input ipd-edit-in', false, 'input')
  const inOff = mk('input ipd-edit-in', true, 'input')
  const g = (e) => getComputedStyle(e).backgroundColor
  const res = {
    scopedId: v,
    下拉可用: g(selOn), 下拉禁用: g(selOff),
    输入可用: g(inOn), 输入禁用: g(inOff),
    版本: window.__HG_BUILD__
  }
  ;[selOn, selOff, inOn, inOff].forEach(e => e.remove())
  return res
})
console.log(JSON.stringify(r, null, 0))
await b.close()
