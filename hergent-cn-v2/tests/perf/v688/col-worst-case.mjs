/**
 * v688 采购建单表「最不利密度」实测（只读，不改数据）
 *
 * 上一版 col-width.mjs 只能量空行 ⇒ 不知道填满内容后各列够不够。
 * 这里直接往单元格里**注入最长的典型值**（13 位条码 / 8 位数金额 / 16 字商品名），
 * 在 min-width 1372（现状）与 1200（拟改）两档下对比：
 *
 *   - 数字类列（条码/价格/数量/金额/库存）：**必须完整显示** —— 金额被 ellipsis 截掉就是财务事故
 *   - 文本类列（商品名/备注）：允许 … 省略，但要能看到开头
 *
 * 判据用 td 的 scrollWidth vs clientWidth（内容宽 > 可视宽 ⇒ 被裁）。
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 最不利的典型值：按「合法但极端」取，不是随便编长串 */
const WORST = {
  '*商品': '蒙牛特仑苏纯牛奶梦幻盖礼盒装250ml',
  '条码': '6921234567890',
  '单位': '箱',
  '参考成本价': '¥12,345.67',
  '*采购价': '12345.67',
  '*订单数量': '9999.99',
  '订单金额': '¥1,234,567.80',
  '可用可售': '9999.99',
  '实际库存': '9999.99',
  '占用': '999.99',
  '批次信息': '20261026',
  '行备注': '这批要冷藏注意温度',
}
/** 数字类列：截断即事故 */
const NUM_COLS = new Set(['条码', '*采购价', '*订单数量', '订单金额', '可用可售', '实际库存', '占用', '参考成本价'])

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1200)
await page.evaluate(() => { location.hash = '/inventory/purchase/new' })
await sleep(3200)

const hasTable = await page.evaluate(() => !!document.querySelector('.ipn-tbl tbody tr'))
if (!hasTable) { console.log('❌ 页面没有明细行，无法注入'); await browser.close(); process.exit(1) }

for (const mx of [1372, 1200]) {
  const r = await page.evaluate(({ mx, WORST }) => {
    const tbl = document.querySelector('.ipn-tbl')
    tbl.style.minWidth = mx + 'px'
    void tbl.getBoundingClientRect().width

    const ths = [...tbl.querySelectorAll('thead th')]
    const tr = tbl.querySelector('tbody tr')
    const tds = [...tr.children]
    const baseH = Math.round(tr.getBoundingClientRect().height)

    /* 注入：优先写 .ipn-v（有 ellipsis 样式的那层），否则写 td 本身 */
    tds.forEach((td, i) => {
      const col = (ths[i]?.textContent || '').replace(/\s+/g, '')
      const v = WORST[col]
      if (!v) return
      const s = td.querySelector('.ipn-v')
      if (s) s.textContent = v
      else td.textContent = v
    })
    void tbl.getBoundingClientRect().width

    const rowH = Math.round(tr.getBoundingClientRect().height)
    const cells = tds.map((td, i) => ({
      col: (ths[i]?.textContent || '').replace(/\s+/g, '') || '(齿轮)',
      cw: Math.round(td.clientWidth),
      sw: Math.round(td.scrollWidth),
      clipped: td.scrollWidth > td.clientWidth + 1,
    }))
    return {
      tblW: Math.round(tbl.getBoundingClientRect().width),
      wrapW: Math.round(tbl.closest('.table-wrap').getBoundingClientRect().width),
      baseH, rowH, cells,
    }
  }, { mx, WORST })

  console.log(`\n${'='.repeat(70)}\nmin-width ${mx}px　表格 ${r.tblW}px / 容器 ${r.wrapW}px${r.tblW > r.wrapW ? '　🔴 需横滚 ' + (r.tblW - r.wrapW) + 'px' : '　✅ 放得下'}`)
  console.log(`行高 ${r.baseH}px → 注入后 ${r.rowH}px${r.rowH > r.baseH ? '　🔴 换行顶高' : '　✅ 未换行'}`)
  console.log(`${'列'.padEnd(12)} ${'列宽'.padStart(5)} ${'内容宽'.padStart(6)}  判定`)
  for (const c of r.cells) {
    if (c.col === '(齿轮)') continue
    const num = NUM_COLS.has(c.col)
    let verdict = '✅ 完整'
    if (c.clipped) verdict = num ? '🔴 数字被截断（事故）' : '⚠️ 文字省略（可接受）'
    console.log(`${c.col.padEnd(12)} ${String(c.cw).padStart(5)} ${String(c.sw).padStart(6)}  ${verdict}`)
  }
}

await browser.close()
