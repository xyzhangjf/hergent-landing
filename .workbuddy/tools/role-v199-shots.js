// 真机截图（生产 hergent.cn）：预报主表已从「页面出错了」恢复正常渲染。
// 只读：仅页面加载 + 截图，不点击任何写操作。令牌由外部临时注入、跑完即删。
//
// 为什么需要这张图：本轮修的是「一进预报页就 RangeError 自递归 → 整页被 ErrorBoundary 兜成
// 「页面出错了」」。文案类断言（探针 18/18）能证明 DOM 里有什么，但**这张图是唯一能一眼看出
// 「页面是活的」的证据** —— 崩溃态与正常态的区别就在「有没有东西」。
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const TOKEN = process.env.PROD_TOKEN
const OUT = process.env.OUT_DIR || '/tmp'
if (!TOKEN) { console.error('缺少 PROD_TOKEN'); process.exit(2) }

const shots = [
  { hash: '#/forecast', name: '01-预报主表-已恢复正常渲染（生产真机）.png' },
  { hash: '#/archive/employees', name: '02-员工档案-登录账号文案（生产真机）.png' },
]

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--no-proxy-server'],
  })
  for (const s of shots) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1560, height: 1000, deviceScaleFactor: 2 })
    await page.evaluateOnNewDocument(t => {
      localStorage.setItem('hergent_v2_token', t)
      localStorage.setItem('hergent_v2_tenant', '1')
    }, TOKEN)
    await page.goto('https://hergent.cn/?cb=' + Date.now() + s.hash, { waitUntil: 'networkidle2' })
    await new Promise(r => setTimeout(r, 4000))
    const txt = await page.evaluate(() => document.body.innerText.length)
    const file = OUT + '/' + s.name
    await page.screenshot({ path: file })
    console.log('%s  ←  body.innerText = %d 字符', file, txt)
    await page.close()
  }
  await browser.close()
})().catch(e => { console.error('运行异常:', e); process.exit(2) })
