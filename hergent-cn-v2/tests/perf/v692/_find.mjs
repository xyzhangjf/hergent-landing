import { chromium } from 'playwright'

const BASE = process.env.PB || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))

await p.goto(BASE + '/?__p=' + Date.now(), { waitUntil: 'domcontentloaded' })
const demo = p.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 30000 })
await demo.first().click()
await p.waitForSelector('.topbar', { timeout: 30000 })
await sleep(2200)

const info = await p.evaluate(() => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const btns = [...document.querySelectorAll('button')]
    .filter(vis)
    .map((x) => ({
      t: (x.textContent || '').trim().slice(0, 20),
      cls: String(x.className).slice(0, 50),
      aria: x.getAttribute('aria-label') || '',
      title: x.getAttribute('title') || '',
    }))
    .filter((x) => x.t || x.aria || x.title)
  return {
    btns,
    hasDrawer: !!document.querySelector('.cp-drawer,.cp-title,[class*=copilot]'),
    me: (document.querySelector('.topbar')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
  }
})

console.log('顶栏:', info.me)
console.log('副驾容器存在:', info.hasDrawer)
console.log('--- 可见按钮 ---')
info.btns.forEach((x, i) => {
  console.log(` ${i} |${x.t}| aria=${x.aria} title=${x.title} cls=${x.cls}`)
})

await b.close()
