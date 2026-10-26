import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:5188'
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
console.log('URL =', p.url())
const txt = await p.evaluate(() => document.body.innerText.slice(0, 600))
console.log('--- 页面文字 ---\n' + txt)
const me = await p.evaluate(async () => { const r = await fetch('/api/auth/me', {credentials:'same-origin'}); return (await r.json()) })
console.log('--- me ---', JSON.stringify(me).slice(0, 400))
await p.screenshot({ path: '/tmp/v696-diag.png' })
await b.close()
