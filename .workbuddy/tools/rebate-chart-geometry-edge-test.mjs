/**
 * v162 柱状图边界用例（同样走真实组件 SSR 渲染）—— 上下两张单轴图结构
 *  ① 柱子顶到量程上限时，柱顶竖排标签锚点必须下压（否则被画布裁掉）
 *  ② 「按数量」口径：销量图按件换算；**返利图恒为元**（不跟着口径开关走）
 *  ③ 无目标但有达成：整根中性灰填充、不画灰轨道；两图各按自己的量程
 *  ④ 全零数据：两张图都不画 SVG（避免 0/0 的假刻度），各给一句空态
 *  ⑤ 只有一个系列有数据：另一张图单独进空态，互不牵连（拆图后的新边界）
 * 运行：cd laozhangai-product/hergent-cn-v2 \
 *         && node ../.workbuddy/tools/rebate-chart-geometry-edge-test.mjs
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

// 本脚本不在项目内，ESM 会按"脚本所在目录"解析依赖 → 找不到 vite/vue。
// 故一律以 **cwd（= hergent-cn-v2）** 为基准显式解析，保证脚本可放在仓库任意位置。
const req = createRequire(join(process.cwd(), 'package.json'))
const imp = p => import(pathToFileURL(req.resolve(p)).href)
const { createServer } = await imp('vite')
const { createSSRApp } = await imp('vue')
const { renderToString } = await imp('vue/server-renderer')

// ── v162 几何常量（必须与组件逐字一致）──
const SH = 200
const PAD = { l: 52, r: 18, t: 34, b: 30 }
const PLOT_H = SH - PAD.t - PAD.b                     // 136
const PLOT_BASE = PAD.t + PLOT_H                      // 170
const PLOT_W = 600 - PAD.l - PAD.r                    // 530（SSR 不跑 onMounted，量宽锁 MIN_W）
const GW = PLOT_W / 12
const GAP = Math.max(4, Math.min(12, GW * 0.16))
const BW = Math.max(12, Math.min(44, GW - GAP * 2))
const xBar = i => PAD.l + i * GW + (GW - BW) / 2

let pass = 0, fail = 0
function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label + (extra ? '\n        ' + extra : '')) }
}
const near = (a, b, tol = 0.02) => a != null && b != null && Math.abs(a - b) <= tol

const server = await createServer({
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
})
const mod = await server.ssrLoadModule('/src/components/rebate/MonthlyAchvChart.vue')

const M = (m, st, sa, rt, ar) => ({
  m, key: `2025-${String(m).padStart(2, '0')}`,
  salesTarget: st, salesAchv: sa, actualRebate: ar, rebateTarget: rt,
  byBrand: {}, rules: [], ruleVals: {}, refDate: `2025-${String(m).padStart(2, '0')}-28`,
})
const mk = (months, measure = 'amount', hasAny = true) => ({
  year: 2025, measure, hasAny, excluded: { nonBrand: 0, crossUnit: 0 }, months,
})
const ATTR = a => k => { const r = new RegExp(`${k}="([^"]*)"`).exec(a); return r ? r[1] : null }
const segsOf = seg => [...seg.matchAll(/<rect\b([^>]*)>/g)].map(m => {
  const g = ATTR(m[1])
  return { cls: g('class') || '', fill: g('fill') || '', x: +(g('x') || 0), y: +(g('y') || 0), h: +(g('height') || 0), w: +(g('width') || 0) }
}).filter(r => r.h > 0 && r.w > 0 && r.fill !== 'transparent')

async function render(model) {
  const html = await renderToString(createSSRApp(mod.default, { model, loading: false, year: 2025, yearOptions: [2025] }))
  const svgs = html.split(/<svg\b/).slice(1)          // [0]=销量图 [1]=返利图（无数据时缺位）
  const bars = svgs.map(s => segsOf(s).filter(r => Math.abs(r.w - BW) < 0.5))
  // 柱顶标签（v162 起改用 v-if，未显示的不会进 DOM，无需再按 display:none 过滤）
  const labels = [...html.matchAll(/<text\b([^>]*class="bar-lb"[^>]*)>([^<]*)<\/text>/g)]
    .map(m => ({ y: +ATTR(m[1])('y'), t: m[2] }))
  // v162：单位只在小标题出现一次
  const units = [...html.matchAll(/class="sec-u"[^>]*>([^<]*)</g)].map(m => m[1])
  /** 在某张图里取第 i 月的分段 */
  const col = (sec, i) => (bars[sec] || []).filter(r => near(r.x, xBar(i)))
  return { html, svgs, bars, labels, units, col }
}

console.log('\n【①】柱子顶到量程上限 → 标签锚点必须下压（单图高 200，绘图区顶 y=34）')
{
  // 销量：无目标但有达成 100万 → 量程 niceMax(1e6)=1e6 → 柱高吃满 136px，柱顶 y=34
  const { col, labels } = await render(mk([M(1, 0, 1000000, 0, 0), ...Array.from({ length: 11 }, (_, i) => M(i + 2, 0, 0, 0, 0))]))
  const seg = col(0, 0).filter(r => !r.cls.includes('track'))
  ok(seg.length === 1 && near(seg[0].h, PLOT_H), `柱高吃满绘图区 ${PLOT_H}px（实测 ${seg[0]?.h}）`)
  ok(near(seg[0].y, PAD.t), `柱顶落在量程上限 y=${PAD.t}`)
  ok(labels.length === 1, `只有 1 枚柱顶标签（其余月份 achv=0 不渲染），实测 ${labels.length}`)
  ok(labels[0]?.y === 58, `标签锚点下压到 y=58（不下压会是 y=30，标签将顶出画布），实测 ${labels[0]?.y}`)
  const est = 58 - (labels[0]?.t.length || 0) * 5.2
  ok(est >= 0, `按下压后的锚点估算标签仍在画布内（"${labels[0]?.t}" × 5.2px ≈ ${((labels[0]?.t.length || 0) * 5.2).toFixed(0)}px，上缘 ${est.toFixed(0)}）`)
  // 最坏情况：10 字符长标签「1235万·129%」（9 个数字/符号 + 1 个汉字）也必须留在画布内
  const worst = 9 * 4.7 + 8.5
  ok(58 - worst >= 0, `最坏情况「1235万·129%」（约 ${worst.toFixed(0)}px）上缘 = ${(58 - worst).toFixed(0)} ≥ 0，不被裁`)
  // 真机另有 getBBox() 实测兜底（见 rebate-chart-allmonths-verify.js【I】）
}

console.log('\n【②】「按数量」口径：销量图按件；返利图恒为元（不跟口径开关走）')
{
  const { html, col, svgs, units } = await render(mk([
    M(1, 40000, 48000, 30000, 5000),        // 销量 4.8万件 / 返利 30000 元预估、5000 元实际
    ...Array.from({ length: 11 }, (_, i) => M(i + 2, 0, 0, 0, 0)),
  ], 'quantity'))
  const axA = [...svgs[0].matchAll(/class="ax-lb"[^>]*>([^<]*)</g)].map(m => m[1].trim())
  console.log('   上图刻度:', JSON.stringify(axA), '| 两图单位:', JSON.stringify(units))
  ok(units[0] === '万件', '销量图单位 = 万件（量程 48000 件 ≥ 1 万件）')
  ok(JSON.stringify(axA) === JSON.stringify(['0', '1', '2', '3', '4', '5']), '销量图刻度 0/1/2/3/4/5（万件）')
  ok(units[1] === '元', '返利图单位 = 元 —— 切「按数量」不影响返利（v160 铁律：返利恒为金额）')
  ok(col(0, 0).find(r => r.cls.includes('track')).h === 40000 / 50000 * PLOT_H,
    `销量轨道 = 40000/50000×${PLOT_H} = ${(40000 / 50000 * PLOT_H).toFixed(2)}px`)
  const total = col(0, 0).filter(r => !r.cls.includes('track')).reduce((s, r) => s + r.h, 0)
  ok(near(total, 48000 / 50000 * PLOT_H),
    `数量口径柱高按件等比：成交高 ${total.toFixed(2)}px = 48000/50000×${PLOT_H} = ${(48000 / 50000 * PLOT_H).toFixed(2)}px`)
  ok(near(col(1, 0).find(r => r.fill === '#f59e0b').h, 5000 / 30000 * PLOT_H),
    `返利图仍按元：实际返利柱 ${(5000 / 30000 * PLOT_H).toFixed(2)}px = 5000/30000×${PLOT_H}`)
}

console.log('\n【③】无目标但有达成 → 整根中性灰填充、不画灰轨道；两图各按自己的量程')
{
  const { col } = await render(mk([M(1, 0, 250000, 0, 60000), ...Array.from({ length: 11 }, (_, i) => M(i + 2, 0, 0, 0, 0))]))
  ok(col(0, 0).filter(r => r.cls.includes('track')).length === 0, '销量图没有灰轨道（无目标就没有目标高度）')
  ok(col(0, 0).some(r => r.fill === '#94a3b8'), '销量图用中性灰（无从判超前/落后，不染红绿）')
  // 量程 = niceMax(250000) = 300000（向上取整到好看刻度），不是 250000
  ok(near(col(0, 0).find(r => r.fill === '#94a3b8').h, 250000 / 300000 * PLOT_H),
    `销量灰柱高 = 250000/300000×${PLOT_H} = ${(250000 / 300000 * PLOT_H).toFixed(2)}px（量程被 niceMax 抬到 30万）`)
  ok(col(1, 0).filter(r => r.cls.includes('track')).length === 0 &&
     near(col(1, 0).find(r => r.fill === '#94a3b8').h, 60000 / 75000 * PLOT_H),
    `返利灰柱高 = 60000/75000×${PLOT_H} = ${(60000 / 75000 * PLOT_H).toFixed(2)}px —— 各图独立量程，互不迁就`)
}

console.log('\n【④】全零数据：两张图都不画 SVG（避免 0/0 的假刻度），各给一句空态')
{
  const { html, svgs, bars } = await render(mk(Array.from({ length: 12 }, (_, i) => M(i + 1, 0, 0, 0, 0)), 'amount', true))
  const grids = [...html.matchAll(/<line\b[^>]*class="grid"[^>]*>/g)].length
  const axLabels = [...html.matchAll(/class="ax-lb[^"]*"[^>]*>([^<]*)</g)].map(m => m[1].trim())
  ok(svgs.length === 0, `一张 SVG 都不渲染（量程为 0 时不出假刻度），实测 ${svgs.length}`)
  ok(grids === 0, `网格线 0 条，实测 ${grids}`)
  ok(axLabels.length === 0, `轴刻度 0 个，实测 ${JSON.stringify(axLabels)}`)
  ok(bars.every(b => b.length === 0), '不画任何柱子')
  ok(html.includes('本年无销量达成数据') && html.includes('本年无实际返利数据'),
    '两张图各给一句空态（分别说清缺的是哪一样）')
}

console.log('\n【⑤】只有一个系列有数据：另一张图独立进空态，互不牵连')
{
  // 只有销量、没有返利
  const a = await render(mk([M(1, 500000, 400000, 0, 0), ...Array.from({ length: 11 }, (_, i) => M(i + 2, 0, 0, 0, 0))]))
  ok(a.svgs.length === 1 && a.bars[0].length > 0, '只有销量时：渲染 1 张图，且柱子正常')
  ok(a.html.includes('本年无实际返利数据'), '销量图下方仍保留返利图的空态占位（两张图高度不塌陷）')
  ok(!a.html.includes('本年无销量达成数据'), '销量图自己有数据，不会误报空态')

  // 只有返利、没有销量
  const b = await render(mk([M(1, 0, 0, 30000, 9000), ...Array.from({ length: 11 }, (_, i) => M(i + 2, 0, 0, 0, 0))]))
  ok(b.svgs.length === 1 && b.bars[0].length > 0, '只有返利时：渲染 1 张图，且柱子正常')
  ok(b.html.includes('本年无销量达成数据'), '返利图上方的销量图给出空态占位')
  ok(b.html.includes('>实际返利<'), '返回的这张图标题是「实际返利」')
}

await server.close()
console.log(`\n${'='.repeat(56)}\n边界用例：${pass} PASS / ${fail} FAIL\n${'='.repeat(56)}`)
process.exit(fail ? 1 : 0)
