#!/usr/bin/env node
/* ============================================================================
   v721-scroll-region-audit.mjs — 「一屏一个滚动区」审计探针
   ----------------------------------------------------------------------------
   老板口径（2026-11-02）：「能做成一个滚动区就不要做成两个滚动区」。
   ⇒ 判定标准不是"有没有滚动条"，而是**同一屏里是否存在嵌套的两个滚动区**：
      外层 `.view-wrap` 在滚、里面还有一块（表格/明细）也在滚。
      用户在这种页面上滚一次就迷路：光标在表里滚 → 页面不动；滚到表外 → 表格又跑了。

   审计口径（只认实测，不认声明）：
     · 滚动区 = 在实际布局里真的**溢出**（scrollHeight>clientHeight+4 或
       scrollWidth>clientWidth+4）且 overflow 为 auto/scroll 的可见元素；
       `overflow:hidden` 也算"被截断"，但它是 fail 而不是 pass（内容看不见），
       故单独标 `clip`，不计入滚动区数量。
     · `nested` = 该滚动区内部还有≥1 个滚动区 ⇒ 这就是要消灭的形态。

   用法：
     HG_TOKEN=<boss token> node .workbuddy/tools/v721-scroll-region-audit.mjs
     HG_TOKEN=... node .workbuddy/tools/v721-scroll-region-audit.mjs --grow     # 单据页注入 45 行逼出长内容
     HG_TOKEN=... node .workbuddy/tools/v721-scroll-region-audit.mjs --wide     # 1440×900（默认）
   ============================================================================ */
import { writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))

/* 重点页：8 个单据/退货页 + 3 个列表页（v721 改过的）+ 2 个普通列表页做对照 */
const PAGES = [
  ['采购建单', '/inventory/purchase/new', true],
  ['采购退货', '/inventory/purchase/return/new', true],
  ['销售建单', '/inventory/sale/new', true],
  ['自提退单', '/inventory/sale/self-pickup/return/new', true],
  ['车销退单', '/inventory/sale/vehicle/return/new', true],
  ['调拨建单', '/inventory/transfer/new', true],
  ['采购单列表', '/inventory/purchase', false],
  ['销售单列表', '/inventory/sale', false],
  ['调拨单列表', '/inventory/transfer', false],
  ['商品档案', '/archive/products', false],
  ['告警规则', '/alerts', false],
  ['招标雷达', '/bid-radar', false],
  ['员工档案', '/archive/employees', false],
]

/* 全站页清单（--all 用）：从 v720 冻结审计探针继承，保证两次审计的页集合一致 */
const PAGES_ALL = [
  ['工作台', '/workbench'], ['看板', '/dashboard'], ['本期预报', '/forecast'], ['返利', '/rebate'],
  ['亏损核算', '/loss-accounting'], ['工资', '/payroll'], ['数据填报', '/data-fill'], ['舟谱导入', '/zhoupu-import'],
  ['商品档案', '/archive/products'], ['客户档案', '/archive/customers'], ['品牌档案', '/archive/brands'],
  ['仓库档案', '/archive/warehouses'], ['供应商档案', '/archive/suppliers'], ['员工档案', '/archive/employees'],
  ['销售单', '/inventory/sale'], ['采购单', '/inventory/purchase'], ['调拨单', '/inventory/transfer'],
  ['库存', '/inventory/stock'], ['批次追溯', '/inventory/batch-trace'], ['审批中心', '/inventory/approvals'],
  ['采购建单', '/inventory/purchase/new'], ['销售建单', '/inventory/sale/new'], ['调拨建单', '/inventory/transfer/new'],
  ['报表设计器', '/reports/builder'], ['库存周转', '/reports/inventory-turnover'], ['促销ROI', '/reports/promo-roi'],
  ['采购汇总', '/reports/purchase'], ['调拨汇总', '/reports/transfer'], ['数据健康', '/reports/data-health'],
  ['开放接口', '/openapi/console'], ['促销', '/mkt/promotions'],
  ['入库', '/wh/inbound'], ['出库', '/wh/outbound'], ['盘点', '/wh/stocktake'], ['仓储策略', '/wh/strategy'],
  ['盘点差异', '/wh/stocktake-diff'], ['全盘', '/wh/stocktake-full'], ['损益', '/wh/pnl'], ['组合', '/wh/combo'],
  ['配送', '/wh/delivery'], ['线路', '/wh/route-setup'], ['拣货波次', '/wh/pick-wave'], ['库位', '/wh/location'],
  ['效期', '/wh/expiry-report'], ['车存', '/wh/vehicle-stock'], ['库存预警', '/wh/stock-alert'],
  ['收款单', '/funds/receipt'], ['资金余额', '/funds/balance'], ['资金流水', '/funds/flow'],
  ['银行对账', '/funds/reconcile'], ['往来对账', '/funds/party-reconcile'], ['成本查询', '/funds/cost-query'],
  ['员工欠款', '/funds/staff-debt'], ['客户对账', '/funds/customer-statement'],
  ['设置', '/settings'], ['价格渠道', '/prices'], ['定时任务', '/cron'], ['告警规则', '/alerts'], ['招标雷达', '/bid-radar'],
]

/* 页面内探针：采集所有滚动区 + 嵌套关系 + 表头吸附状态 */
const PROBE = function () {
  const cls = (el) => {
    const c = (el.className || '').toString().trim().split(/\s+/).filter(Boolean)
    return el.tagName.toLowerCase() + (c.length ? '.' + c.slice(0, 3).join('.') : '')
  }
  const vis = (el) => el.getClientRects().length > 0
  const info = (el) => {
    const s = getComputedStyle(el)
    const oy = /(auto|scroll)/.test(s.overflowY)
    const ox = /(auto|scroll)/.test(s.overflowX)
    const hid = /hidden/.test(s.overflowY)
    return {
      okY: oy && el.scrollHeight > el.clientHeight + 4,
      okX: ox && el.scrollWidth > el.clientWidth + 4,
      clipY: hid && el.scrollHeight > el.clientHeight + 4,
      ch: el.clientHeight, sh: el.scrollHeight,
      cw: el.clientWidth, sw: el.scrollWidth,
    }
  }
  /* 候选：整个内容区里的所有元素 + .view-wrap 自己 */
  const vw = document.querySelector('.view-wrap')
  const cands = []
  if (vw) cands.push(vw)
  if (vw) cands.push(...vw.querySelectorAll('*'))
  const regions = []
  for (const el of cands) {
    if (!vis(el)) continue
    const i = info(el)
    if (!i.okY && !i.okX) {
      if (i.clipY) regions.push({ d: cls(el), clip: true, ch: i.ch, sh: i.sh })
      continue
    }
    /* 找最近的可滚祖先（同口径），用来判"嵌套" */
    let up = el.parentElement, parent = ''
    while (up) {
      const j = info(up)
      if ((j.okY || j.okX) && vis(up)) { parent = cls(up); break }
      up = up.parentElement
    }
    regions.push({
      d: cls(el), parent,
      y: i.okY ? i.ch + '/' + i.sh : '', x: i.okX ? i.cw + '/' + i.sw : '',
    })
  }
  /* 表头吸附：**每张表各测一遍**（v722 踩过：只测第一张表会把多表页判错 ——
     告警规则第一张表是普通列表、第二张才是要冻结的历史表）。内滚 400px 复测位置。 */
  const ths = []
  for (const tb of document.querySelectorAll('.view-wrap table')) {
    const th = tb.querySelector('thead th')
    if (!th || !th.getClientRects().length) continue
    let pane = null, q = th.parentElement
    while (q) {
      const s = getComputedStyle(q)
      if (/(auto|scroll|hidden)/.test(s.overflow) && q.scrollHeight > q.clientHeight + 4) { pane = q; break }
      q = q.parentElement
    }
    const label = ((tb.className || '').toString().trim().split(/\s+/)[0] || 'table') + ':' + (tb.querySelector('thead th').textContent || '').trim().slice(0, 4)
    if (!pane) { ths.push(label + '=no-scroll'); continue }
    const g = () => Math.round(th.getBoundingClientRect().top - pane.getBoundingClientRect().top)
    const g0 = g(); pane.scrollTop = 400; const g1 = g(); pane.scrollTop = 0
    ths.push(label + (Math.abs(g1 - g0) <= 2 && g1 >= -2 ? '=pinned' : '=moved(' + (g1 - g0) + ')'))
  }
  return { regions, th: ths.join(' | ') || 'no-th', vh: innerHeight }
}

/* 单据页注入 45 行，逼出「内容超一屏」的真实形态 */
const GROW = function () {
  const t = document.querySelector('.table-wrap table')
  if (!t || !t.tBodies[0]) return { err: 'no tbody' }
  const body = t.tBodies[0]
  const proto = body.rows[body.rows.length - 1]
  if (!proto) return { err: 'no row' }
  for (let i = 0; i < 45; i++) {
    const c = proto.cloneNode(true)
    c.querySelectorAll('input').forEach((el) => { el.value = '' })
    body.appendChild(c)
  }
  return { rows: body.rows.length }
}

async function run() {
  const TOKEN = process.env.HG_TOKEN
  if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(1) }
  const grow = process.argv.includes('--grow')
  const { launch } = await import('./lib/cdp-lite.mjs')
  const b = await launch({ headless: true })
  const page = await b.newPage(); await page.enable()
  await page.raw.send('Network.enable')
  await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await page.goto('https://hergent.cn/login', 2200)
  for (const c of [
    { name: 'erp_token', value: TOKEN, httpOnly: true },
    { name: 'hergent_auth', value: '1' },
    { name: 'csrf_token', value: 'x' },
    { name: 'hergent_tenant', value: '1' },
  ]) await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })

  const all = []
  let bad = 0
  const LIST = process.argv.includes('--all') ? PAGES_ALL.map(p => [p[0], p[1], false]) : PAGES
  for (const [name, path, canGrow] of LIST) {
    await page.goto('https://hergent.cn/#' + path, 3200)
    let g = null
    if (grow && canGrow) {
      try { g = await page.eval(`(${GROW.toString()})()`); await new Promise((r) => setTimeout(r, 500)) } catch (e) { g = { err: String(e) } }
    }
    let r
    try { r = await page.eval(`(${PROBE.toString()})()`) } catch (e) { r = { err: String(e) } }
    const regs = r.regions || []
    const nested = regs.filter((x) => x.parent)
    const clips = regs.filter((x) => x.clip)
    if (nested.length) bad++
    console.log(`· ${name.padEnd(6)} ${String(path).padEnd(40)} 滚动区=${regs.length - clips.length} 嵌套=${nested.length} 表头=${r.th}${g ? ' 加行=' + JSON.stringify(g) : ''}`)
    for (const x of regs) {
      const tag = x.clip ? '⛔被截断' : x.parent ? '🔴嵌套' : '  '
      console.log(`    ${tag} ${x.d.padEnd(34)} ${x.y ? '竖向 ' + x.y : ''} ${x.x ? '横向 ' + x.x : ''}${x.parent ? ' ← 父滚动区 ' + x.parent : ''}`)
    }
    all.push({ name, path, grow: g, ...r })
  }
  writeFileSync('/tmp/v721-scroll-region.json', JSON.stringify(all, null, 1))
  console.log(`\n结论：${bad} / ${LIST.length} 个页面存在嵌套滚动区 ${bad ? '🔴 需修' : '✅ 全部单滚动区'}`)
  console.log('原始结果 → /tmp/v721-scroll-region.json')
  await b.close()
}

run()
