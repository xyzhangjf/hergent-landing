<template>
  <ChartFigure
    :title="title" :sub="sub" :loading="loading" :error="error"
    :empty="empty || (!loading && !error && !rows.length)"
    :empty-text="emptyText" :height="autoH" :note="note"
    :export-name="exportName || title" :show-export="showExport"
    @retry="emit('retry')"
  >
    <template #ctl><slot name="ctl" /></template>

    <div ref="rootEl" class="ch-scroll">
      <div class="ch-canvas" :style="{ minWidth: minWidth + 'px' }">
        <svg
          ref="svgEl" class="ch-svg" :viewBox="`0 0 ${W} ${autoH}`" :style="{ height: autoH + 'px' }"
          preserveAspectRatio="none" role="img" :aria-label="ariaLabel" @mouseleave="hide()"
        >
          <template v-for="r in rows" :key="r.label + r.i">
            <!-- 档位名（左侧，超长截断 —— 排行里"谁"比"全称"重要，截断加点号不换行） -->
            <text class="ch-hb-name" :x="PAD.l - 10" :y="r.y + rowH / 2 + 4" text-anchor="end">{{ r.name }}</text>

            <!-- 轨道（灰底）：让"最长那条"与"容器"的关系可读，而不是悬空一根条 -->
            <rect class="ch-hb-track" :x="PAD.l" :y="r.y + 6" :width="barW" :height="rowH - 12" rx="3" />

            <!-- 条本体 -->
            <rect
              class="ch-hb-bar" :x="PAD.l" :y="r.y + 6" :width="r.w" :height="rowH - 12" rx="3"
              :fill="r.color"
            />

            <!-- 数值：贴在条端外侧，条短也不会被压住（条端 + 6px，且不小于轨道起点 + 6） -->
            <text class="ch-hb-val" :x="Math.min(PAD.l + r.w + 6, PAD.l + barW + 6)" :y="r.y + rowH / 2 + 4">{{ fmtVal(r.value) }}</text>

            <!-- 悬停热区：整行 -->
            <rect class="ch-hit" :x="0" :y="r.y" :width="W" :height="rowH"
                  @mouseenter="onHover(r)" @mousemove="onHover(r)" />
          </template>
        </svg>

        <div
          v-if="tipState" ref="tipEl" class="ch-tip" :class="{ 'to-left': tipState.flip }"
          :style="{ left: tipState.x, top: tipState.top }"
        >
          <b>{{ tipState.title }}</b>
          <div class="ch-tp-row" v-for="r in tipState.rows" :key="r.k">
            <span class="ch-tp-k" style="flex:none">{{ r.k }}</span>
            <span class="ch-tp-v">{{ r.v }}</span>
          </div>
        </div>
      </div>
    </div>
  </ChartFigure>
</template>

<script setup>
/* ============================================================================
   ChartHbar.vue —— 横向排行条（v491）
   ============================================================================
   场景：**类别名很长 + 要排名**的数据（TopN 客户 / 商品 / 业务员）。
   这类数据用竖向柱状图是灾难：中文类目名横过来会叠成一堵字墙（MonthlyAchvChart
   那轮为此专门把竖排标签改成横排两行）。横过来放，"谁"和"多少"一眼并排。

   🔴 高度随行数走（不是固定高）：排行 5 项和 20 项不该挤在同一个框里。
   🔴 轨道的长度归一：最长那条占满可用宽 —— 排行是**相对**关系，不用绝对刻度（绝对值由数字给）。
   ============================================================================ */
import { computed, inject, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import ChartFigure from './ChartFigure.vue'
import { seriesColor } from './chartTheme'
import { money, qty, int, pct } from './chartFmt'
import { useChartTip } from './useChartTip'

const props = defineProps({
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: '这段时间还没有可排行的数据' },
  note: { type: String, default: '' },
  exportName: { type: String, default: '' },
  showExport: { type: Boolean, default: true },
  /** [{ label, value, color?, nameWidth? }] */
  items: { type: Array, default: () => [] },
  rowH: { type: Number, default: 30 },
  fmt: { type: String, default: 'money' },
  /** 名称列宽（px）。中文按 11px/字 估算可容纳字数，超出截断加点号 */
  nameW: { type: Number, default: 116 },
  /** 是否按序号上色（默认全部同色，用深浅表达排名更克制） */
  rainbow: { type: Boolean, default: false },
  /** 占比分母（如需要显示"占总额 x%"）；不传只显示数值 */
  total: { type: Number, default: 0 },
  minWidth: { type: Number, default: 420 },
})
const emit = defineEmits(['retry'])

const PAD = { l: 8, r: 8, t: 6, b: 6 }
const rootEl = ref(null)
const svgEl = ref(null)
const W = ref(520)
function measureW() {
  const el = rootEl.value
  if (!el) return
  const w = Math.round(el.clientWidth || 0)
  if (w > 0) W.value = Math.max(props.minWidth, w)
}
let ro = null
onMounted(() => {
  measureW()
  if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
    ro = new ResizeObserver(measureW)
    ro.observe(rootEl.value)
  } else window.addEventListener('resize', measureW)
})
onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  window.removeEventListener('resize', measureW)
})

const list = computed(() => props.items || [])
/** 名称区固定宽；数值区留给"¥123.4万"这类最长的串（约 64px） */
const barW = computed(() => Math.max(40, W.value - PAD.l - props.nameW - 72))
const autoH = computed(() => PAD.t + Math.max(1, list.value.length) * props.rowH + PAD.b)

/** CJK 按 11px/字、ASCII 按 6px/字 估宽，超出截断加点号（SVG 里没有 text-overflow） */
function clip(s, px) {
  const t = String(s == null ? '' : s)
  let w = 0
  let out = ''
  for (const ch of t) {
    const cw = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 11 : 6
    if (w + cw > px) return out + '…'
    w += cw
    out += ch
  }
  return out
}

const rows = computed(() => {
  const arr = list.value
  const max = arr.reduce((m, it) => Math.max(m, Math.abs(Number(it.value) || 0)), 0)
  return arr.map((it, i) => {
    const v = Number(it.value) || 0
    const w = max > 0 ? Math.max(2, (Math.abs(v) / max) * barW.value) : 0
    return {
      i,
      label: String(it.label == null ? '' : it.label),
      name: clip(it.label, props.nameW - 6),
      value: v,
      w: Math.round(w * 100) / 100,
      y: PAD.t + i * props.rowH,
      color: it.color || (props.rainbow ? seriesColor(i) : seriesColor(0)),
    }
  })
})

function fmtVal(v) {
  if (v === null || v === undefined || !isFinite(Number(v))) return '—'
  if (props.fmt === 'money') return money(v)
  if (props.fmt === 'qty') return qty(v)
  return int(v)
}

const { tip: tipState, tipEl, show, hide } = useChartTip(() => ({ canvasW: W.value, canvasH: autoH.value }))

function onHover(r) {
  const rowsTip = [{ k: '数值', v: fmtVal(r.value) }]
  if (props.total > 0) rowsTip.push({ k: '占合计', v: pct(Math.abs(r.value) / props.total) })
  rowsTip.push({ k: '排名', v: `第 ${r.i + 1} 位` })
  show({
    key: 'r' + r.i,
    title: r.label,
    rows: rowsTip,
    anchorX: Math.round(PAD.l + r.w),
    halfW: 0,
    top: r.y,
  })
}

const ariaLabel = computed(() => `排行图：${rows.value.map((r) => r.label).join('、')}`)

const fig = inject('chFigure', null)
watchEffect(() => { if (fig) fig.setSvg(svgEl.value) })
</script>
