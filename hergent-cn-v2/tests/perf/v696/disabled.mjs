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
for (const theme of ['light', 'dark']) {
  await p.evaluate((t) => { document.documentElement.classList.remove('light','dark'); document.documentElement.classList.add(t) }, theme)
  await sleep(300)
  const r = await p.evaluate(() => {
    const v = 'data-v-3173e2df'
    const mk = (cls, dis) => {
      const el = document.createElement('select'); el.className = cls; el.setAttribute(v, '')
      const o = document.createElement('option'); o.textContent = '中转仓'; el.appendChild(o)
      el.disabled = dis; document.body.appendChild(el); return el
    }
    const on = mk('input ipd-edit-sel', false)
    const off = mk('input ipd-edit-sel', true)
    const stdOn = mk('input', false)
    const stdOff = mk('input', true)
    const g = (el) => getComputedStyle(el).backgroundColor
    const res = { 编辑下拉_可用: g(on), 编辑下拉_已禁用: g(off), 标准下拉_可用: g(stdOn), 标准下拉_已禁用: g(stdOff) }
    ;[on, off, stdOn, stdOff].forEach(x => x.remove())
    return res
  })
  console.log('【' + theme + '】' + JSON.stringify(r, null, 0))
}
await b.close()
