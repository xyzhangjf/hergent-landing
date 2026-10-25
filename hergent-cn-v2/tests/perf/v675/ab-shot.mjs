// v675 A/B 截图：旧 56px（运行时注入）vs 新 48px（产物真值）
// 两图都从同一次登录会话里截，保证除顶栏高度外没有任何差异。
import { chromium } from 'playwright'
import path from 'node:path'

const BASE = process.env.BASE || 'http://127.0.0.1:8901'
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '.')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 20000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1500)

const clip = { x: 0, y: 0, width: 1440, height: 66 }

// 旧档：运行时注回 56px
await page.evaluate(() => document.documentElement.style.setProperty('--topbar-h', '56px'))
await sleep(300)
await page.screenshot({ path: path.join(OUT, 'ab-old-56.png'), clip })

// 新档：撤掉注入，取产物真值 48px
await page.evaluate(() => document.documentElement.style.removeProperty('--topbar-h'))
await sleep(300)
await page.screenshot({ path: path.join(OUT, 'ab-new-48.png'), clip })

console.log('done')
await browser.close()
