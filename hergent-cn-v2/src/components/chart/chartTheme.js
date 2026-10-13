/* ============================================================================
   chartTheme.js —— 图表色板与"取实际色"工具（v491，2026-10-13）
   ============================================================================
   一、为什么色板必须住在这里、而不是各组件里各写一遍
   ---------------------------------------------------------------------------
   图表是本仓**唯一**要在明暗两态下都成立的渲染层。色值一旦写进组件，就等于
   "深色模式下再错一次"（本项目 v321「date 弹窗白底」/ v434 角色头像 那一族坑的同型）。
   收敛成一份之后：组件里只允许 `fill="var(--chart-1)"` 这种写法 ——
   CSS 变量在 DOM/SVG 里**原生跟随主题**，换主题零成本、无需 JS 桥接。

   ⚠️ 与本仓既有图表的关系：`components/rebate/MonthlyAchvChart.vue` 里那套
      `#06b6d4 / #f59e0b / #16a34a / #dc2626` 是**同一批色**的硬编码版，
      那个组件被调优过 12 轮（v159→v186），本轮只抽几何、不碰配色（避免回归）。
      新组件一律走本文件的令牌；两者色相一致，同屏不打架。

   二、涨红跌绿（中文口径，与 --suc/--dan 正交）
   ---------------------------------------------------------------------------
   `--suc` / `--dan` 表达的是「成功 / 危险」，与「上涨 / 下跌」是**两个正交体系**。
   拿 `--suc`（绿）去画上涨，在中国市场语境下是**反的** ⇒ 独立出 `--chart-up/--chart-down`。
   ⚠️ 本产品面向快消经销商，看的是销售额/毛利/达成率这类"经营量"，
      涨跌语义用得不多；真用到时按本条走，别再从 --suc 借绿。
   ============================================================================ */

/** 分类色序（按 `--chart-1..8` 循环）。第 8 位是"其他"专用灰，不入正常循环。 */
export const SERIES_TOKENS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)',
]

/** "其他 / 未分类"档专用（灰）—— 刻意**不**参与上面的循环，避免它抢到主色位 */
export const OTHER_TOKEN = 'var(--chart-8)'

export const TOKEN = {
  grid: 'var(--chart-grid)',
  track: 'var(--chart-track)',
  empty: 'var(--chart-empty)',
  up: 'var(--chart-up)',
  down: 'var(--chart-down)',
  axis: 'var(--t3)',
  axisLine: 'var(--bd)',
  surface: 'var(--bg)',
  border: 'var(--bd)',
}

/**
 * 取第 i 个系列的颜色令牌。
 * `isOther` 为真时给灰（"其他"档），否则按序循环。
 */
export function seriesColor(i, isOther = false) {
  if (isOther) return OTHER_TOKEN
  const n = SERIES_TOKENS.length
  return SERIES_TOKENS[((i % n) + n) % n]
}

/** 图上文字统一用这个（轴标签 / 图例 / 数值标注），保证三处同字号同色 */
export const CHART_FONT = '11px'

/**
 * 读某个 CSS 变量的**实际解析值**。
 *
 * 用途只有一个：**导出 PNG 时把变量内联成字面色**。
 * 🔴 为什么必须内联：导出走的是「SVG 序列化 → data URL → <img> → canvas」，
 *    那条链路里的 SVG 是**孤立文档**，拿不到 `:root` 上的 CSS 变量
 *    ⇒ 不内联的话，导出的图**全是黑块**（fill 回落到默认黑）。
 *    —— 这是图表导出最经典的一个坑，实测踩过，别省这一步。
 */
export function resolveVar(expr) {
  const s = String(expr || '')
  // 连 fallback 一起接出来：`var(--x, #fff)` 在 --x 未定义时浏览器取 #fff，
  // 若这里只认变量名就会把 `var(--x, #fff)` **原样**写进导出的 SVG ⇒ 那处变黑块。
  const m = s.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/)
  if (!m) return s
  const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()
  if (v) return v
  const fb = (m[2] || '').trim()
  return fb || s
}

/**
 * 把一个 SVG 元素浅克隆成"自包含"副本：所有画笔色 / 字体 / 尺寸都写死为字面值。
 * 只处理渲染属性（fill/stroke/stroke-width/font-*），不动结构与 data-*。
 *
 * @param {SVGElement} svg       源 SVG
 * @param {object} opts
 * @param {string} opts.background  背景填充色（令牌或字面色）；传空串则不填背景
 * @returns {SVGElement} 可直接序列化的副本
 */
export function inlineSvg(svg, { background = TOKEN.surface } = {}) {
  const clone = svg.cloneNode(true)
  const srcNodes = [svg, ...svg.querySelectorAll('*')]
  const dstNodes = [clone, ...clone.querySelectorAll('*')]

  // 先把源节点上"由 CSS 类提供"的最终色读出来。读的是 getComputedStyle（已解析），
  // 不是 getAttribute（那拿到的是 `var(--x)` 这种未解析声明，内联了也没用）。
  for (let i = 0; i < srcNodes.length; i++) {
    const s = srcNodes[i]
    const d = dstNodes[i]
    if (!d.setAttribute) continue
    const cs = getComputedStyle(s)
    if (!cs) continue
    // fill / stroke：只在"确实画了东西"的元素上写
    if (cs.fill && cs.fill !== 'none') d.setAttribute('fill', cs.fill)
    else if (cs.fill === 'none' && s.tagName && s.tagName.toLowerCase() !== 'text') d.setAttribute('fill', 'none')
    if (cs.stroke && cs.stroke !== 'none') {
      d.setAttribute('stroke', cs.stroke)
      const sw = parseFloat(cs.strokeWidth)
      if (sw > 0) d.setAttribute('stroke-width', String(sw))
      if (cs.strokeDasharray && cs.strokeDasharray !== 'none') d.setAttribute('stroke-dasharray', cs.strokeDasharray)
      if (cs.strokeLinecap && cs.strokeLinecap !== 'butt') d.setAttribute('stroke-linecap', cs.strokeLinecap)
      if (cs.strokeLinejoin && cs.strokeLinejoin !== 'miter') d.setAttribute('stroke-linejoin', cs.strokeLinejoin)
    }
    if (cs.opacity && cs.opacity !== '1') d.setAttribute('opacity', cs.opacity)
    if (cs.fillOpacity && cs.fillOpacity !== '1') d.setAttribute('fill-opacity', cs.fillOpacity)
    const tag = (s.tagName || '').toLowerCase()
    if (tag === 'text') {
      d.setAttribute('font-family', cs.fontFamily || 'sans-serif')
      d.setAttribute('font-size', cs.fontSize || '11px')
      d.setAttribute('font-weight', cs.fontWeight || '400')
      if (cs.textAnchor) d.setAttribute('text-anchor', cs.textAnchor)
      // 柱顶标签用的描边（paint-order）在导出链路里会掉，直接去掉更干净
      d.removeAttribute('paint-order')
      d.setAttribute('stroke', 'none')
    }
  }

  // 尺寸：导出必须有确定的 px 尺寸，否则 canvas 按 viewBox 之外的默认值画 → 空白
  const box = svg.getBoundingClientRect()
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
  const w = Math.max(1, Math.round(box.width || (vb[2] || 0) || 600))
  const h = Math.max(1, Math.round(box.height || (vb[3] || 0) || 240))
  const dpr = 2 // 2 倍图，贴进 PPT/Word 不糊
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`)

  // 背景：单独插一层 rect 垫底（比 canvas 端 fillRect 更稳，且导出即所见）
  if (background) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', '0'); rect.setAttribute('y', '0')
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%')
    rect.setAttribute('fill', resolveVar(background))
    clone.insertBefore(rect, clone.firstChild)
  }
  return { node: clone, width: w, height: h, scale: dpr }
}
