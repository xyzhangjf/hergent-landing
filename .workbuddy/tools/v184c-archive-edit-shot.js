'use strict'
/* v184c 交付截图：商品档案「编辑」弹窗
 * 跑法：NODE_PATH=... HG_TOKEN=xxx HG_TENANT=9997 node .workbuddy/tools/v184c-archive-edit-shot.js
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const CHROME = process.env.HG_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = process.env.HG_OUT || 'outputs/商品编辑-2026-09-17'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function waitRows(page, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < (ms || 18000)) {
    const n = await page.evaluate(() => document.querySelectorAll('table.tbl tbody tr').length)
    if (n > 0) return n
    await sleep(200)
  }
  return 0
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1560, height: 1080, deviceScaleFactor: 1 },
  })
  const page = await browser.newPage()
  await page.evaluateOnNewDocument((t, tn) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(tn))
  }, TOKEN, String(TENANT))
  await page.goto(BASE + '/#/archive/products', { waitUntil: 'networkidle2', timeout: 45000 })
  await waitRows(page)
  await sleep(900)

  await page.screenshot({ path: OUT + '/01-档案页-每行编辑入口.png' })
  console.log('01 已出')

  // 打开编辑弹窗
  await page.evaluate(() => {
    const tr = document.querySelectorAll('table.tbl tbody tr')[0]
    const b = tr && [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === '编辑')
    if (b) b.click()
  })
  await sleep(1000)
  // ⚠️ 文件名里**不能出现 `/`** —— 它会被当成路径分隔符，报 ENOENT（首轮实测踩过）。
  await page.screenshot({ path: OUT + '/02-编辑弹窗-上半（身份·品牌·价格）.png' })
  console.log('02 已出')

  // 滚到弹窗下半（库存效期/描述/状态/修改记录）
  await page.evaluate(() => {
    const b = document.querySelector('.pa-modal.pa-edit .pa-modal-body')
    if (b) b.scrollTop = b.scrollHeight
  })
  await sleep(700)
  await page.screenshot({ path: OUT + '/03-编辑弹窗-下半（描述·状态·修改记录）.png' })
  console.log('03 已出')

  // 改一个字段 → 底部出现「N 个字段已改」且保存点亮
  await page.evaluate(() => {
    const b = document.querySelector('.pa-modal.pa-edit .pa-modal-body')
    if (b) b.scrollTop = 0
  })
  await sleep(300)
  await page.evaluate(() => {
    const m = document.querySelector('.pa-modal.pa-edit')
    for (const l of m.querySelectorAll('label.pa-f')) {
      const sp = l.querySelector('span')
      if (sp && sp.textContent.trim().startsWith('标准售价')) {
        const el = l.querySelector('input')
        el.focus()
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '9.9')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
    }
  })
  await sleep(500)
  await page.screenshot({ path: OUT + '/04-未保存改动提示（只提交改过的字段）.png' })
  console.log('04 已出')

  /* 修改记录展开。
     ⚠️ 展开后**必须再滚一次** —— 组件自己会 scrollIntoView（smooth 动画要时间），
     而首轮探针是在展开**之前**滚的底，于是新增出来的记录留在视口下方，
     截图里只露出半行，看着像「记录被底部按钮栏压住」的产品缺陷（其实是探针没跟上）。 */
  await page.evaluate(() => {
    const s = document.querySelector('.pa-modal.pa-edit .pa-sec-click')
    if (s) s.click()
  })
  await sleep(2200)
  await page.evaluate(() => {
    const b = document.querySelector('.pa-modal.pa-edit .pa-modal-body')
    if (b) b.scrollTop = b.scrollHeight
  })
  await sleep(700)
  await page.screenshot({ path: OUT + '/05-修改记录（谁·何时·哪个字段·改前改后）.png' })
  console.log('05 已出')

  // 停用二次确认
  await page.evaluate(() => {
    const a = document.querySelector('.pa-modal.pa-edit .pa-active')
    const b = a && [...a.querySelectorAll('button')].find(x => /停用此商品|启用此商品/.test(x.textContent))
    if (b) b.click()
  })
  await sleep(600)
  /* ⚠️ clip 的键名必须是 width/height（不是 w/h），且值要是有限数字 ——
     CDP 反序列化只认 double，混进 undefined/NaN 会报
     「Failed to deserialize params.clip.width」（首轮实测踩过）。故统一取整并兜底。 */
  const box = await page.evaluate(() => {
    const a = document.querySelector('.pa-modal.pa-edit .pa-active')
    if (!a) return null
    const r = a.getBoundingClientRect()
    const x = Math.round(r.left) - 16, y = Math.round(r.top) - 56
    const width = Math.round(r.width) + 32, height = Math.round(r.height) + 84
    if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) return null
    return { x: Math.max(0, x), y: Math.max(0, y), width, height }
  })
  if (box) {
    await page.screenshot({ path: OUT + '/06-停用二次确认（有业务后果的动作）.png', clip: box })
    console.log('06 已出')
  } else {
    console.log('06 跳过（未能取到状态行盒模型）')
  }

  // 不改不存，直接关（避免污染沙箱）
  await page.evaluate(() => {
    const m = document.querySelector('.pa-modal.pa-edit')
    const b = m && [...m.querySelectorAll('.pa-modal-ft button')].find(x => x.textContent.trim() === '取消')
    if (b) b.click()
  })
  await sleep(500)

  await browser.close()
  console.log('截图完成 → ' + OUT)
}

main().catch(e => { console.error('截图异常:', e && e.stack || e); process.exit(1) })
