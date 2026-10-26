import { chromium } from 'playwright'
const src = process.argv[2] || '/tmp/report_test.html'
const out = process.argv[3] || '/tmp/report_full.png'
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const p = await (await b.newContext({ viewport: { width: 1180, height: 1400 }, deviceScaleFactor: 2 })).newPage()
await p.goto('file://' + src)
await p.waitForTimeout(600)
await p.screenshot({ path: out, fullPage: true })
const errs = []
p.on('pageerror', e => errs.push(String(e)))
console.log('已截图', out, errs.length ? '页面报错:' + errs.join('|') : '无 JS 错误')
await b.close()
