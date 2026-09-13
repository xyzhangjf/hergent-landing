<template>
  <div class="mac" ref="rootEl">
    <div class="mac-hd">
      <div class="mac-ti">
        <b>全年月度达成</b>
        <span class="mac-sub">柱高＝金额（销量柱读左轴、返利柱读右轴）；灰轨道＝目标 / 预估应返，深色段＝超出部分</span>
      </div>
      <div class="mac-ctl">
        <!-- v154 P2-A：品牌筛选已提升为页面级（`BrandFilter.vue`，与页面「统计月份」并排，一处筛选统管
             图表 + 异常区 + 达成列表）；原「全年视图」scope 徽标一并删除 —— 标题「全年月度达成」已表达该语义，
             且它与页头「单月视图」样式不一，两个时间维度的层级关系反而更乱 -->
        <select v-model="yearVal" class="input sel-year" @change="emit('update:year', yearVal)">
          <option v-for="y in yearOptions" :key="y" :value="y">{{ y }} 年</option>
        </select>
      </div>
    </div>

    <!-- v159：图例改为「口径说明」——每月两根合并柱后，目标与达成不再是可独立开关的两个系列，
         故不再提供点击隐藏；改为解释柱子的两段结构（轨道 / 填充 / 超额段）与本月红绿规则 -->
    <div class="mac-legend">
      <!-- v161：把轴单位写进图例 —— 两根柱各自量程（销量差返利 1~2 个数量级），
           "数值小却柱子高"是双轴图的固有观感，必须让读者随时知道每根柱读哪根轴、单位是什么 -->
      <span class="lg-item"><i :style="{ background: C.sales.fill }"></i>销量达成（左轴 · {{ salesUnit || '—' }}）</span>
      <span class="lg-item"><i :style="{ background: C.rebate.fill }"></i>实际返利（右轴 · {{ rebateUnit }}）</span>
      <span class="lg-item"><i class="lg-track"></i>灰轨道＝目标 / 预估应返</span>
      <span class="lg-item">
        <i :style="{ background: C.ahead.deep }"></i>
        <i :style="{ background: C.behind.deep }" class="lg-gap"></i>
        本月 绿＝超前时间进度 / 红＝落后
      </span>
      <span v-if="paceIdx >= 0" class="lg-item"><i class="lg-line"></i>虚线＝本月时间进度应完成的金额</span>
      <span class="lg-item"><i class="lg-deep"></i>深色段＝超出目标的部分</span>
    </div>

    <!-- 加载态：骨架屏 -->
    <div v-if="loading" class="mac-body mac-skel">
      <div v-for="i in 12" :key="i" class="sk-col">
        <span :style="{ height: (30 + ((i * 37) % 45)) + '%' }"></span>
        <span :style="{ height: (24 + ((i * 23) % 40)) + '%' }"></span>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else-if="!hasAny" class="mac-body mac-empty">
      <p>{{ emptyText }}</p>
      <slot name="empty-action" />
    </div>

    <!-- 图表 -->
    <div v-else class="mac-scroll">
      <div class="mac-canvas">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        class="mac-svg"
        preserveAspectRatio="none"
        role="img"
        @mouseleave="tip = null"
      >
        <!-- v161：纵轴＝金额（柱高 ∝ 金额）。销量与返利量级不可比 → 各自独立量程：
             左轴读销量（万元 / 件），右轴读返利（元）。网格线只按左轴刻度画，右轴另标短线 -->
        <line
          v-for="g in gridLines" :key="'g' + g.v"
          :x1="PAD.l" :x2="W - PAD.r" :y1="g.y" :y2="g.y"
          class="grid"
        />
        <text
          v-for="g in gridSales" :key="'gl' + g.v"
          class="ax-lb ax-sales" :x="PAD.l - 8" :y="g.y + 4" text-anchor="end"
        >{{ axNum(g.v, salesUnit) }}</text>
        <line
          v-for="g in gridRebate" :key="'rt' + g.v"
          :x1="W - PAD.r" :x2="W - PAD.r + 4" :y1="g.y" :y2="g.y"
          class="ax-tick"
        />
        <text
          v-for="g in gridRebate" :key="'gr' + g.v"
          class="ax-lb ax-rebate" :x="W - PAD.r + 8" :y="g.y + 4" text-anchor="start"
        >{{ axNum(g.v, rebateUnit) }}</text>
        <text
          v-if="gridSales.length" class="ax-unit ax-sales"
          :x="PAD.l - 8" :y="PAD.t - 12" text-anchor="end"
        >{{ salesUnit }}</text>
        <text
          v-if="gridRebate.length" class="ax-unit ax-rebate"
          :x="W - PAD.r + 8" :y="PAD.t - 12" text-anchor="start"
        >{{ rebateUnit }}</text>

        <g v-for="(mo, i) in months" :key="mo.key">
          <template v-for="(b, bi) in barsOf(mo)" :key="mo.key + bi">
            <!-- 目标轨道：从 0 长到「该月目标金额」，高度 ∝ 目标值
                 （v161 前它恒为 100% 的等高灰柱，是"所有柱子一样高"的根源） -->
            <rect
              v-if="b.trackH > 0"
              :x="xBar(i, bi)" :y="b.yTrack"
              :width="BW" :height="b.trackH"
              class="track" rx="1.5"
            />
            <!-- 达成填充：0 → min(达成金额, 目标金额) -->
            <rect
              v-if="b.fillH > 0"
              :x="xBar(i, bi)" :y="b.yFill"
              :width="BW" :height="b.fillH"
              :fill="b.fill" rx="1.5"
            />
            <!-- 超额段：目标金额 → 达成金额，用同色加深，超额一眼可见且不引入新色相 -->
            <rect
              v-if="b.deepH > 0"
              :x="xBar(i, bi)" :y="b.yDeep"
              :width="BW" :height="b.deepH"
              :fill="b.deep" rx="1.5"
            />
          </template>

          <!-- 柱顶数值：竖排「金额·达成率」（12 月 × 2 柱横排放不下，竖排最清晰且逐柱一一对应）；
               单位不在标签里重复，由左右轴轴名（万元 / 件 / 元）与 tooltip 交代，标签只写数字保持干净 -->
          <text
            v-for="(b, bi) in barsOf(mo)" :key="mo.key + 'lb' + bi"
            v-show="b.show && Number(b.achv) > 0"
            class="bar-lb"
            :x="xBar(i, bi) + BW / 2 + 3.2" :y="b.yLbl"
            text-anchor="start"
            :fill="b.lbl"
            :transform="`rotate(-90 ${xBar(i, bi) + BW / 2 + 3.2} ${b.yLbl})`"
          >{{ barLabelOf(b) }}</text>

          <text class="ax-mo" :x="xGroup(i) + GW / 2" :y="H - PAD.b + 20" text-anchor="middle">
            {{ mo.m }}月
          </text>
          <circle v-if="mo.key === curKey" :cx="xGroup(i) + GW / 2" :cy="H - PAD.b + 30" r="2.5" class="cur-dot" />
          <rect
            :x="xGroup(i)" :y="PAD.t" :width="GW" :height="plotH"
            fill="transparent" @mouseenter="onHover(mo, i)" @mousemove="onHover(mo, i)"
          />
        </g>

        <!-- 本月时间进度（与 KPI 卡同口径）：只标当前月。柱高改成金额后，"时间进度"在金额轴上
             ＝「该月目标 × 时间进度」，故每根柱各画一段自己量程的短线（销量/返利量程不同）。
             柱顶过线＝超前（绿），未过线＝落后（红）—— 与改造前"达成率 ≥ 时间进度"完全等价。 -->
        <g v-if="paceIdx >= 0">
          <template v-for="(b, bi) in paceBars" :key="'pace' + bi">
            <line
              v-if="b.trackH > 0"
              :x1="xBar(paceIdx, bi)" :x2="xBar(paceIdx, bi) + BW"
              :y1="yAmt(b.target * timeProgress, b.max)" :y2="yAmt(b.target * timeProgress, b.max)"
              class="pace-line"
            />
          </template>
        </g>

        <line :x1="PAD.l" :x2="W - PAD.r" :y1="plotBase" :y2="plotBase" class="axis" />
      </svg>

      <div v-if="tip" class="mac-tip" :class="{ 'to-left': tip.flip }" :style="{ left: tip.x }">
        <b>{{ tip.title }}</b>
        <div class="tp-row" v-for="r in tip.rows" :key="r.k">
          <span class="tp-k">{{ r.k }}</span>
          <span class="tp-v">{{ r.v }}</span>
          <span class="tp-r" :class="{ warn: r.warn }">{{ r.r }}</span>
        </div>
        <div class="tp-ex" v-for="r in tip.extra" :key="r.k">
          <span class="tp-k">{{ r.k }}</span><span class="tp-v">{{ r.v }}</span>
        </div>
      </div>
      </div>
    </div>

    <div v-if="!loading && hasAny && ftText" class="mac-ft">
      <!-- v154 E4：原三条并列脚注读起来像"bug 列表"，本质是同一件事：本图的统计范围 → 合并为一句；
           「去达成填报补录」的动作指引下沉到 hover title（需要时才有，不占常驻版面） -->
      <span :title="(emptyMonths || emptyRebateMonths) ? '灰色轨道＝该月尚未填报销量达成或实际返利，可去「达成填报」补录' : ''">{{ ftText }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { rate, niceMax } from './useMonthlyAchv.js'

const props = defineProps({
  model: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  year: { type: [Number, String], default: '' },
  yearOptions: { type: Array, default: () => [] },
  // v154 P2-A：品牌筛选已提到页面级，本组件不再承载筛选控件；singleBrand 仍用于 tooltip 的差额行
  singleBrand: { type: Boolean, default: false },
})
const emit = defineEmits(['update:year'])

const yearVal = ref(props.year)
watch(() => props.year, v => { yearVal.value = v })

// v124：画布宽度跟随容器自适应（viewBox 宽度 = 实际渲染宽度，避免 SVG 等比缩放导致左右大片留白）
const MIN_W = 600
const rootEl = ref(null)
const W = ref(MIN_W)
const H = 300
// v159：合并柱后右轴曾一度取消；v161 柱高改为金额后销量与返利量级不可比 → 恢复右轴（返利金额），
//        右侧标签区需要净空 → r 18→64（够 "150万" ≈ 4 字 11px 文本 + 8px 间距）
const PAD = { l: 52, r: 64, t: 34, b: 34 }
const plotW = computed(() => W.value - PAD.l - PAD.r)
const plotH = H - PAD.t - PAD.b
const GW = computed(() => plotW.value / 12)
// 每月两根柱：左右外边距 = 柱间间隔 = GAP
const GAP = computed(() => Math.max(4, Math.min(10, GW.value * 0.14)))
const BW = computed(() => Math.max(9, Math.min(30, (GW.value - GAP.value * 3) / 2)))

function measureW() {
  const el = rootEl.value
  if (!el) return
  const w = Math.round(el.getBoundingClientRect().width)
  if (w > 0) W.value = Math.max(MIN_W, w)
}
let ro = null
onMounted(() => {
  measureW()
  if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
    ro = new ResizeObserver(measureW)
    ro.observe(rootEl.value)
  } else {
    window.addEventListener('resize', measureW)
  }
})
onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  window.removeEventListener('resize', measureW)
})

const tip = ref(null)

// v159 色板：fill = 达成填充（历史月＝品牌色）；deep = 超额段（同色相加深）；
//        ahead/behind = 本月「超前/落后时间进度」；neutral = 无目标时的中性灰（不判红绿）
const C = {
  sales: { fill: '#06b6d4', deep: '#0e7490', lbl: '#0e7490' },
  rebate: { fill: '#f59e0b', deep: '#b45309', lbl: '#b45309' },
  ahead: { fill: '#16a34a', deep: '#15803d', lbl: '#15803d' },
  behind: { fill: '#dc2626', deep: '#b91c1c', lbl: '#b91c1c' },
  neutral: { fill: '#94a3b8', deep: '#64748b', lbl: '#64748b' },
}

const months = computed(() => props.model?.months || [])
const excluded = computed(() => props.model?.excluded || { nonBrand: 0, crossUnit: 0 })
const measure = computed(() => props.model?.measure || 'amount')
const hasAny = computed(() => !!props.model?.hasAny)
const emptyMonths = computed(() => months.value.some(m => m.salesTarget > 0 && !m.salesAchv))
/** v160：有返利目标（灰轨道＝预估应返）却还没录实际返利的月份 —— 与未填销量达成分开算，合并成一句提示 */
const emptyRebateMonths = computed(() => months.value.some(m => m.rebateTarget > 0 && !m.actualRebate))

const curKey = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})
/** 当前月的月槽下标；-1 ＝ 所选年份不含本月（此时全图不判红绿、不画时间进度线） */
const paceIdx = computed(() => months.value.findIndex(m => m.key === curKey.value))
/** 本月时间进度：与 KPI 卡（Rebate.vue timeProgress）同一口径 —— 已过天数 ÷ 当月天数 */
const timeProgress = computed(() => {
  if (paceIdx.value < 0) return null
  const d = new Date()
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return Math.min(1, d.getDate() / days)
})

// v154 E4：三条并列脚注合并为一句（同一件事＝本图的统计范围），且仅在确有内容时出现
const ftText = computed(() => {
  const parts = []
  // v160：销量达成与实际返利是两件各自可缺的事，合成一句时按缺哪样动态列名
  const miss = []
  if (emptyMonths.value) miss.push('销量达成')
  if (emptyRebateMonths.value) miss.push('实际返利')
  if (miss.length) parts.push(`灰色月份尚未填报${miss.join(' / ')}`)
  const ex = []
  if (excluded.value.nonBrand) ex.push(`${excluded.value.nonBrand} 条非品牌维度`)
  if (excluded.value.crossUnit) ex.push(`${excluded.value.crossUnit} 条${measure.value === 'amount' ? '数量' : '金额'}口径`)
  if (ex.length) parts.push(`本图仅计品牌维度，另有 ${ex.join('、')}目标未计入`)
  return parts.join('；')
})
const emptyText = computed(() => {
  if (!props.model) return '暂无数据'
  if (excluded.value.nonBrand && !months.value.some(m => m.salesTarget > 0)) {
    return `${props.year} 年暂无品牌维度目标`
  }
  return `${props.year} 年还没有品牌目标或达成数据`
})

// ── v161 量程：柱高 ∝ 金额 ─────────────────────────────────────────────────────
// 改造前：纵轴＝达成率，灰轨道恒为 100% → 每月柱子一样高，"无法体现数值差异"。
// 改造后：纵轴＝金额，柱高 = 该柱金额 ÷ 该系列量程 × 绘图区高，严格等比。
//   · 销量柱读左轴（万元 / 件），返利柱读右轴（元）—— 两者量级通常差 1~2 个数量级，
//     且切「按数量」口径时销量是"件"、返利是"元"，物理上无法共用一条轴。
//   · 量程 = 全年 max(目标, 达成) 向上取整到好看刻度（niceMax），刻度均分 5 段。
//   · 达成率不再决定柱高，改由「柱顶标签 / tooltip 里的百分比」与
//     「彩色填充 vs 灰轨道 的相对高矮」承载 —— 柱顶没到轨道顶＝未达标。
const plotBase = PAD.t + plotH

const salesMax = computed(() => {
  let mx = 0
  for (const m of months.value) mx = Math.max(mx, Number(m.salesTarget) || 0, Number(m.salesAchv) || 0)
  return mx > 0 ? niceMax(mx) : 0
})
const rebateMax = computed(() => {
  let mx = 0
  for (const m of months.value) mx = Math.max(mx, Number(m.rebateTarget) || 0, Number(m.actualRebate) || 0)
  return mx > 0 ? niceMax(mx) : 0
})

/** 柱顶竖排标签的最低锚点 y —— 标签从锚点向上排约 60px（"1235万·129%" 量级），
 *  柱高改成金额后柱子可能顶到量程上限（yTop = PAD.t = 34），不兜底会把标签顶出画布 */
const LBL_TOP = 64

/** 金额 → 像素高度（等比；min 截断只是防御，量程本就涵盖全部数值） */
function hAmt(v, max) {
  const m = Number(max) || 0
  if (m <= 0) return 0
  return (Math.min(Math.max(0, Number(v) || 0), m) / m) * plotH
}
/** 金额 → y 坐标 */
function yAmt(v, max) { return plotBase - hAmt(v, max) }

function xGroup(i) { return PAD.l + i * GW.value }
function xBar(i, bi) { return xGroup(i) + GAP.value + bi * (BW.value + GAP.value) }

/** 轴刻度：量程均分 5 段 —— niceMax 的基数 k∈{1,1.5,2,3,5,7.5,10}，除 5 后仍是整洁数值 */
function axisTicks(max) {
  if (!(max > 0)) return []
  return [0, 1, 2, 3, 4, 5].map(i => {
    const v = (max * i) / 5
    return { v, y: yAmt(v, max) }
  })
}
const gridSales = computed(() => axisTicks(salesMax.value))
const gridRebate = computed(() => axisTicks(rebateMax.value))
/** 网格线只按主系列（销量）刻度画；销量整年无数据时退回返利刻度，避免只剩一张空网格 */
const gridLines = computed(() => (gridSales.value.length ? gridSales.value : gridRebate.value))

const salesUnit = computed(() => {
  if (!(salesMax.value > 0)) return ''
  if (measure.value === 'quantity') return salesMax.value >= 10000 ? '万件' : '件'
  return salesMax.value >= 100000 ? '万元' : '元'
})
const rebateUnit = computed(() => (rebateMax.value > 0 && rebateMax.value >= 100000 ? '万元' : '元'))

/** 轴刻度数字：按该轴单位换算（万 → 最多 2 位小数并去尾零；元 / 件 → 千分位整数） */
function axNum(v, unit) {
  const n = Number(v) || 0
  if (!n) return '0'
  if (unit === '万元' || unit === '万件') {
    const x = n / 10000
    return String(Math.abs(x) >= 100 ? Math.round(x) : Number(x.toFixed(2)))
  }
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

/**
 * 合并柱：一根柱同时承载「参照值」（灰轨道）与「实际值」（彩色填充）
 *   销量柱：轨道＝月度目标，填充＝销量达成
 *   返利柱：轨道＝预估应返（按 100% 目标档试算），填充＝**实际返利**（达成填报录入）
 * @returns {Array} [销量柱, 返利柱]
 */
function barsOf(mo) {
  return [
    mkBar(mo, 'sales', mo.salesTarget, mo.salesAchv, C.sales),
    mkBar(mo, 'rebate', mo.rebateTarget, mo.actualRebate, C.rebate),
  ]
}
function mkBar(mo, kind, target, achv, base) {
  const max = (kind === 'rebate' ? rebateMax.value : salesMax.value)
  const hasTarget = Number(target) > 0
  const hasAchv = Number(achv) > 0
  const rRaw = rate(achv, target)        // target ≤ 0 → null（没有目标就无所谓达成率）
  const noTarget = rRaw == null
  const isCur = paceIdx.value >= 0 && mo.key === curKey.value
  const ahead = isCur && !noTarget && timeProgress.value != null && rRaw >= timeProgress.value

  let fill, deep, lbl
  if (noTarget) {
    // 无目标但有手工录入的达成 → 中性灰、不判红绿（无从比较超前落后）
    fill = C.neutral.fill; deep = C.neutral.deep; lbl = C.neutral.lbl
  } else if (isCur) {
    const c = ahead ? C.ahead : C.behind
    fill = c.fill; deep = c.deep; lbl = c.lbl
  } else {
    fill = base.fill; deep = base.deep; lbl = base.lbl
  }

  // v161 几何：整根彩色柱高 ∝ 达成金额（在该系列量程内等比）；
  //   0 → 目标 为常规色段，目标 → 达成 为深色超额段。
  //   无目标但有达成 → 整根都算填充（中性灰），不再"硬画到 100% 位"。
  const hTotal = hAmt(achv, max)
  const trackH = hAmt(target, max)
  const fillH = hasTarget ? Math.min(hTotal, trackH) : hTotal
  const deepH = Math.max(0, hTotal - fillH)
  return {
    kind, r: rRaw, noTarget, target, achv, max, fill, deep, lbl,
    show: hasTarget || hasAchv,
    trackH, fillH, deepH,
    yTrack: plotBase - trackH,          // 轨道顶 ＝ 目标金额的高度
    yFill: plotBase - fillH,            // 填充段顶
    yDeep: plotBase - fillH - deepH,    // 超额段顶
    yTop: plotBase - hTotal,            // 柱顶 ＝ 达成金额的高度
    // 标签锚点：正常贴在柱顶上方 4px；柱子过高（顶到量程上限）时下压到 LBL_TOP，保证不被画布裁掉
    yLbl: Math.max(plotBase - hTotal - 4, LBL_TOP),
  }
}

/** 当前月两根柱的几何 —— 时间进度线要按各自量程换算 y */
const paceBars = computed(() => {
  const mo = paceIdx.value >= 0 ? months.value[paceIdx.value] : null
  return mo ? barsOf(mo) : []
})

// 柱顶标签文本：金额 + 达成率双段（金额回答"多少"，百分比回答"超没超"）
function amtLabel(v, kind) {
  const n = Number(v) || 0
  if (kind === 'sales' && measure.value === 'quantity') {
    return n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(Math.round(n))
  }
  const d = n / 10000 // 万元
  if (!d) return '0'
  const s = d >= 100 ? String(Math.round(d)) : d.toFixed(1)
  return s.replace(/\.0$/, '') + '万'
}
function barLabelOf(b) {
  const amt = amtLabel(b.achv, b.kind)
  if (b.noTarget) return amt
  return amt + '·' + Math.round(b.r * 100) + '%'
}

function money(v) {
  const n = Number(v) || 0
  if (measure.value === 'quantity') return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + '万'
  return '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
/** v160：金额（元）专用格式化 —— 实际返利 / 预估应返恒为元，不能跟着图表的 amount/quantity
 *  量纲开关走（否则切到「按数量」时返利会丢掉 ¥ 号，被读成件数）。 */
function yuan(v) {
  const n = Number(v) || 0
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + '万'
  return '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function qty(v) {
  const n = Number(v) || 0
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' 件'
}
function pct(v) {
  if (v == null) return '—'
  return (v * 100).toFixed(1) + '%'
}

function onHover(mo, i) {
  const [s, rb] = barsOf(mo)
  const rows = [
    { k: '销量目标', v: measure.value === 'quantity' ? qty(mo.salesTarget) : money(mo.salesTarget), r: '' },
    { k: '销量达成', v: measure.value === 'quantity' ? qty(mo.salesAchv) : money(mo.salesAchv), r: pct(s.noTarget ? null : s.r), warn: !s.noTarget && s.r < 1 },
    { k: '返利预估', v: yuan(mo.rebateTarget), r: '' },
    { k: '实际返利', v: yuan(mo.actualRebate), r: pct(rb.noTarget ? null : rb.r), warn: !rb.noTarget && rb.r < 1 },
  ]
  const extra = []
  if (paceIdx.value === i && timeProgress.value != null) {
    extra.push({ k: '时间进度', v: pct(timeProgress.value) })
  }
  if (props.singleBrand) {
    extra.push({ k: '距目标差额', v: measure.value === 'quantity' ? qty(Math.max(0, mo.salesTarget - mo.salesAchv)) : money(Math.max(0, mo.salesTarget - mo.salesAchv)) })
    // v160：原「影响返利」是「按目标档应返 − 按达成档应返」，两档都来自推算；现在减数换成了
    //   人工录入的实际返利，语义变成「还差多少返利没拿到」→ 标签同步改为「返利缺口」，否则会误导。
    extra.push({ k: '返利缺口', v: yuan(Math.max(0, mo.rebateTarget - mo.actualRebate)) })
  }
  const px = ((xGroup(i) + GW.value / 2) / W.value) * 100
  tip.value = {
    title: `${props.year} 年 ${mo.m} 月`,
    rows,
    extra,
    x: ((xGroup(i) + GW.value / 2) / W.value) * 100 + '%',
    flip: px > 55,
  }
}
</script>

<style scoped>
.mac { display: flex; flex-direction: column; gap: 10px; width: 100%; min-width: 0; }
.mac-hd { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mac-ti { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.mac-ti b { font-size: 14px; font-weight: 500; color: var(--t1); }
.mac-sub { font-size: 12px; color: var(--t3); }
.mac-seg { display: inline-flex; border: 1px solid var(--bd); border-radius: 8px; overflow: hidden; }
.seg-btn { padding: 4px 12px; font-size: 12px; background: transparent; border: 0; cursor: pointer; color: var(--t2); }
.seg-btn + .seg-btn { border-left: 1px solid var(--bd); }
.seg-btn.on { background: var(--p); color: #fff; }

.mac-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sel-year { height: 26px; padding: 0 6px; font-size: 12px; width: auto; }
/* v154 P2-A：品牌筛选控件（原 .ctl-pop / .bp-* 一套）与作用域徽标（.mac-scope）已随控件上移至页面级
   （`BrandFilter.vue`，与「统计月份」并排）→ 这里的相关样式整体移除，不留死 CSS */

.mac-legend { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.lg-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--t2); }
.lg-item i { width: 10px; height: 10px; border-radius: 2px; border: 1px solid transparent; display: inline-block; }
.lg-gap { margin-left: 2px; }
/* 灰轨道示意：上半深灰（达成位）＋下半浅灰（未达位）—— 与柱体两段结构同形 */
.lg-track { background: linear-gradient(180deg, #cbd5e1 0%, #cbd5e1 45%, #e2e8f0 45%, #e2e8f0 100%); }
.lg-line { width: 12px !important; height: 0 !important; border: 0 !important; border-top: 1px dashed #d97706 !important; border-radius: 0 !important; }
.lg-deep { background: linear-gradient(180deg, #0e7490 0%, #0e7490 50%, #06b6d4 50%, #06b6d4 100%); }

.mac-body { height: 240px; }
.mac-skel { display: flex; align-items: flex-end; gap: 6px; padding: 10px 0; }
.sk-col { flex: 1; display: flex; align-items: flex-end; gap: 2px; height: 100%; }
.sk-col span { flex: 1; background: var(--border-subtle, #e2e8f0); border-radius: 2px; animation: macpulse 1.2s ease-in-out infinite; }
@keyframes macpulse { 0%, 100% { opacity: .45; } 50% { opacity: .9; } }
.mac-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--t3); font-size: 13px; }

.mac-scroll { position: relative; width: 100%; min-width: 0; overflow-x: auto; overflow-y: hidden; }
/* 画布层：宽度＝容器可用宽度，viewBox 与其 1:1 对应；窄屏时锁 600px 由外层横向滚动兜底 */
.mac-canvas { position: relative; width: 100%; min-width: 600px; }
.mac-svg { width: 100%; height: 300px; display: block; }
.grid { stroke: var(--border-subtle, #e2e8f0); stroke-width: 1; stroke-dasharray: 3 3; }
/* v161 右轴刻度短线：返利量程与销量量程不同，网格线只按左轴画，右轴另标 4px 短线 */
.ax-tick { stroke: var(--border-subtle, #e2e8f0); stroke-width: 1; }
.axis { stroke: var(--bd); stroke-width: 1; }
.ax-lb { font-size: 11px; fill: var(--t3); }
/* v161 双轴：轴刻度与轴名用「对应的柱色」上色 —— 一眼知道哪根柱读哪根轴 */
.ax-sales { fill: #0e7490; }
.ax-rebate { fill: #b45309; }
.ax-unit { font-size: 10px; opacity: .85; }
.ax-mo { font-size: 11px; fill: var(--t3); }
/* v159 柱两段：轨道（目标）+ 填充（达成）+ 超额加深段。
   两处文字均加白色描边（paint-order）—— 柱顶标签可能压到相邻更高的柱、时间进度线文字会横跨当月柱身，
   无描边则与柱色混在一起读不出来 */
.track { fill: var(--border-subtle, #e2e8f0); }
.bar-lb { font-size: 8.5px; font-variant-numeric: tabular-nums; pointer-events: none; paint-order: stroke; stroke: #fff; stroke-width: 2px; stroke-linejoin: round; }
.pace-line { stroke: #d97706; stroke-width: 1; stroke-dasharray: 4 3; pointer-events: none; }
.cur-dot { fill: var(--p); }

.mac-tip {
  position: absolute; top: 8px; transform: translateX(8px);
  min-width: 210px; padding: 10px 12px; border-radius: 8px; pointer-events: none;
  background: var(--bg); border: 1px solid var(--bd);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .12); font-size: 12px; z-index: 5;
}
.mac-tip.to-left { transform: translateX(calc(-100% - 8px)); }
.mac-tip b { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 500; color: var(--t1); }
.tp-row { display: flex; align-items: center; gap: 8px; line-height: 1.9; }
.tp-k { width: 56px; color: var(--t3); flex: none; }
.tp-v { color: var(--t1); font-variant-numeric: tabular-nums; }
.tp-r { margin-left: auto; color: var(--t2); font-variant-numeric: tabular-nums; }
.tp-r.warn { color: #dc2626; }
.tp-ex { display: flex; gap: 8px; line-height: 1.9; border-top: 1px solid var(--border-subtle, #e2e8f0); margin-top: 4px; padding-top: 4px; }
.tp-ex .tp-v { color: var(--t2); }

.mac-ft { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--t3); }
</style>
