/**
 * v678 全站排查（结构注入法）：对"演示租户这类页面没有数据"的表格，用**真实样式 +
 * 真实列结构**造一行，让浏览器自己回答"这些动作会不会折行"。
 *
 * 两种模式：
 *   clone —— 表格已渲染出真实行：克隆该行、保留其余格真实内容，只给「操作」格补齐
 *            最坏情况的按钮并集。（保留其余格很关键：清空它们会让 auto 布局把宽度
 *            全分给最后一列，量出"659px 的操作列"，那是假结论。）
 *   build —— 表格根本没渲染（数据为空）：按源码的 thead + 一行典型内容自建表格，
 *            放进同宽度的 `.table-wrap` 里量。这是**近似**（列内容长度是估的），
 *            用于回答"会不会折行"这个数量级问题，不做像素级结论。
 *
 * 判据：操作格里所有按钮的 `top` 去重 > 1 ⇒ 折行（行高被撑高的根因）。
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:8903'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CASES = [
  {
    route: '#/forecast?tab=history', mode: 'clone', table: 'table.history-tbl',
    labels: ['查看', '复制', '修改', '关闭', '推送', '解锁编辑', '删除'], cls: 'btn btn-sm btn-ghost',
  },
  {
    route: '#/rebate', mode: 'build',
    heads: ['', '规则名称', '维度', '周期', '作用对象', '目标值', '触发', '返利', '生效期', '状态', ''],
    cells: ['1', '蒙牛低温 10 月销量返利', '品牌', '月度', '全部', '3,000', '阶梯', '1.5%', '2026-10-01 ~ 2026-10-31', '进行中'],
    labels: ['详情', '编辑', '算式', '版本', '复制', '停用', '删除'], cls: 'btn-mini',
  },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1500)

for (const c of CASES) {
  await page.evaluate((h) => { location.hash = h }, c.route)
  await sleep(2600)
  const r = await page.evaluate((cs) => {
    const wrap = document.createElement('div')
    wrap.id = '__v678_probe'
    wrap.style.cssText = 'margin-top:12px'
    let table
    if (cs.mode === 'clone') {
      const t = document.querySelector(cs.table)
      if (!t) return { err: '找不到表格 ' + cs.table }
      const srcRow = t.querySelector('tbody tr')
      if (!srcRow) return { err: '表格没有行' }
      table = t.cloneNode(true)
      table.id = ''
      const tb = table.querySelector('tbody')
      tb.querySelectorAll('tr').forEach((tr, i) => { if (i > 0) tr.remove() })
      const row = tb.querySelector('tr')
      const op = row.lastElementChild
      for (const lb of cs.labels) {
        if ([...op.querySelectorAll('button')].some((b) => b.textContent.trim() === lb)) continue
        const b = document.createElement('button'); b.className = cs.cls; b.textContent = lb
        op.appendChild(b)
      }
    } else {
      table = document.createElement('table')
      table.className = 'tbl'
      const thead = document.createElement('thead')
      const htr = document.createElement('tr')
      for (const h of cs.heads) { const th = document.createElement('th'); th.textContent = h; htr.appendChild(th) }
      thead.appendChild(htr); table.appendChild(thead)
      const tbody = document.createElement('tbody')
      const tr = document.createElement('tr')
      for (const v of cs.cells) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td) }
      const op = document.createElement('td')
      for (const lb of cs.labels) { const b = document.createElement('button'); b.className = cs.cls; b.textContent = lb; op.appendChild(b) }
      tr.appendChild(op); tbody.appendChild(tr); table.appendChild(tbody)
    }
    wrap.appendChild(table)
    const host = document.querySelector('.page') || document.body
    host.appendChild(wrap)
    const opCell = table.querySelector('tbody tr').lastElementChild
    const kids = [...opCell.querySelectorAll('button')]
    const tops = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top)))
    const res = {
      cols: table.querySelector('tbody tr').children.length,
      tableW: Math.round(table.getBoundingClientRect().width),
      hostW: Math.round(host.getBoundingClientRect().width),
      opCellW: Math.round(opCell.getBoundingClientRect().width),
      rowH: Math.round(table.querySelector('tbody tr').getBoundingClientRect().height),
      btnCount: kids.length,
      btnW: kids.length ? Math.round(kids[0].getBoundingClientRect().width) : 0,
      lines: tops.size,
    }
    wrap.remove()
    return res
  }, c)
  console.log(`\n=== ${c.route}（${c.labels.length} 个动作 · ${c.mode}）===`)
  if (r.err) { console.log('  ⚠️ ' + r.err); continue }
  console.log(`  容器 ${r.hostW}｜表格 ${r.tableW}｜操作列 ${r.opCellW}｜单按钮 ${r.btnW}｜行高 ${r.rowH}`)
  console.log(r.lines > 1 ? `  🔴 折成 ${r.lines} 行 ⇒ 行高被撑高` : '  ✅ 单行（列会自动加宽，不折行）')
}
await browser.close()
