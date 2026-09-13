/**
 * 柱顶 tooltip 的定位几何（纯函数，无 DOM 依赖，可单独单测）。
 *
 * 为什么只能横向避让：两张单轴图的绘图区各自只有 136px 高（SH 200 − PAD.t 34 − PAD.b 30），
 * 而 tooltip 实测 210 × 138～170px —— **比整块绘图区还高**，纵向无论贴顶还是贴底都会压住柱子。
 * 所以"不遮挡被 hover 的那根柱子"唯一可行的做法是：把整只盒子挪到该柱的**左侧或右侧**，
 * 贴柱缘留出 TIP_GAP 的净空 → 盒子与柱身矩形的 x 区间零交集（纵向叠不叠已无所谓）。
 *
 * ⚠️ 夹取（clamp）优先于"不叠柱"：万一两侧都放不下（画布极窄 + 内容超宽），
 *    宁可让盒子挨到画布边缘，也不能让它跑到画布外被 overflow 裁掉。
 */

/** 与 CSS `.mac-tip` 的 min-width 一致。只用于**选边**估算；真实宽度由内容决定，落位后用实测值夹取。 */
export const TIP_W = 210
/** tooltip 与被 hover 柱身之间的净空（px） */
export const TIP_GAP = 8
/** tooltip 与画布边缘的净空（px） */
export const TIP_EDGE = 2

/**
 * 选边 + 算锚点。
 * @param {number} center   被 hover 柱的柱心 x（画布坐标，与 SVG 用户单位 1:1）
 * @param {number} halfBar  柱半宽
 * @param {number} canvasW  画布宽（＝ SVG viewBox 宽）
 * @returns {{anchor:number, flip:boolean}} flip=false → anchor 是盒子**左**缘；true → 是盒子**右**缘
 *          （配 CSS `transform: translateX(-100%)`，故与盒子实际宽度无关，任何宽度都成立）
 */
export function tipAnchor(center, halfBar, canvasW, { tipW = TIP_W, gap = TIP_GAP, edge = TIP_EDGE } = {}) {
  const right = center + halfBar + gap // 贴右时的锚点（盒子左缘）
  const left = center - halfBar - gap  // 贴左时的锚点（盒子右缘）
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
