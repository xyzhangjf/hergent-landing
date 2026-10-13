/* v491 生产真机探针（只读）：打开站点，监听 console / pageerror / 4xx，断言零错误。
   不登录、不点按钮、不提交任何表单。 */
const fs = require('fs')
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = process.env.HG_URL || 'https://hergent.cn/'
const OUT = process.env.HG_OUT || '/tmp'

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', protocolTimeout: 60000,
    args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  const errs = [], logs = [], exp401 = [], pageErrs = []
  /* 探针**不登录**：/api/auth/me 与云端列偏好必然 401，这是预期回执（前端有本地兜底）。
     把它们白名单化 —— 否则「6 条错误」会淹没真正的信号（pageerror / 资源 404）。 */
  const EXPECTED_401 = /\/api\/(auth\/me|ui\/col-prefs)/
  page.on('pageerror', (e) => { pageErrs.push(e.message); errs.push('pageerror: ' + e.message) })
  page.on('console', (m) => {
    logs.push(m.type() + ': ' + m.text())
    if (m.type() === 'error' && !/status of 401/.test(m.text())) errs.push('console.error: ' + m.text())
  })
  page.on('requestfailed', (r) => errs.push('requestfailed: ' + r.url() + ' — ' + ((r.failure() || {}).errorText || '')))
  page.on('response', (r) => {
    if (r.status() === 401 && EXPECTED_401.test(r.url())) { exp401.push(r.url().replace('https://hergent.cn', '')); return }
    if (r.status() >= 400) errs.push('HTTP ' + r.status() + ': ' + r.url())
  })

  const t0 = Date.now()
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction('document.querySelector("#app") && document.querySelector("#app").childElementCount > 0',
    { timeout: 30000, polling: 300 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 3500))

  const info = await page.evaluate(() => ({
    title: document.title,
    appChildren: (document.querySelector('#app') || {}).childElementCount || 0,
    scripts: [...document.querySelectorAll('script[src]')].map((s) => s.src.split('/').pop()),
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
  }))
  fs.mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: OUT + '/prod-home.png' })

  console.log('加载耗时 ' + (Date.now() - t0) + 'ms')
  console.log('标题: ' + info.title)
  console.log('#app 子节点: ' + info.appChildren)
  console.log('入口脚本: ' + info.scripts.join(', '))
  console.log('页面文字: ' + info.text)
  console.log('console 日志(前 8):\n  ' + logs.slice(0, 8).join('\n  '))
  console.log('')
  console.log('未登录预期 401（不计为错误）: ' + (exp401.length ? [...new Set(exp401)].join(', ') : '（无）'))
  console.log('JS 运行时异常(pageerror): ' + pageErrs.length)
  console.log(errs.length ? '❌ 错误 ' + errs.length + ' 条:\n  ' + errs.join('\n  ') : '✅ 零 JS 异常 / 零 4xx(除未登录 401) / 零请求失败')
  await browser.close()
  process.exit(errs.length ? 1 : 0)
})().catch((e) => { console.error('PROBE FAILED: ' + (e && e.stack || e)); process.exit(2) })
