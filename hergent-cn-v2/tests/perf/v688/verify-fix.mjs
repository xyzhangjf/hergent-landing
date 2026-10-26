/**
 * v688 修复效果验证（只读）
 *
 * 验证三处改动（min-width 1372→1200 / prod 240→200 / note 150→100）能否让
 * 13 列在最不利密度下塞进 1536 视口（125% 缩放）的 1248px 容器。
 *
 * 用注入等价 CSS 的方式先算数值 —— 与改源码后构建出来的效果一致，
 * 但省掉一次「构建 → 部署 → 探针」的往返。确认数值达标后再改源码构建。
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 关键：auto 布局下列宽被**内容撑开**，只改 min-width/width 无效（实测商品列仍 244）。
 * 必须给 td 加 max-width + 让内部文本能省略，且**只在窄视口生效** ——
 * 否则 1920 台式机上商品列会从 411px 被硬压成 200px。
 * 阈值 1680：视口 1920 时容器 1632（不触发）／1536 时容器 1248（触发）。
 */
const FIX = `
  @media (max-width: 1680px) {
    .ipn-tbl { min-width: 1200px !important }
    .ipn-c-prod { min-width: 200px !important; max-width: 200px !important }
    .ipn-c-prod .ipn-v { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
    .ipn-c-note { max-width: 100px !important }
    .ipn-c-note .ipn-in, .ipn-c-note input { width: 100% !important }
  }
`
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
const NUM_COLS = new Set(['条码', '*采购价', '*订单数量', '订单金额', '可用可售', '实际库存', '占用', '参考成本价'])

const browser = await chromium.launch({ channel: 'chrome', headless: true })

for (const [w, h, note] of [[1536, 864, '笔记本 125%（目标：放得下）'], [1440, 900, '1440 屏'], [1920, 1080, '台式机（目标：不变）']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const b = page.getByRole('button', { name: /先看看演示效果/ })
  await b.first().waitFor({ timeout: 25000 })
  await b.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1200)
  await page.evaluate(() => { location.hash = '/inventory/purchase/new' })
  await sleep(3200)

  await page.addStyleTag({ content: FIX })
  await sleep(300)

  const r = await page.evaluate((WORST) => {
    const tbl = document.querySelector('.ipn-tbl')
    const ths = [...tbl.querySelectorAll('thead th')]
    const tr = tbl.querySelector('tbody tr')
    if (!tr) return { err: 'no row' }
    const tds = [...tr.children]
    const baseH = Math.round(tr.getBoundingClientRect().height)
    tds.forEach((td, i) => {
      const col = (ths[i]?.textContent || '').replace(/\s+/g, '')
      const v = WORST[col]
      if (!v) return
      const s = td.querySelector('.ipn-v')
      if (s) s.textContent = v
      else td.textContent = v
    })
    void tbl.getBoundingClientRect().width
    return {
      tblW: Math.round(tbl.getBoundingClientRect().width),
      wrapW: Math.round(tbl.closest('.table-wrap').getBoundingClientRect().width),
      baseH,
      rowH: Math.round(tr.getBoundingClientRect().height),
      cells: tds.map((td, i) => ({
        col: (ths[i]?.textContent || '').replace(/\s+/g, '') || '(齿轮)',
        cw: Math.round(td.clientWidth),
        clipped: td.scrollWidth > td.clientWidth + 1,
      })),
    }
  }, WORST)

  if (r.err) { console.log(`\n❌ ${w}: ${r.err}`); await ctx.close(); continue }

  const over = r.tblW - r.wrapW
  console.log(`\n${'='.repeat(62)}\n${w}×${h}　${note}`)
  console.log(`表格 ${r.tblW}px / 容器 ${r.wrapW}px　${over > 0 ? `🔴 仍横滚 ${over}px` : `✅ 放得下（余 ${-over}px）`}`)
  console.log(`行高 ${r.baseH} → ${r.rowH}px　${r.rowH > r.baseH ? '🔴 换行' : '✅ 未换行'}`)
  const numClip = r.cells.filter((c) => c.clipped && NUM_COLS.has(c.col))
  const txtClip = r.cells.filter((c) => c.clipped && !NUM_COLS.has(c.col))
  console.log(`数字列截断：${numClip.length ? '🔴 ' + numClip.map((c) => c.col).join(', ') : '✅ 无'}`)
  console.log(`文本列省略：${txtClip.length ? '⚠️ ' + txtClip.map((c) => c.col).join(', ') : '✅ 无'}`)
  console.log('   ' + r.cells.map((c) => `${c.col}:${c.cw}`).join(' | '))
  await ctx.close()
}

await browser.close()
