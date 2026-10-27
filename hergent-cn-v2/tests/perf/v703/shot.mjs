import { chromium } from 'playwright'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read','clipboard-write'] })
await ctx.addCookies([
  { name: 'erp_token', value: process.env.HG_TOKEN, url: 'https://hergent.cn/' },
  { name: 'hergent_auth', value: '1', url: 'https://hergent.cn/' },
])
const p = await ctx.newPage()
await p.goto('https://hergent.cn/#/forecast', { waitUntil: 'domcontentloaded' })
await new Promise(r => setTimeout(r, 4500))
await p.selectOption('.sel-period', '37')
await new Promise(r => setTimeout(r, 5200))

const exportBtn = p.locator('.tb-data .tb-pop > button').first()
await exportBtn.click()
await new Promise(r => setTimeout(r, 600))
await p.screenshot({ path: '/tmp/v703-01-menu.png', clip: { x: 470, y: 60, width: 720, height: 440 } })

await p.locator('.tb-pop-panel button', { hasText: '复制整表数据' }).first().click()
await new Promise(r => setTimeout(r, 700))
const toastTxt = await p.evaluate(() => [...document.querySelectorAll('.toast')].map(e => e.textContent.trim()).join(' || '))
console.log('TOAST:', toastTxt.replace(/\s+/g, ' '))
await p.screenshot({ path: '/tmp/v703-02-toast.png', clip: { x: 700, y: 780, width: 900, height: 220 } })
await b.close()
