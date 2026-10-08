/* v306c 真机探针：验证「部署自检提示」两件事 ——
   ① **不该报时不报**：页面已是最新版 ⇒ 不能出现提示（否则是恒真的假警报）；
   ② **该报时报**：服务器已发新版而页面还是旧的 ⇒ 必须出现提示，且确实能刷新、不压住页头控件。
   🔴 为什么必须真机验：这是「页面自己判断自己旧不旧」的逻辑，只有把它放进真实浏览器、
      配一次真的 `index.html` 响应差异，才能证明它在用户手里真的会亮。
      打桩只在 Node 里验过（v306c-appupdate-test.mjs，13/13），那一层证明正则对，
      这一层证明**接线对**（挂在根组件上、能渲染、能点）。

   用法：
     PROBE_BASE=https://hergent.cn MP_USER=mptest MP_PASS=... node <本文件>
   只读：除登录外不写任何业务数据（路由改写只发生在浏览器内存里）。
*/
import { createRequire } from 'node:module'
import fs from 'node:fs'

const PROJ = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const require = createRequire(PROJ + '/package.json')
const { chromium } = require('playwright')

const BASE = process.env.PROBE_BASE || 'https://hergent.cn'
const USER = process.env.MP_USER || 'mptest'
const PASS = process.env.MP_PASS || ''
if (!PASS) { console.error('[中止] 缺 MP_PASS'); process.exit(2) }

const SHOT = process.env.PROBE_SHOT || '/tmp/v306c-upd-tip.png'
const FAKE_ENTRY = 'index-ZZZZFAKE9.js'

let fail = 0
const chk = (ok, msg) => { if (!ok) fail++; console.log('  ' + (ok ? '✅' : '❌') + '  ' + msg) }

const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

let loads = 0
page.on('load', () => loads++)

console.log('① 打开 ' + BASE + ' 并登录（mptest）')
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(1200)
if (await page.locator('input[placeholder="用户名"]').count()) {
  await page.fill('input[placeholder="用户名"]', USER)
  await page.fill('input[placeholder="密码"]', PASS)
  await page.click('button.btn-primary.btn-block')
  await page.waitForTimeout(3500)
}
chk(!(await page.locator('input[placeholder="用户名"]').count()), '登录成功')

const cur = await page.evaluate(() => {
  const s = document.querySelector('script[type="module"][src*="/assets/index-"]')
  return s ? s.getAttribute('src') : ''
})
console.log('   当前页面跑的入口 = ' + cur)

/* ---------- ② 反例：页面已是最新 ⇒ 不能出现提示（防恒真） ---------- */
console.log('\n② 反例：页面已是最新版 —— 提示**必须不出现**')
await page.waitForTimeout(2500)   // 自检在 mount 时跑，给足时间
const tip0 = await page.locator('.upd-tip').count()
chk(tip0 === 0, '页面已最新时提示数为 ' + tip0 + '（期望 0）—— 不是恒真警报')

/* ---------- ③ 正例：让服务器"看起来"发了新版（只改浏览器里那一次响应） ---------- */
console.log('\n③ 正例：模拟「服务器已发新版、你这个页面是旧的」')
const FAKE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>probe</title></head>' +
  '<body><div id="app"></div>' +
  '<script type="module" src="/assets/' + FAKE_ENTRY + '"></script></body></html>'
await page.route('**/index.html*', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FAKE_HTML }))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

const tip = page.locator('.upd-tip')
const n1 = await tip.count()
chk(n1 === 1, '旧页面 + 服务器新版 ⇒ 提示出现（数量 = ' + n1 + '，期望 1）')
if (n1) {
  const txt = (await tip.innerText()).replace(/\s+/g, ' ').trim()
  console.log('   提示文案：' + txt)
  chk(txt.indexOf('有新版本可用') >= 0, '文案含「有新版本可用」')
  chk(txt.indexOf('点击刷新') >= 0, '文案含「点击刷新」')

  const box = await tip.boundingBox()
  console.log('   位置：y=' + Math.round(box.y) + ' 高=' + Math.round(box.height) + '（视口 900）')
  chk(box.y > 400, '提示在页面下半部（y=' + Math.round(box.y) + ' > 400）—— 不压页头控件')
  chk(box.y + box.height < 900, '提示完整落在视口内（底边 ' + Math.round(box.y + box.height) + ' < 900）')

  await page.screenshot({ path: SHOT })
  console.log('   截图 → ' + SHOT)

  /* ---------- ④ 点它必须真的刷新 ---------- */
  console.log('\n④ 点「点击刷新」：必须真的重新加载页面')
  const before = loads
  const loaded = page.waitForEvent('load', { timeout: 15000 }).then(() => true).catch(() => false)
  await tip.click()
  const ok = await loaded
  chk(ok === true, '点击后触发了页面重新加载（load 事件 ' + before + ' → ' + loads + '）')
} else {
  fail++
  console.log('  ❌  提示未出现，后续断言跳过')
}

console.log('\n' + (fail ? '🔴 有 ' + fail + ' 项未通过' : '🟢 部署自检提示真机验证全部通过'))
await browser.close()
process.exit(fail ? 1 : 0)
