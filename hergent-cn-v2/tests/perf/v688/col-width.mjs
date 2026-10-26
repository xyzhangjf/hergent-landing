/**
 * v688 采购建单表列宽实测（只读，不改任何数据）
 *
 * 目的：把 `.ipn-tbl { min-width: 1372px }` 降到能塞进 1536 视口（=1920 屏开 125%），
 * 需要先知道**每一列真实的宽度**，以及压窄后哪些列会换行/截断。
 *
 * 做法：不靠改代码再构建，直接在页面里改 `.ipn-tbl` 的内联 min-width 再重量（内联优先级高于类）。
 * 依次测：现状 1372 / 1240 / 1200 / 完全不设（看内容自然宽度）。
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const ROUTE = process.argv[3] || '/inventory/purchase/new'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function openForm (w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const b = page.getByRole('button', { name: /先看看演示效果/ })
  await b.first().waitFor({ timeout: 25000 })
  await b.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1200)
  await page.evaluate((r) => { location.hash = r }, ROUTE)
  await sleep(3200)
  return { ctx, page }
}

async function measure (page) {
  return page.evaluate(() => {
    const tbl = document.querySelector('.ipn-tbl')
    if (!tbl) return null
    const wrap = tbl.closest('.table-wrap') || tbl.parentElement
    const ths = [...tbl.querySelectorAll('thead th')]
    const tr = tbl.querySelector('tbody tr')
    return {
      wrapW: Math.round(wrap.getBoundingClientRect().width),
      tblW: Math.round(tbl.getBoundingClientRect().width),
      rowH: tr ? Math.round(tr.getBoundingClientRect().height) : null,
      cols: ths.map((th, i) => ({
        i,
        txt: (th.textContent || '').replace(/\s+/g, ''),
        cls: (th.className || '').split(/\s+/).filter((c) => /^(ipn-c-|seq-th)/.test(c)).join('.'),
        w: Math.round(th.getBoundingClientRect().width),
        h: Math.round(th.getBoundingClientRect().height),
        clipped: th.scrollWidth > th.clientWidth + 1,
      })),
    }
  })
}

async function setMin (page, v) {
  await page.evaluate((mx) => {
    const tbl = document.querySelector('.ipn-tbl')
    if (!tbl) return
    tbl.style.minWidth = mx === null ? '0px' : mx + 'px'
    /* 强制 reflow，确保下面量到的是新值 */
    void tbl.getBoundingClientRect().width
  }, v)
  await sleep(350)
}

for (const [vw, vh, note] of [[1536, 864, '= 1920 屏开 125%'], [1920, 1080, '台式机 100%']]) {
  console.log(`\n${'='.repeat(74)}\n视口 ${vw}×${vh}  —— ${note}\n${'='.repeat(74)}`)
  const { ctx, page } = await openForm(vw, vh)

  const base = await measure(page)
  if (!base) { console.log('❌ 没找到 .ipn-tbl'); await ctx.close(); continue }
  console.log(`容器 ${base.wrapW}px ｜ 表格 ${base.tblW}px ｜ 行高 ${base.rowH}px ｜ 列数 ${base.cols.length}`)

  for (const mx of [null, 1372, 1280, 1240, 1200]) {
    await setMin(page, mx)
    const m = await measure(page)
    const label = mx === null ? '不设 min-width（内容自然宽）' : `min-width ${mx}`
    const clip = m.cols.filter((c) => c.clipped).map((c) => `${c.txt}(${c.w})`)
    const hGrowth = base.rowH && m.rowH && m.rowH > base.rowH ? `　行高 ${base.rowH}→${m.rowH} ⚠️换行` : ''
    console.log(`\n── ${label} ── 总宽 ${m.tblW}px（容器 ${m.wrapW}）${m.tblW > m.wrapW ? '　🔴 需横滚 ' + (m.tblW - m.wrapW) + 'px' : '　✅ 放得下'}${hGrowth}`)
    console.log('   ' + m.cols.map((c) => `${c.txt}:${c.w}`).join(' | '))
    if (clip.length) console.log(`   🔴 表头被截断：${clip.join(', ')}`)
  }

  await ctx.close()
}

await browser.close()
