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
await sleep(3500)
const found = await p.evaluate(() => {
  const out = []
  for (const ss of document.styleSheets) {
    let rules
    try { rules = ss.cssRules } catch (e) { continue }
    if (!rules) continue
    for (const r of rules) {
      const t = r.selectorText || ''
      if (t.includes('ipd-edit-in') || t.includes('ipd-edit-sel') || t.includes('ipd-barhd')) {
        out.push({ sel: t, css: r.style && r.style.cssText ? r.style.cssText.slice(0, 220) : '' })
      }
    }
  }
  return out
})
console.log('命中规则数 =', found.length)
for (const f of found) console.log('• ' + f.sel + '\n  ' + f.css)
const tabPane = await p.evaluate(() => {
  const el = document.querySelector('.tab-pane')
  if (!el) return null
  const cs = getComputedStyle(el)
  return { bg: cs.backgroundColor, cls: el.className }
})
console.log('tab-pane =', JSON.stringify(tabPane))
await b.close()
