/* 编辑态「合计 → 客户名输入框 → 操作」区域的取证截图
 * ------------------------------------------------------------------
 * 出两张，用于对照：
 *   ① -clean.png      空框状态（灰色占位「客户名」）—— 用户看到的那一列
 *   ② -silentfail.png 有选区时按 Enter 之后：名字仍在框里、列数没变、无任何提示
 *                     且表格选中格被偷偷下移（对照上一张，表头外观完全相同）
 *
 * 用法：HG_TOKEN=xxx HG_TENANT=9998 HG_OUT=/path/prefix node forecast-cust-col-shots.js
 */
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9998'
const OUT = process.env.HG_OUT || '/tmp/custcol'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* 把表格滚到最右端，并把「合计 → 客户名 → 操作」同框裁剪出来 */
async function shoot(page, file, note) {
  const clip = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('table.edit-tbl thead tr > th')]
    const add = ths.find(x => x.querySelector('input[placeholder="客户名"]'))
    const sum = ths.find(x => (x.textContent || '').trim() === '合计')
    const op = ths.find(x => (x.textContent || '').trim() === '操作')
    if (!add || !sum || !op) return null
    const a = add.getBoundingClientRect(), s = sum.getBoundingClientRect(), o = op.getBoundingClientRect()
    return { x: Math.max(0, s.left - 118), y: Math.max(0, s.top - 8),
      width: Math.min(640, o.right - s.left + 130), height: 232 }
  })
  if (!clip) { console.log('  ERR 裁剪失败'); return }
  await page.screenshot({ path: file, clip })
  console.log('  ' + file + (note ? '   ' + note : ''))
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'custshot', display_name: '取证' }))
    try { localStorage.removeItem('hergent-forecast-draft-v1') } catch (e) {}
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5500)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '改单')
    b && b.click()
  })
  await sleep(3500)

  const scrollRight = async () => {
    await page.evaluate(() => {
      const w = document.querySelector('.edit-grid-wrap')
      if (w) w.scrollLeft = w.scrollWidth
      const inp = document.querySelector('table.edit-tbl input[placeholder="客户名"]')
      if (inp) inp.scrollIntoView({ block: 'nearest', inline: 'end' })
    })
    await sleep(600)
  }

  console.log('\n① 空框状态（灰色占位「客户名」）')
  await scrollRight()
  await shoot(page, `${OUT}-clean.png`)

  console.log('\n② 静默失败态：先点一格制造选区 → 进框输入 → Enter')
  await page.evaluate(() => {
    const td = document.querySelector('table.edit-tbl tbody td.qty-cell, table.edit-tbl tbody td.num')
    td && td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  await sleep(400)
  const before = await page.evaluate(() => {
    const tbl = document.querySelector('table.edit-tbl')
    const sel = tbl.querySelector('td.selected')
    return { cust: tbl.querySelectorAll('thead .cust-hd').length, sel: sel ? sel.getAttribute('data-r') : null }
  })
  await page.evaluate(() => {
    const inp = document.querySelector('table.edit-tbl input[placeholder="客户名"]')
    if (inp) { inp.scrollIntoView({ block: 'nearest', inline: 'end' }); inp.focus() }
  })
  await sleep(300)
  await page.keyboard.type('新客户名')
  await page.keyboard.press('Enter')
  await sleep(900)
  const after = await page.evaluate(() => {
    const tbl = document.querySelector('table.edit-tbl')
    const sel = tbl.querySelector('td.selected')
    const inp = tbl.querySelector('input[placeholder="客户名"]')
    return { cust: tbl.querySelectorAll('thead .cust-hd').length, sel: sel ? sel.getAttribute('data-r') : null, val: inp ? inp.value : null }
  })
  console.log(`   客户列 ${before.cust} → ${after.cust}（没变）｜输入框值 = ${JSON.stringify(after.val)}（留着）`)
  console.log(`   表格选中格 r${before.sel} → r${after.sel}（被偷偷下移）`)
  await scrollRight()
  await shoot(page, `${OUT}-silentfail.png`)

  await browser.close()
  console.log('\n完成')
})().catch(e => { console.error('FATAL', e); process.exit(2) })
