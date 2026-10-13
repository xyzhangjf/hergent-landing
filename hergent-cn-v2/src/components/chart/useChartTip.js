/**
 * useChartTip.js —— 图表 tooltip 的定位几何 + 悬停状态（v491）
 *
 * 为什么 tooltip 只能**横向**避让：图表绘图区常常只有一百多像素高（如
 * `MonthlyAchvChart` 单图 200 − 34 − 30 = 136px），而一只 tooltip 实测 210 × 140～170px
 * ——**比整块绘图区还高**，纵向无论贴顶还是贴底都会压住数据点。
 * 所以"不遮挡被 hover 的对象"唯一可行的做法是：把整只盒子挪到该点的**左侧或右侧**，
 * 贴边留出 TIP_GAP 净空 → 盒子与被 hover 对象的 x 区间零交集（纵向叠不叠已无所谓）。
 *
 * ⚠️ 夹取（clamp）优先于"不遮挡"：万一两侧都放不下（画布极窄 + 内容超宽），
 *    宁可让盒子挨到画布边缘，也不能让它跑到画布外被 overflow 裁掉。
 *
 * 🔴 本文件是这套几何的**唯一实现**：原住在 `components/rebate/tipPlacement.js`，
 *    v491 上提到通用图表层（通用消费者在主仓这一侧），那边改为**再导出** —— 不留两份。
 *
 * ⚠️ pointer-events:none 必须由使用方在 CSS 里保留：盒子挪到被 hover 对象外侧后
 *    会盖住相邻元素的悬停区，一旦吃掉事件就换不了点。
 */
import { ref, nextTick } from 'vue'

/** 与 `.mac-tip` / `.ch-tip` 的 min-width 一致。只用于**选边**估算；真实宽度由内容决定，落位后用实测值夹取。 */
export const TIP_W = 210
/** tooltip 与被 hover 对象之间的净空（px） */
export const TIP_GAP = 8
/** tooltip 与画布边缘的净空（px） */
export const TIP_EDGE = 2

/**
 * 选边 + 算锚点（纯函数）。
 * @param {number} center   被 hover 对象的中心 x（画布坐标，与 SVG 用户单位 1:1）
 * @param {number} halfW    半宽
 * @param {number} canvasW  画布宽（＝ SVG viewBox 宽）
 * @returns {{anchor:number, flip:boolean}} flip=false → anchor 是盒子**左**缘；true → 是盒子**右**缘
 *          （配 CSS `transform: translateX(-100%)`，故与盒子实际宽度无关，任何宽度都成立）
 */
export function tipAnchor(center, halfW, canvasW, { tipW = TIP_W, gap = TIP_GAP, edge = TIP_EDGE } = {}) {
  const right = center + halfW + gap // 贴右时的锚点（盒子左缘）
  const left = center - halfW - gap  // 贴左时的锚点（盒子右缘）
  const fitsRight = right + tipW <= canvasW - edge
  const fitsLeft = left - tipW >= edge
  let flip
  if (fitsRight) flip = false          // 右侧放得下就右侧（顺着阅读方向）
  else if (fitsLeft) flip = true       // 右侧放不下 → 翻到左侧
  else flip = left > canvasW - right   // 两侧都放不下 → 取空间更大的一侧
  return { anchor: flip ? left : right, flip }
}

/**
 * 用**实测**宽高把盒子夹进画布（正常情况原样返回，只在越界时平移最小距离）。
 * 返回值仍是"锚点"形式，与 tipAnchor 同坐标系 —— 组件直接写回 style.left 即可。
 */
export function clampTipAnchor({ anchor, flip, w, h, top }, { canvasW, canvasH }, edge = TIP_EDGE) {
  const left = flip ? anchor - w : anchor
  const maxLeft = Math.max(edge, canvasW - w - edge)
  const maxTop = Math.max(edge, canvasH - h - edge)
  const l = Math.min(Math.max(left, edge), maxLeft)
  const t = Math.min(Math.max(top, edge), maxTop)
  return { anchor: flip ? l + w : l, top: t }
}

/**
 * 悬停状态 composable（各图型共用）。
 *
 * @param {() => {canvasW:number, canvasH:number}} sizeOf  画布尺寸（响应式取）
 * @param {number} offsetTop  画布在组件内的纵向起点（有多图分段时用，如两图上下排）
 */
export function useChartTip(sizeOf, offsetTop = 0) {
  const tip = ref(null)
  const tipEl = ref(null)

  /** 首帧按常量落位（同帧即可见），随后用实测宽高夹一次 —— 正常情况下夹取不会移动它 */
  function place() {
    if (!tip.value || !tipEl.value) return
    const { canvasW, canvasH } = sizeOf()
    const { anchor, top } = clampTipAnchor(
      { anchor: tip.value.anchor, flip: tip.value.flip, w: tipEl.value.offsetWidth, h: tipEl.value.offsetHeight, top: tip.value.baseTop },
      { canvasW, canvasH },
    )
    tip.value.x = anchor + 'px'
    tip.value.top = top + 'px'
  }

  /**
   * @param {object} p
   * @param {string} p.key      去重键：同一对象上 mousemove 连续触发时直接返回（省掉重渲染与重测量）
   * @param {string} p.title
   * @param {Array}  p.rows     [{k, v, r?, warn?}]
   * @param {Array}  [p.extra]  [{k, v}]
   * @param {number} p.anchorX  被 hover 对象的中心 x
   * @param {number} p.halfW    半宽（点用小值，柱用半柱宽）
   * @param {number} [p.top]    纵向基准（默认取 offsetTop）
   */
  function show(p) {
    const { canvasW } = sizeOf()
    if (tip.value && tip.value.k === p.key) return
    const { anchor, flip } = tipAnchor(p.anchorX, p.halfW, canvasW)
    const baseTop = offsetTop + (p.top || 0)
    tip.value = {
      k: p.key,
      title: p.title || '',
      rows: p.rows || [],
      extra: p.extra || [],
      anchor, flip, baseTop,
      x: anchor + 'px',
      top: baseTop + 'px',
    }
    nextTick(place)
  }

  function hide() { tip.value = null }

  return { tip, tipEl, show, hide, place }
}
