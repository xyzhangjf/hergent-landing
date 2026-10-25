// v676 A/B：侧栏条目旧 38.8/40.4px vs 新 34px（同一会话，除条目样式外零差异）
// 🔴 `.sb-item` 带 `transition:all .15s` ⇒ 注入/撤销后必须等 > 150ms 再截图/测量，
//    否则读到的是动画中间值（v676 首测量到 34.4 就是中途态，不是最终 38.8）。
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
await sleep(1800)

const clip = { x: 0, y: 48, width: 268, height: 700 }
const measure = () => page.evaluate(() => {
  const hs = [...document.querySelectorAll('.sb-item')].map((el) => +el.getBoundingClientRect().height.toFixed(1))
  return { heights: [...new Set(hs)], total: +hs.reduce((a, b) => a + b, 0).toFixed(1) }
})

// 旧态：注回 v675 的 padding 9 + 继承行高 1.6
await page.evaluate(() => {
  const st = document.createElement('style')
  st.id = 'ab-old'
  st.textContent = '.sb-item{padding:9px 10px !important;line-height:1.6 !important}'
  document.head.appendChild(st)
})
await sleep(450)
console.log('旧态:', JSON.stringify(await measure()))
await page.screenshot({ path: path.join(OUT, 'ab-old-38.png'), clip })

// 新态：撤掉注入
await page.evaluate(() => document.getElementById('ab-old')?.remove())
await sleep(450)
console.log('新态:', JSON.stringify(await measure()))
await page.screenshot({ path: path.join(OUT, 'ab-new-34.png'), clip })

// 弹层定位回归：条目变矮后 `.sb-pop` 仍须贴着被点的按钮（placePop 按 rect 算，不该写死偏移）
const pop = await (async () => {
  const btn = page.locator('.sb-area-btn', { hasText: '进销存' }).first()
  await btn.click()
  await page.waitForSelector('.sb-pop', { timeout: 8000 })
  await sleep(400)
  const r = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sb-area-btn')].find((x) => x.innerText.includes('进销存'))
    const p = document.querySelector('.sb-pop')
    const br = b.getBoundingClientRect()
    const pr = p.getBoundingClientRect()
    return {
      btn: { top: +br.top.toFixed(1), bottom: +br.bottom.toFixed(1) },
      pop: { top: +pr.top.toFixed(1), left: +pr.left.toFixed(1), w: +pr.width.toFixed(0), h: +pr.height.toFixed(0) },
      gap: +(pr.top - br.bottom).toFixed(1),
      inViewport: pr.top >= 0 && pr.bottom <= innerHeight && pr.right <= innerWidth,
      items: [...p.querySelectorAll('.sb-pop-item')].slice(0, 3).map((el) => +el.getBoundingClientRect().height.toFixed(1)),
    }
  })
  await page.screenshot({ path: path.join(OUT, 'v676-pop-after.png'), clip: { x: 0, y: 0, width: 900, height: 620 } })
  await page.keyboard.press('Escape')
  return r
})()
console.log('弹层:', JSON.stringify(pop))

console.log('done')
await browser.close()
