/**
 * v723-dark-audit.mjs —— 深色模式体检（只读）
 *
 * 背景：全站深色**只靠 variables.css 里一套 `:root.dark` 令牌覆盖**（6 处），
 *      没有任何组件级补偿。理论上令牌够就能工作，但实际常见的坑是：
 *      ① 某处写死了浅色底/深色字 ⇒ 深色下变"白块"或"看不见"
 *      ② 半透明叠色（rgba 白/黑）在深色底上合成结果与浅色不同 ⇒ 对比度掉下来
 *      ③ 图表调色板是浅色系 ⇒ 深色底上糊成一片
 * 本探针只回答一件事：**切到深色后，有多少像素级的文字对比度低于 4.5 / 3.0**。
 *
 * 用法：HG_TOKEN=<token> node .workbuddy/tools/v723-dark-audit.mjs
 */
import { launch, CHROME_DEFAULT } from './lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN || ''
if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(1) }

const PAGES = [
  ['工作台', '/workbench'],
  ['采购单列表', '/inventory/purchase'],
  ['商品档案', '/archive/products'],
  ['毛利分析', '/reports/gross-profit'],
  ['目标与返利', '/rebate'],
  ['设置', '/settings'],
]

function PROBE() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); const [h, l] = l1 > l2 ? [l1, l2] : [l2, l1]; return (h + 0.05) / (l + 0.05) }

  const root = getComputedStyle(document.documentElement)
  const bodyBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }

  const bad = []
  let checked = 0
  const walk = (el, depth) => {
    if (depth > 22) return
    for (const ch of el.children) {
      if (ch.tagName === 'SCRIPT' || ch.tagName === 'STYLE' || ch.tagName === 'SVG') continue
      const cs = getComputedStyle(ch)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const r = ch.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      /* 有直接文字节点才算 */
      const hasText = [...ch.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0)
      if (hasText) {
        /* 背景沿祖先往上找第一个非透明 —— 必须做 alpha 合成，不能取到 transparent 就放弃 */
        /* 🔴🔴 合成背景必须**从最外层往内层叠**。
           踩过的坑（v723）：写成「从元素往外走、边走边 over(acc, 父背景)」时，
           一旦父级也是半透明（`rgba(255,69,58,.05)`），`over` 会用它的 rgb 当不透明色
           ⇒ 5% 红被当成 100% 红 ⇒ tag.risk 明明 6.5:1 却报成 1:1。
           正确顺序：先收集到第一个不透明为止，再**倒序**（外→内）逐层叠上去。 */
        const layers = []
        let q = ch
        while (q && q !== document.documentElement) {
          const bc = parse(getComputedStyle(q).backgroundColor)
          if (bc && bc.a > 0) layers.push(bc)
          if (bc && bc.a >= 1) break
          q = q.parentElement
        }
        let bg = bodyBg && bodyBg.a >= 1 ? bodyBg : { r: 255, g: 255, b: 255, a: 1 }
        for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg)
        const fg0 = parse(cs.color)
        if (fg0) {
          const fg = over(fg0, bg)
          const ratio = cr(fg, bg)
          const size = parseFloat(cs.fontSize)
          const bold = parseInt(cs.fontWeight, 10) >= 700
          const need = (size >= 18.66 || (size >= 14 && bold)) ? 3.0 : 4.5
          checked++
          if (ratio < need - 0.01) {
            bad.push({
              t: ch.tagName.toLowerCase() + '.' + (ch.getAttribute('class') || '').slice(0, 18),
              ratio: Math.round(ratio * 100) / 100,
              need,
              fs: size,
              txt: (ch.textContent || '').trim().slice(0, 14),
            })
          }
        }
      }
      walk(ch, depth + 1)
    }
  }
  walk(document.body, 0)

  /* 写死浅色的嫌疑：元素背景是纯白/近白（深色下不该出现） */
  const whiteBlocks = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 40 || r.height < 20) continue
    /* 🔴 只算落在视口内的：SPA 的 #app 是 100vh 全屏，index.html 那个静态备案 footer
       在视口外（v717 注释已记过）。把它报成「深色下每页贴白纸」是假阳性。 */
    if (r.bottom < 0 || r.top >= innerHeight) continue   /* 边界：top == innerHeight 也是视口外 */
    const bc = parse(getComputedStyle(el).backgroundColor)
    if (bc && bc.a > 0.9 && bc.r > 240 && bc.g > 240 && bc.b > 240) {
      whiteBlocks.push({ cls: (el.getAttribute('class') || el.tagName).slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) })
      if (whiteBlocks.length > 6) break
    }
  }

  return {
    theme: document.documentElement.className,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    t1: root.getPropertyValue('--t1').trim(),
    bg: root.getPropertyValue('--bg').trim(),
    checked,
    badN: bad.length,
    bad: bad.slice(0, 8),
    whiteBlocks,
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* 全站清单（--all）：继承 v720 冻结审计的 59 页，保证两次审计页集合一致 */
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

const browser = await launch({ headless: true, executablePath: CHROME_DEFAULT })
const page = await browser.newPage()
await page.enable()
for (const c of [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' },
  { name: 'csrf_token', value: 'x' },
  { name: 'hergent_tenant', value: '1' },
]) await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })

/* 强制深色：主题落在 documentElement 的 .dark class 上（不是 data-theme） */
await page.goto('https://hergent.cn/#/workbench', 3200)
await page.eval(`localStorage.setItem('hergent_theme','dark');
  document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark'); 'ok'`)

const all = []
const LIST = process.argv.includes('--all') ? PAGES_ALL.map(p => [p[0], p[1]]) : PAGES
for (const [name, path] of LIST) {
  await page.goto('https://hergent.cn/#' + path, 3200)
  await page.eval(`document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light')`)
  await sleep(320)
  let r
  try { r = await page.eval(`(${PROBE.toString()})()`) } catch (e) { r = { err: String(e) } }
  console.log(`\n· ${name}  theme=${r.theme}  body=${r.bodyBg}  --t1=${r.t1}  --bg=${r.bg}`)
  console.log(`  测 ${r.checked} 个文字节点，低于阈值 ${r.badN} 个`)
  for (const b of (r.bad || [])) console.log(`    🔴 ${b.ratio}:1 (需 ${b.need}) ${b.fs}px ${b.t} 「${b.txt}」`)
  if (r.whiteBlocks?.length) console.log(`    ⚠️ 深色下仍近白底 ${r.whiteBlocks.length} 处 ${JSON.stringify(r.whiteBlocks.slice(0, 3))}`)
  all.push({ name, ...r })
}

console.log('\n══════ 汇总 ══════')
for (const p of all) console.log(`  ${p.name.padEnd(8)} 节点=${String(p.checked).padEnd(5)} 不达标=${p.badN}`)
console.log(`合计不达标 ${all.reduce((s, p) => s + (p.badN || 0), 0)} / ${all.reduce((s, p) => s + (p.checked || 0), 0)}`)
await browser.close()
