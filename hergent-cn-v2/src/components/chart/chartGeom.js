/* ============================================================================
   chartGeom.js —— 四种图型的几何计算（纯函数，无 DOM 依赖）（v491）
   ============================================================================
   为什么单独一层：
     1. **可单测 / 可被探针直接调用** —— 图表"画得对不对"是几何问题，几何是纯函数
        就允许无头探针直接算期望值，再与真机渲染出的 DOM 属性逐个比对（见
        `.workbuddy/tools/v491-chart-render-probe.mjs`）。
     2. **同一套几何只能有一份** —— `MonthlyAchvChart.vue` 的柱体几何（v161→v186 调优了 6 轮）
        与新的通用柱状图共用这里的实现，避免"改了一张忘另一张、代码不报错只有真机上不对"。

   🔴 与本层无关的、绝不能搬进来的东西：任何业务口径（达成率怎么算、返利怎么试算、
      月份怎么过滤）。那些一律调后端已部署函数 —— 前端只负责「攒输入 + 渲染」。
      一旦在这里"顺手算一遍"，验的就只是前端跟自己的算法一致（同义反复）。
   ============================================================================ */

/** 有值就必须看得见：柱子/条形的最小可见高度（px）。
 *  v186 的教训：某月目标相对全年量程只占 0.1% ⇒ 高度算成 0.1px，屏幕上等于没画，
 *  用户会以为"这个月的目标丢了"。宁可略微夸大小到看不见的量，也不能让它消失
 *  （精确数值由 tooltip 与数值标注承担）。 */
export const MIN_TRACK_PX = 2

const round = (n) => Math.round(n * 100) / 100
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0))

/** 由画布尺寸与内边距算出绘图区 */
export function plotBox({ W, H, pad }) {
  const plotW = Math.max(1, W - pad.l - pad.r)
  const plotH = Math.max(1, H - pad.t - pad.b)
  return { plotW, plotH, base: pad.t + plotH }
}

/* ---------------------------------------------------------------------------
   柱状 / 条形共用：量程 → 高度 / 坐标
   --------------------------------------------------------------------------- */

/** 值 → 像素高度（等比）。量程为 0（全空）时返回 0 —— 由调用方走空态，不画零柱 */
export function hOf(v, min, max, plotH) {
  const lo = Number(min) || 0
  const hi = Number(max) || 0
  if (hi - lo <= 0) return 0
  return (Math.min(Math.max(Number(v) || 0, lo), hi) - lo) / (hi - lo) * plotH
}

/** 值 → y 坐标（柱底为 0 轴位置） */
export function yOf(v, min, max, base, plotH) {
  return base - hOf(v, min, max, plotH)
}

/**
 * 纵向柱状图布局（月槽 / 柱宽 / 分组内偏移）。
 * @param {object} p
 * @param {number} p.plotW 绘图区宽
 * @param {number} p.padL  左边距（x 起点）
 * @param {number} p.count 槽数（如 12 个月）
 * @param {number} [p.minBar] / [p.maxBar] 柱宽夹取（默认 12 / 44，与 MonthlyAchvChart 的视觉重量一致）
 * @param {number} [p.gapRatio] 槽内两侧留白比例
 */
export function barLayout({ plotW, padL, count, minBar = 12, maxBar = 44, gapRatio = 0.16 }) {
  const n = Math.max(1, Number(count) || 1)
  const slot = plotW / n
  const gap = Math.max(4, Math.min(12, slot * gapRatio))
  const bw = Math.max(minBar, Math.min(maxBar, slot - gap * 2))
  return {
    slot,
    gap,
    bw,
    /** 第 i 个槽的**整槽**左缘（用于透明悬停区、月份标签居中） */
    xGroup: (i) => padL + i * slot,
    /** 第 i 根柱（单系列）在槽内水平居中 */
    xBar: (i) => padL + i * slot + (slot - bw) / 2,
    /** 多系列（分组）时：第 i 槽内第 s 根柱的左缘，groupWidth＝本组总宽 */
    xInGroup: (i, s, seriesCount, innerGap = 3) => {
      const gw = Math.min(bw, (slot - gap * 2 - innerGap * (seriesCount - 1)) / seriesCount)
      const total = gw * seriesCount + innerGap * (seriesCount - 1)
      const start = padL + i * slot + (slot - total) / 2
      return { x: start + s * (gw + innerGap), w: gw }
    },
  }
}

/**
 * 横向条形图布局（排行）。
 * 每行 = 标签区 + 轨道区；返回逐行的 y / 条长。
 * @param {number} rowH 行高（含行间距）
 */
export function hbarLayout({ items, plotW, padT, rowH }) {
  const max = items.reduce((m, it) => Math.max(m, Math.abs(Number(it.value) || 0)), 0)
  return {
    max,
    rows: items.map((it, i) => {
      const v = Math.abs(Number(it.value) || 0)
      const w = max > 0 ? Math.max(0, v / max * plotW) : 0
      return { ...it, i, y: padT + i * rowH, w: round(w), value: Number(it.value) || 0 }
    }),
  }
}

/* ---------------------------------------------------------------------------
   折线 / 面积
   --------------------------------------------------------------------------- */

/** 折线坐标：x 按等距分布（**不**按时间刻度 —— 日/期数据等距即可，避免空档跳变） */
export function lineGeometry({ plotW, plotH, base, padL, padT, count }) {
  const n = Math.max(1, Number(count) || 1)
  return {
    xAt: (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW),
    yAt: (v, min, max) => (max - min <= 0 ? base : base - clamp01((Number(v) - min) / (max - min)) * plotH),
    padT,
  }
}

/** 折线点串（SVG polyline 的 points） */
export function polyline(pts) {
  return pts.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
}

/** 面积路径（闭合到基线）—— 用 path 而非 polygon，便于将来加曲线 */
export function areaPath(pts, baseY) {
  if (!pts.length) return ''
  const first = pts[0]
  const last = pts[pts.length - 1]
  return `M ${round(first.x)} ${round(baseY)} L ` +
    pts.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ') +
    ` L ${round(last.x)} ${round(baseY)} Z`
}

/** 平滑曲线路径（Catmull-Rom → 三次贝塞尔，张力 0.5）。点数 < 3 时退回直线 */
export function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length < 3) return 'M ' + pts.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')
  let d = `M ${round(pts[0].x)} ${round(pts[0].y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(p2.x)} ${round(p2.y)}`
  }
  return d
}

/* ---------------------------------------------------------------------------
   环形 / 饼图
   --------------------------------------------------------------------------- */

const polar = (cx, cy, r, a) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })

/**
 * 环形图弧段。返回每段的 path（外弧 + 内弧闭合）与标签锚点。
 * @param {Array} items  [{label, value}]
 * @param {object} o    {cx, cy, r, thickness, gapDeg}
 * 单段占满 360° 时 SVG 弧线会退化成"零长度"（起止点重合 ⇒ 什么都不画）——
 * 这是环形图最经典的坑，故**单段特例**直接给一个圆环（两段弧拼成）。
 */
export function donutArcs(items, { cx, cy, r, thickness = 26, gapDeg = 1.6 } = {}) {
  const list = (items || []).map((it) => ({ ...it, value: Math.max(0, Number(it.value) || 0) }))
  const total = list.reduce((s, it) => s + it.value, 0)
  if (total <= 0) return { total: 0, arcs: [] }
  const rIn = Math.max(1, r - thickness)
  const gap = (gapDeg * Math.PI) / 180
  const usable = Math.PI * 2 - gap * list.filter((it) => it.value > 0).length

  let a0 = -Math.PI / 2 // 12 点方向起笔
  const arcs = []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    if (it.value <= 0) { arcs.push({ ...it, i, path: '', pct: 0, mid: 0, lx: 0, ly: 0 }); continue }
    const sweep = (it.value / total) * usable
    const a1 = a0 + sweep
    const mid = (a0 + a1) / 2
    const p1 = polar(cx, cy, r, a0)
    const p2 = polar(cx, cy, r, a1)
    const p3 = polar(cx, cy, rIn, a1)
    const p4 = polar(cx, cy, rIn, a0)
    const large = sweep > Math.PI ? 1 : 0
    const path = `M ${round(p1.x)} ${round(p1.y)} ` +
      `A ${r} ${r} 0 ${large} 1 ${round(p2.x)} ${round(p2.y)} ` +
      `L ${round(p3.x)} ${round(p3.y)} ` +
      `A ${rIn} ${rIn} 0 ${large} 0 ${round(p4.x)} ${round(p4.y)} Z`
    const rm = (r + rIn) / 2
    const lp = polar(cx, cy, rm, mid)
    arcs.push({ ...it, i, path, pct: it.value / total, mid, lx: round(lp.x), ly: round(lp.y), a0, a1 })
    a0 = a1 + gap
  }
  return { total, arcs, rIn }
}

/** 由绘图区宽高算环形图圆心与半径（留出上下标注空间） */
export function donutBox({ W, H, pad = { l: 8, r: 8, t: 8, b: 8 } }) {
  const cx = pad.l + (W - pad.l - pad.r) / 2
  const cy = pad.t + (H - pad.t - pad.b) / 2
  const r = Math.max(8, Math.min(W - pad.l - pad.r, H - pad.t - pad.b) / 2)
  return { cx: round(cx), cy: round(cy), r: round(r) }
}

/** 弧段用的 SVG 描边宽度（用 stroke 画环时，半径取中线） */
export function donutStrokeR({ W, H, thickness = 26 }) {
  const box = donutBox({ W, H })
  return { ...box, rMid: round(Math.max(4, box.r - thickness / 2)), thickness }
}
