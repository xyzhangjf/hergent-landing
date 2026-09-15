// 「修改日志」面板截图（沙箱租户，只读本页）
// 用 sb_up.py 造出来的令牌：入口位置 + 面板四段式 + 全局折叠区
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const OUT = process.env.HG_OUT

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=2'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'e2e', display_name: '王翠花' }))
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise(r => setTimeout(r, 5000))
  console.log('URL:', page.url())

  // 选期次
  const picked = await page.evaluate(() => {
    const sel = document.querySelector('.toolbar .sel-period')
    if (!sel) return null
    const opt = [...sel.options].find(o => /9月第4期/.test(o.textContent))
    if (!opt) return { opts: [...sel.options].map(o => o.textContent) }
    sel.value = opt.value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return { value: opt.value, name: opt.textContent }
  })
  console.log('期次:', JSON.stringify(picked))
  await new Promise(r => setTimeout(r, 3500))

  // 点「修改日志」
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('body button')].find(x => (x.textContent || '').includes('修改日志'))
    if (!b) return false
    b.click()
    return true
  })
  await new Promise(r => setTimeout(r, 2200))
  console.log('点击修改日志:', clicked)

  // 展开全局操作区
  const expanded = await page.evaluate(() => {
    const h = document.querySelector('.at-global-hd')
    if (!h) return false
    h.click(); return true
  })
  await new Promise(r => setTimeout(r, 900))
  console.log('展开全局区:', expanded)

  // 面板内容自检（截图要能说明问题，先确认渲染对了）
  const state = await page.evaluate(() => {
    const p = document.querySelector('.audit-log-panel')
    if (!p) return { panel: false }
    const lis = [...p.querySelectorAll('.at-log li')]
    return {
      panel: true,
      rows: lis.length,
      lines: lis.map(li => li.textContent.replace(/\s+/g, ' ').trim()),
      top: Math.round(p.getBoundingClientRect().top),
      globalToggle: !!p.querySelector('.at-global-hd'),
    }
  })
  console.log('面板状态:', JSON.stringify(state, null, 2))

  // 按钮 + 面板一起入画（说明"入口在哪、点开长什么样"）
  const clip = await page.evaluate(() => {
    const b = [...document.querySelectorAll('body button')].find(x => (x.textContent || '').includes('修改日志'))
    const p = document.querySelector('.audit-log-panel')
    if (!b || !p) return null
    const rb = b.getBoundingClientRect(), rp = p.getBoundingClientRect()
    const x = Math.max(0, Math.min(rb.left, rp.left) - 24)
    const y = Math.max(0, rb.top - 24)
    const right = Math.max(rb.right, rp.right) + 24
    const bottom = Math.min(document.documentElement.scrollHeight, rp.bottom + 24)
    return { x: Math.round(x), y: Math.round(y), width: Math.round(right - x), height: Math.round(bottom - y) }
  })
  console.log('裁剪区:', JSON.stringify(clip))

  if (clip && clip.height > 60) {
    await page.screenshot({ path: OUT, clip })
    console.log('已截图(特写):', OUT)
  }
  await page.screenshot({ path: OUT.replace(/\.png$/, '-全页.png') })
  console.log('已截图(全页):', OUT.replace(/\.png$/, '-全页.png'))

  await browser.close()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
