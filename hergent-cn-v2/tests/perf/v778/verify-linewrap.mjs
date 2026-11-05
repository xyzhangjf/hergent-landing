/* v778 真实渲染验证：小程序「我的预报提交」明细行，数量+单位不得被拆到两行。
 *
 * 用真实源码（mine.wxss 的三条规则 + mine.wxml 的明细行绑定）拼出等价 HTML，
 * 1rpx = 0.5px（375px 屏），在系统 Chrome 里量：
 *   · 数值段与单位段 Range 的 top 是否一致（不一致 = 拆行）
 *   · 名称行数 / 是否横向溢出（必须允许换行、不许截断）
 *   · 数量是否仍靠右、整块是否在单行
 * 对照组把源码改回 v777 状态（空格 + 无 flex:none/nowrap），必须能复现拆行。
 *
 * 跑法：cd hergent-cn-v2 && node tests/perf/v778/verify-linewrap.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const MINI = path.join(ROOT, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const wxss = fs.readFileSync(path.join(MINI, 'pages/mine/mine.wxss'), 'utf8')
const wxml = fs.readFileSync(path.join(MINI, 'pages/mine/mine.wxml'), 'utf8')

/* 只取本次涉及的三条规则，剥掉注释；rpx → px（375px 屏） */
const clean = wxss.replace(/\/\*[\s\S]*?\*\//g, '')
const pick = (sel) => {
  const m = clean.match(new RegExp('\\' + sel + '\\s*\\{[^}]*\\}'))
  if (!m) throw new Error('源码里找不到规则 ' + sel)
  return m[0].replace(/(\d+(?:\.\d+)?)rpx/g, (_, n) => (Number(n) / 2) + 'px')
}
const CSS_NEW = [pick('.rec-item'), pick('.it-name'), pick('.it-qty')].join('\n')
/* 对照组：v777 状态 —— 名称无规则、数量无 flex:none/nowrap、绑定带空格 */
const CSS_OLD = pick('.rec-item') + '\n' + '.it-qty{color:var(--brand);font-weight:500}'

/* 明细行模板从真实 wxml 抽，避免手抄副本造成「验证的不是源码」 */
const rowTpl = (() => {
  const m = wxml.match(/<view class="rec-item"[\s\S]*?<\/view>/)
  if (!m) throw new Error('源码里找不到 .rec-item 明细行')
  return m[0]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<view class="rec-item"[^>]*>/, '<div class="rec-item">')
    .replace(/<\/view>/, '</div>')
    .replace(/<text /g, '<span ').replace(/<\/text>/g, '</span>')
    .replace(/\{\{it\.product_name\}\}/g, '{{NAME}}')
    .replace(/\{\{it\.quantity\}\}\{\{it\.unit\}\}/g, '{{QTY}}')
})()

const BASE_CSS = `
:root{--brand:#007aff}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;background:#fff}
#wrap{width:var(--w);border:1px solid #eee}
`

const CASES = [
  // 生产真实样本（马耀秀最新一期）
  ['用户示例 27 字 / 2 位数量', '现代牧场0乳糖软牛奶185ml+2到货（分开单独下单）', 24, '瓶'],
  ['生产最长 43 字 / 2 位数量', '小鲜语绿莎莎生牛乳绿豆奶185ml（4.8.12.16.20.24.28）分开单独下单', 12, '瓶'],
  ['同一长名 / 96 瓶', '现代牧场0乳糖软牛奶185ml+2到货（分开单独下单）', 96, '瓶'],
  ['短名 / 4 位数量', '每日鲜酪', 1000, '组'],
  ['中等名 / 1 位数量', '蒙牛冠益乳黄桃味250g*24罐', 6, '罐'],
  ['29 字 / 5 位数量 / 不同单位', '冠益乳大果粒水蜜桃草莓桑葚风味发酵乳利乐冠250g*24瓶', 12345, '件'],
  ['极长中文名 60 字 / 3 位数量', '蒙牛低温鲜牛奶现代牧场系列每日鲜语全脂纯牛奶高钙低脂无蔗糖风味发酵乳组合装礼盒整箱批发专用', 128, '箱'],
  ['含长英文数字串', 'MENGNIU MODERN MEADOW 0 LACTOSE SOFT MILK 185ML X 2 到货分开单独下单', 48, '瓶'],
]
const WIDTHS = [319, 264, 375]  // 375px 常规卡片内宽 / 320px 小屏 / 宽屏

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 500, height: 400 } })
let failed = 0
const ok = (cond, label, extra = '') => {
  if (!cond) failed++
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
}

async function measure(css, width, name, qty, unit, oldMode) {
  const qtyText = oldMode ? `${qty} ${unit}` : `${qty}${unit}`
  const row = rowTpl.replace('{{NAME}}', name).replace('{{QTY}}', qtyText)
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head>
    <body><div id="wrap" style="--w:${width}px">${row}</div></body></html>`
  await page.setContent(html, { waitUntil: 'load' })
  return page.evaluate((numLen) => {
    const item = document.querySelector('.rec-item')
    const n = document.querySelector('.it-name')
    const q = document.querySelector('.it-qty')
    const node = q.firstChild
    const r1 = document.createRange(); r1.setStart(node, 0); r1.setEnd(node, numLen)
    const r2 = document.createRange(); r2.setStart(node, numLen); r2.setEnd(node, node.textContent.length)
    const a = r1.getBoundingClientRect(), b = r2.getBoundingClientRect()
    /* 🔴 不能用「元素高度 ÷ 行高」判断文本行数：flex 默认 align-items:stretch 会把
       .it-qty 元素盒拉到与换行的名称同高，而文本其实只有一行。用 Range 的行盒数。 */
    const fullQ = document.createRange(); fullQ.selectNodeContents(q)
    const qtyTextRects = fullQ.getClientRects().length
    const nFirst = document.createRange()
    nFirst.setStart(n.firstChild, 0); nFirst.setEnd(n.firstChild, 1)
    const cs = getComputedStyle(n)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
    return {
      qtyText: node.textContent,
      split: Math.abs(a.top - b.top) > 1,
      yDelta: Math.abs(a.top - b.top),
      qtyTextRects,
      qtyTopGap: Math.abs(a.top - nFirst.getBoundingClientRect().top),
      nameLines: Math.round(n.getBoundingClientRect().height / lh),
      nameOverflow: n.scrollWidth > n.clientWidth + 1,
      nameText: n.textContent,
      qtyRightGap: Math.round(item.getBoundingClientRect().right - q.getBoundingClientRect().right),
    }
  }, String(qty).length)
}

console.log('A. 对照组（v777 旧实现）必须能复现拆行，证明测量有效')
{
  let reproduced = 0
  for (const [label, name, qty, unit] of CASES.slice(0, 3)) {
    const r = await measure(CSS_OLD, 264, name, qty, unit, true)
    console.log(`  ${r.split ? '🔴 复现' : '⚪ 未复现'} ${label}: "${r.qtyText}" 数值/单位 Δy=${r.yDelta.toFixed(1)}px 名称 ${r.nameLines} 行`)
    if (r.split) reproduced++
  }
  ok(reproduced >= 1, '旧实现至少 1 例出现「数值与单位分属两行」', `实测 ${reproduced}/3`)
}

console.log('\nA2. 只去掉 wxml 空格、不锁 CSS 的对照（说明为何要两层保险）')
{
  // 中文排版里「数字｜汉字」边界本身仍可断行，光去空格不够稳
  const CSS_WXML_ONLY = pick('.rec-item') + '\n' + '.it-qty{color:var(--brand);font-weight:500}'
  const r = await measure(CSS_WXML_ONLY, 264, CASES[0][1], CASES[0][2], CASES[0][3], false)
  console.log(`  ${r.split ? '🔴 仍拆行' : '⚪ 未拆行'} "${r.qtyText}" Δy=${r.yDelta.toFixed(1)}px ⇒ CSS 的 flex:none + nowrap 是必要保险`)
}

console.log('\nB. 新实现：全部样本 × 3 种宽度')
for (const width of WIDTHS) {
  console.log(`  ── 容器 ${width}px ──`)
  for (const [label, name, qty, unit] of CASES) {
    const r = await measure(CSS_NEW, width, name, qty, unit, false)
    const pass = !r.split && r.qtyTextRects === 1 && r.qtyTopGap <= 1 && !r.nameOverflow &&
      r.nameText === name && r.qtyText === `${qty}${unit}` && r.qtyRightGap <= 1
    ok(pass, `${label} → "${r.qtyText}"`,
      `数值/单位 Δy=${r.yDelta.toFixed(1)}px, 数量文本 ${r.qtyTextRects} 个行盒, 名称 ${r.nameLines} 行, 首行对齐 Δ=${r.qtyTopGap.toFixed(1)}px, 溢出=${r.nameOverflow}`)
  }
}

console.log('\nC. 名称必须真的允许换行（长名在窄容器里行数 > 1）')
for (const [label, name, qty, unit] of [CASES[0], CASES[1], CASES[6]]) {
  const r = await measure(CSS_NEW, 264, name, qty, unit, false)
  ok(r.nameLines >= 2 && !r.nameOverflow && !r.split,
    `${label} 换行生效且数量仍完整`, `名称 ${r.nameLines} 行 / "${r.qtyText}" Δy=${r.yDelta.toFixed(1)}px`)
}

await browser.close()
console.log('\n' + (failed === 0 ? 'RESULT: ALL PASS' : `RESULT: FAILED (${failed})`))
process.exit(failed === 0 ? 0 : 1)
