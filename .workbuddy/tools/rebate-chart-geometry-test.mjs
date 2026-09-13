/**
 * v162 柱状图「上下两张单轴图」渲染级验证
 * 用真实组件做 SSR 渲染，解析出的 SVG rect 几何 = 浏览器里最终渲染的几何
 * （几何全部在 render 期由 computed 算出，与 DOM 环境无关）。
 *
 * 坐标约定：at(sec, 月份下标, 判据) —— sec = 0 上图（销量）、1 下图（实际返利）
 * 运行：cd laozhangai-product/hergent-cn-v2 \
 *         && node ../.workbuddy/tools/rebate-chart-geometry-test.mjs
 * 说明：脚本需解析到项目的 node_modules，故**cwd 必须是 hergent-cn-v2**。
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

// ── v162 几何常量（必须与组件逐字一致）──────────────────────────────────────
const SH = 200
const PAD = { l: 52, r: 18, t: 34, b: 30 }
const PLOT_H = SH - PAD.t - PAD.b          // 136
const PLOT_BASE = PAD.t + PLOT_H           // 170
const MIN_W = 600                          // SSR 不跑 onMounted，量宽锁 MIN_W
const PLOT_W = MIN_W - PAD.l - PAD.r       // 530
const GW = PLOT_W / 12
const GAP = Math.max(4, Math.min(12, GW * 0.16))
const BW = Math.max(12, Math.min(44, GW - GAP * 2))
const SEC_HD = 22, SEC_GAP = 16

const CI = { sales: '#06b6d4', salesDeep: '#0e7490', rebate: '#f59e0b', rebateDeep: '#b45309' }

// ── 构造数据：销量与返利各自量级不同，且含「未达标 / 达标 / 超额」三种情形 ──
const M = (m, st, sa, rt, ar) => ({
  m, key: `2025-${String(m).padStart(2, '0')}`,
  salesTarget: st, salesAchv: sa, actualRebate: ar, rebateTarget: rt,
  byBrand: {}, rules: [], ruleVals: {}, refDate: `2025-${String(m).padStart(2, '0')}-28`,
})
const model = {
  year: 2025, measure: 'amount', hasAny: true,
  excluded: { nonBrand: 0, crossUnit: 0 },
  months: [
    M(1, 1000000, 500000, 30000, 9000),      // 销量 50% / 返利 30%
    M(2, 2000000, 1600000, 60000, 48000),    // 销量 80% / 返利 80%
    M(3, 400000, 480000, 12000, 15000),      // 销量 120% 超额 / 返利 125% 超额
    ...Array.from({ length: 9 }, (_, i) => M(i + 4, 0, 0, 0, 0)),
  ],
}
// 期望量程：销量 max(2e6,1.6e6,1e6,5e5,4e5,4.8e5)=2e6 → niceMax=2e6
//           返利 max(6e4,4.8e4,3e4,1.5e4,1.2e4,9e3)=6e4 → niceMax=7.5e4
const SALES_MAX = 2000000
const REBATE_MAX = 75000

const xBar = i => PAD.l + i * GW + (GW - BW) / 2
const px = (v, max) => (v / max) * PLOT_H       // 期望高度
const py = (v, max) => PLOT_BASE - px(v, max)   // 期望 y

let pass = 0, fail = 0
function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  ' + extra : '')) }
}
const near = (a, b, tol = 0.02) => a != null && Math.abs(a - b) <= tol

const server = await createServer({
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },   // 不扫描 index.html 依赖，加快启动
})
const mod = await server.ssrLoadModule('/src/components/rebate/MonthlyAchvChart.vue')
const app = createSSRApp(mod.default, { model, loading: false, year: 2025, yearOptions: [2025], singleBrand: false })
const html = await renderToString(app)
await server.close()

// ── 按 <svg> 切分两张图（组件对 sections 做 v-for → 顺序＝销量、返利）──
const svgs = html.split(/<svg\b/).slice(1)
const SECNAME = ['销量图', '返利图']

/** 从一段 HTML 里解析所有柱体 rect（跳过无色热区） */
function parseRects(seg) {
  const out = []
  const reRect = /<rect\b([^>]*)>/g
  let m
  while ((m = reRect.exec(seg))) {
    const a = m[1]
    const g = k => { const r = new RegExp(`${k}="([^"]*)"`).exec(a); return r ? r[1] : null }
    const w = g('width'), h = g('height'), x = g('x'), y = g('y')
    if (!w || !h || x == null || y == null) continue   // 跳过透明热区（无 height）
    out.push({ cls: g('class') || '', fill: g('fill') || '', x: +x, y: +y, w: +w, h: +h })
  }
  return out
}
const secRects = svgs.map(parseRects)
const secBars = secRects.map(rs => rs.filter(r => r.w > 0.5 && r.h > 0 && Math.abs(r.w - BW) < 0.5))
/** 取第 sec 张图、第 mi 月、满足 pred 的柱体 */
const pick = (sec, mi, pred) => secBars[sec].filter(r => near(r.x, xBar(mi)) && pred(r))
const one = (sec, mi, pred) => pick(sec, mi, pred)[0]
/** 整根彩色柱高 = 常规段 + 超额段 */
function fullH(sec, mi, fillC, deepC) {
  const f = one(sec, mi, r => r.fill === fillC)
  const d = one(sec, mi, r => r.fill === deepC)
  return (f ? f.h : 0) + (d ? d.h : 0)
}
const hSales = i => fullH(0, i, CI.sales, CI.salesDeep)
const hReb = i => fullH(1, i, CI.rebate, CI.rebateDeep)

console.log(`\n解析到 SVG ${svgs.length} 张；柱体 rect ${secBars.map(b => b.length).join(' + ')} 个`)
console.log(`（单图绘图区高 ${PLOT_H}px，柱宽 ${BW.toFixed(2)}px，月槽宽 ${GW.toFixed(2)}px，两图间距 ${SEC_GAP}px）\n`)

console.log('【0】结构：确实拆成了上下两张单轴图')
ok(svgs.length === 2, `渲染出 2 张 SVG（视口宽 ${MIN_W}）`)
ok(html.indexOf('>销量达成<') < html.indexOf('>实际返利<'), '顺序＝上图销量达成、下图实际返利')
ok(html.includes('>本年无') === false && html.includes('柱高＝实际销量') && html.includes('柱高＝实际返利金额'),
   '两张图各有小标题说明（柱高＝实际销量 / 柱高＝实际返利金额）')
ok(!html.includes('ax-tick') && !html.includes('右轴'), '双轴专有的右轴刻度短线与"右轴"字样已消失')

console.log('\n【1】每月只有一根柱（不再是两根并排），且水平居中于月槽')
{
  const xs0 = [...new Set(secBars[0].map(r => +r.x.toFixed(2)))].sort((a, b) => a - b)
  ok(xs0.length === 3, `销量图只有 3 个不同的柱 x（对应 1/2/3 月有数据）：${JSON.stringify(xs0)}`)
  const expCentered = near(xs0[0], PAD.l + (GW - BW) / 2)
  ok(expCentered, `1月柱 x=${xs0[0].toFixed(2)} 居中于月槽（槽 ${PAD.l}~${(PAD.l + GW).toFixed(2)}）`)
  const w = secBars[0][0].w
  ok(near(w, BW) && BW > 30, `柱宽 ${w.toFixed(2)}px —— 比 v161 的双柱（30px）更宽，视觉重量回到单图正中`)
}

console.log('\n【2】⭐ 两图月份列严格对齐（共享同一套 x 轴几何）')
{
  let bad = 0
  for (let i = 0; i < 12; i++) {
    const xs = secBars.map(b => +xBar(i).toFixed(4))
    if (xs[0] !== xs[1]) bad++
  }
  ok(bad === 0, '同一个月在上下两图的柱 x 完全相等 → 12 列一一对应')
  // 网格线 x 范围也须一致
  const gl = seg => [...seg.matchAll(/<line\b[^>]*\bclass="grid"[^>]*>/g)]
    .map(t => /x1="([0-9.]+)"[^>]*x2="([0-9.]+)"/.exec(t[0])).map(m => m[1] + '~' + m[2])
  ok(new Set(gl(svgs[0])).size === 1 && [...new Set(gl(svgs[0]))][0] === [...new Set(gl(svgs[1]))][0],
     `两图网格线横跨同一区间 ${[...new Set(gl(svgs[0]))][0]}（绘图区左 ${PAD.l} / 右 ${MIN_W - PAD.r}）`)
}

console.log('\n【3】销量图：柱高 ∝ 金额（本图量程 200 万）')
ok(pick(0, 0, r => r.cls.includes('track')).length === 1 &&
   near(one(0, 0, r => r.cls.includes('track')).h, px(1000000, SALES_MAX)),
   `1月轨道高 = ${px(1000000, SALES_MAX).toFixed(2)}px（目标 100万 ÷ 量程 200万 × ${PLOT_H}）`)
ok(near(one(0, 0, r => r.fill === CI.sales).h, px(500000, SALES_MAX)),
   `1月填充高 = ${px(500000, SALES_MAX).toFixed(2)}px（达成 50万）`)
ok(pick(0, 0, r => r.fill === CI.salesDeep).length === 0, '1月无超额段（未达标）')
ok(near(one(0, 1, r => r.fill === CI.sales).h, px(1600000, SALES_MAX)),
   `2月填充高 = ${px(1600000, SALES_MAX).toFixed(2)}px（达成 160万）`)
ok(near(one(0, 1, r => r.cls.includes('track')).h, px(2000000, SALES_MAX)),
   `2月轨道高 = ${px(2000000, SALES_MAX).toFixed(2)}px（目标 200万 ＝ 量程上限）`)
ok(near(one(0, 2, r => r.fill === CI.sales).h, px(400000, SALES_MAX)) &&
   near(one(0, 2, r => r.fill === CI.salesDeep).h, px(80000, SALES_MAX)),
   `3月 填充 ${px(400000, SALES_MAX).toFixed(2)}px（=目标40万）+ 超额 ${px(80000, SALES_MAX).toFixed(2)}px`)

console.log('\n【4】返利图：柱高 ∝ 金额（本图量程 7.5 万，与销量完全不同的一把尺子）')
ok(near(one(1, 0, r => r.cls.includes('track')).h, px(30000, REBATE_MAX)),
   `1月返利轨道高 = ${px(30000, REBATE_MAX).toFixed(2)}px（预估应返 3万 ÷ 量程 7.5万）`)
ok(near(one(1, 0, r => r.fill === CI.rebate).h, px(9000, REBATE_MAX)),
   `1月实际返利柱高 = ${px(9000, REBATE_MAX).toFixed(2)}px（实际 0.9万）`)
ok(near(one(1, 2, r => r.fill === CI.rebateDeep).h, px(3000, REBATE_MAX)),
   `3月返利超额段 = ${px(3000, REBATE_MAX).toFixed(2)}px（实际 1.5万 > 预估 1.2万）`)
ok(!near(one(1, 0, r => r.cls.includes('track')).h, one(0, 0, r => r.cls.includes('track')).h),
   '同一月份：销量轨道 68.00px ≠ 返利轨道 54.40px（各读各的尺子，不再互相迁就）')

console.log('\n【5】核心判据：柱高与金额严格等比（改造前此处全部相等）')
ok(near(hSales(1) / hSales(0), 1600000 / 500000, 0.001),
   `销量柱 2月/1月 = ${(hSales(1) / hSales(0)).toFixed(4)}（金额比 ${(1600000 / 500000).toFixed(4)}）`)
ok(near(hReb(1) / hReb(0), 48000 / 9000, 0.001),
   `返利柱 2月/1月 = ${(hReb(1) / hReb(0)).toFixed(4)}（金额比 ${(48000 / 9000).toFixed(4)}）`)
ok(!near(hSales(0), hSales(1)) && !near(hSales(1), hSales(2)), '三根销量柱高度两两不同')
ok(!near(hReb(0), hReb(1)) && !near(hReb(1), hReb(2)), '三根返利柱高度两两不同')
ok(near(hSales(0), PLOT_H * 500000 / SALES_MAX),
   `柱高绝对值也对：1月销量柱 ${hSales(0).toFixed(2)}px = ${PLOT_H}px × 50万/200万`)
{
  const tk0 = [...new Set(secBars[0].filter(r => r.cls.includes('track')).map(r => +r.h.toFixed(1)))].sort((a, b) => a - b)
  const tk1 = [...new Set(secBars[1].filter(r => r.cls.includes('track')).map(r => +r.h.toFixed(1)))].sort((a, b) => a - b)
  ok(tk0.length === 3 && tk1.length === 3,
     `灰轨道高度不再是恒定值：销量图 ${JSON.stringify(tk0)}、返利图 ${JSON.stringify(tk1)}（改造前恒为 1 种）`)
}

console.log('\n【6】y 坐标与柱高同源：轨道/填充起于 0 刻度线，超额段紧接填充段之上')
{
  const isDeep = r => r.fill === CI.salesDeep || r.fill === CI.rebateDeep
  const isTrack = r => r.cls.includes('track')
  const isFill = r => !isTrack(r) && !isDeep(r)
  let bad = 0, n = 0
  for (let sec = 0; sec < 2; sec++) {
    for (let i = 0; i < 12; i++) {
      const rs = secBars[sec].filter(r => near(r.x, xBar(i)))
      if (!rs.length) continue
      const fill = rs.find(isFill)
      for (const r of rs) {
        n++
        // 轨道与填充都从 0 刻度线起画；超额段叠在填充段「之上」（底边＝填充段顶边），不是从 0 起
        const bottom = isDeep(r) ? (fill ? fill.y : null) : PLOT_BASE
        if (bottom == null || !near(r.y + r.h, bottom)) bad++
      }
    }
  }
  ok(bad === 0 && n > 0,
     `全部 ${n} 个分段位置正确：轨道/填充底边＝0 刻度线 y=${PLOT_BASE}，超额段紧接填充段之上（错位 ${bad} 处）`)
  ok(near(one(0, 1, r => r.fill === CI.sales).y, py(1600000, SALES_MAX)),
     `2月销量柱顶 y = ${py(1600000, SALES_MAX).toFixed(2)}（= 0刻度线 − 柱高）`)
  // 超额段必须「有东西垫在下面」—— 否则说明它画到了 0 线，等于把目标段丢了
  const deep3 = pick(0, 2, r => r.fill === CI.salesDeep)[0]
  const fill3 = one(0, 2, r => r.fill === CI.sales)
  ok(near(deep3.y + deep3.h, fill3.y) && near(fill3.h, px(400000, SALES_MAX)),
     `3月超额段底边 = 填充段顶边 y=${fill3.y.toFixed(2)}（目标 40万 那一段仍在，未被超额段覆盖）`)
}

console.log('\n【7】每张图各有自己的坐标轴，刻度与柱高同源')
const axOf = seg => [...seg.matchAll(/class="ax-lb"[^>]*>([^<]*)</g)].map(x => x[1].trim())
const axA = axOf(svgs[0]), axB = axOf(svgs[1])
console.log('  上图轴刻度:', JSON.stringify(axA))
console.log('  下图轴刻度:', JSON.stringify(axB))
ok(JSON.stringify(axA) === JSON.stringify(['0', '40', '80', '120', '160', '200']), '上图刻度 = 0/40/80/120/160/200（万元）')
ok(JSON.stringify(axB) === JSON.stringify(['0', '15,000', '30,000', '45,000', '60,000', '75,000']), '下图刻度 = 0/1.5万/3万/4.5万/6万/7.5万（元）')
{
  // v162：单位只在小标题出现一次（轴顶不再重复标注）
  const units = [...html.matchAll(/class="sec-u"[^>]*>([^<]*)</g)].map(m => m[1])
  console.log('  两图小标题单位:', JSON.stringify(units))
  ok(units[0] === '万元' && units[1] === '元', `两图小标题各自标注单位：${JSON.stringify(units)}（无需去轴顶找）`)
  ok(!html.includes('ax-unit'), '轴顶不再重复标注单位（与小标题相隔仅 20 余像素，属冗余）')
}

{
  const gridYs = seg => [...seg.matchAll(/<line\b[^>]*\bclass="grid"[^>]*>/g)]
    .map(t => +/y1="([0-9.]+)"/.exec(t[0])[1])
  for (const [k, seg] of [[0, svgs[0]], [1, svgs[1]]]) {
    const ys = gridYs(seg)
    ok(ys.length === 6 && near(ys[5], PAD.t) && near(ys[0], PLOT_BASE),
      `${SECNAME[k]}：6 条网格线，最上＝量程上限 y=${PAD.t}、最下＝0 刻度线 y=${PLOT_BASE}`)
    ok(ys.every(y => near((PLOT_BASE - y) / (PLOT_H / 5), Math.round((PLOT_BASE - y) / (PLOT_H / 5)), 0.01)),
      `${SECNAME[k]}：网格线严格等距（步长 ${(PLOT_H / 5).toFixed(2)}px）→ 柱高可按刻度线性读数`)
  }
  const ysA = gridYs(svgs[0])
  ok(ysA.some(y => near(y, py(1200000, SALES_MAX))), `上图网格线含 120万 刻度 y=${py(1200000, SALES_MAX).toFixed(2)}`)
  // 反向读数自洽
  const h2 = one(0, 1, r => r.fill === CI.sales).h
  ok(near((h2 / PLOT_H) * SALES_MAX, 1600000, 2000),
    `反向读数自洽：上图 2月柱高 ${h2.toFixed(2)}px 换算回金额 = ${Math.round((h2 / PLOT_H) * SALES_MAX)}（真值 1600000）`)
}

console.log('\n【8】x 轴月份标签只在下方图出现一次（避免重复文字，两图按列对齐）')
{
  const moA = [...svgs[0].matchAll(/class="ax-mo"[^>]*>([^<]*)</g)].length
  const moB = [...svgs[1].matchAll(/class="ax-mo"[^>]*>([^<]*)</g)].length
  ok(moA === 0 && moB === 12, `上图月份标签 ${moA} 个、下图 ${moB} 个（只在最下方标注一次）`)
}

console.log('\n【9】旧行为应已消失')
ok(!html.includes('grid mark'), '100% 基准虚线已移除（它正是"等高灰柱"的来源）')
ok(!/ax-lb[^>]*>\d+%</.test(html), '轴刻度不再输出百分比')
ok(html.indexOf('左轴') === -1 && html.indexOf('右轴') === -1, '图例/文案里不再出现"左轴 / 右轴"字样')

console.log(`\n${'='.repeat(56)}\n结果：${pass} PASS / ${fail} FAIL\n${'='.repeat(56)}`)
process.exit(fail ? 1 : 0)
