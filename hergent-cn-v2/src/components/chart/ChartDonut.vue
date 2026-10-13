<template>
  <ChartFigure
    :title="title" :sub="sub" :loading="loading" :error="error"
    :empty="empty || (!loading && !error && arcs.length === 0)"
    :empty-text="emptyText" :height="height" :note="note"
    :export-name="exportName || title" :show-export="showExport"
    @retry="emit('retry')"
  >
    <template #ctl><slot name="ctl" /></template>

    <div ref="rootEl" class="ch-scroll">
      <div class="ch-canvas" :style="{ minWidth: minWidth + 'px' }">
        <div class="ch-donut-wrap">
          <svg
            ref="svgEl" class="ch-svg ch-donut-svg" :viewBox="`0 0 ${W} ${H}`"
            :style="{ height: H + 'px', width: W + 'px' }" preserveAspectRatio="none"
            role="img" :aria-label="ariaLabel" @mouseleave="hide()"
          >
            <!-- 底环：数据为空时也有一圈灰底，避免"什么都没有"看着像加载失败 -->
            <circle
              v-if="mode === 'donut'" :cx="cx" :cy="cy" :r="rMid" fill="none"
              stroke="var(--border-subtle)" :stroke-width="thickness"
            />
            <!-- 各分段。用「描边等宽弧」而不是扇形 path：段与段之间天然有 1px 缝隙，
                 且不必为每段算内外两条弧（少一半几何） -->
            <circle
              v-for="a in arcs" :key="a.label" class="ch-arc"
              :cx="cx" :cy="cy" :r="rMid" fill="none"
              :stroke="a.color" :stroke-width="hoverIdx === a.i ? thickness + 3 : thickness"
              :stroke-dasharray="`${a.len} ${circ - a.len}`"
              :stroke-dashoffset="-a.off"
              :transform="`rotate(-90 ${cx} ${cy})`"
              @mouseenter="onHover(a.i)" @mousemove="onHover(a.i)"
            />
            <!-- 中心汇总 -->
            <text class="ch-dn-center-k" :x="cx" :y="cy - 6" text-anchor="middle">{{ centerLabel }}</text>
            <text class="ch-dn-center-v" :x="cx" :y="cy + 14" text-anchor="middle">{{ centerText }}</text>
          </svg>

          <!-- 图例即明细：名称 + 数值 + 占比（三件读者真正想并排看的东西） -->
          <div class="ch-donut-lg">
            <div
              v-for="a in arcs" :key="'lg' + a.label" class="ch-donut-row"
              :class="{ 'is-hit': true }" @mouseenter="onHover(a.i)" @mouseleave="hide()"
            >
              <i class="ch-lg-dot" :style="{ background: a.color }"></i>
              <span class="ch-dn-name" :title="a.label">{{ a.label }}</span>
              <span class="ch-dn-val">{{ fmtVal(a.value) }}</span>
              <span class="ch-dn-pct">{{ pct(a.pct) }}</span>
            </div>
          </div>
        </div>

        <div
          v-if="tipState" ref="tipEl" class="ch-tip" :class="{ 'to-left': tipState.flip }"
          :style="{ left: tipState.x, top: tipState.top }"
        >
          <b>{{ tipState.title }}</b>
          <div class="ch-tp-row" v-for="r in tipState.rows" :key="r.k">
            <i v-if="r.color && r.color !== 'transparent'" class="ch-lg-dot" :style="{ background: r.color, width: '8px', height: '8px' }"></i>
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
   ChartDonut.vue —— 环形 / 饼图（v491）
   ============================================================================
   场景：**有占比结构**的数据（品牌毛利结构、品类占比、应收账龄分布）。
   单值指标不要用它 —— 一个大数字卡片比一个满环清楚得多。

   🔴 两条纪律：
     ① **必须显示"其他"档**：分类多于 `maxSlices`（默认 6）时，把尾部合并成"其他"，
        不是悄悄不画。少画一块而百分比加起来不到 100，是最容易被当成"算错了"的画面。
     ② 合计为 0 时**不画空环**：走空态。一圈灰环会让人以为"有数据、只是都很小"。

   画法是"等宽描边弧"（stroke-dasharray 分段），不是扇形 path —— 少一半几何、天然有缝。
   ============================================================================ */
import { computed, inject, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import ChartFigure from './ChartFigure.vue'
import { seriesColor, OTHER_TOKEN } from './chartTheme'
import { money, qty, int, pct as fmtPct, compact } from './chartFmt'
import { useChartTip } from './useChartTip'

const props = defineProps({
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: '还没有可分析的结构数据' },
  note: { type: String, default: '' },
  exportName: { type: String, default: '' },
  showExport: { type: Boolean, default: true },
  /** [{ label, value, color? }] */
  items: { type: Array, default: () => [] },
  /** donut=环（默认，中心可放汇总） / pie=实心饼 */
  mode: { type: String, default: 'donut' },
  height: { type: Number, default: 240 },
  fmt: { type: String, default: 'money' },
  /** 最多画几块，其余合并成"其他" */
  maxSlices: { type: Number, default: 6 },
  centerLabel: { type: String, default: '合计' },
  minWidth: { type: Number, default: 420 },
})
const emit = defineEmits(['retry'])

const H = computed(() => props.height)
const W = ref(240)
const rootEl = ref(null)
const svgEl = ref(null)

function measureW() {
  const el = rootEl.value
  if (!el) return
  // 环图占左侧正方形区，宽度取容器宽与高度中较小者的 45%，避免小屏把图例挤没
  const avail = Math.round(el.clientWidth || 0)
  const w = Math.max(160, Math.min(avail * 0.42, H.value + 40))
  W.value = Math.round(w)
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

/** 分块：正数、降序、尾部合并成"其他" */
const slices = computed(() => {
  const raw = (props.items || [])
    .map((it) => ({ label: String(it.label == null ? '' : it.label), value: Number(it.value) || 0, color: it.color }))
    .filter((it) => it.value > 0)
    .sort((a, b) => b.value - a.value)
  if (raw.length <= props.maxSlices) return raw.map((it, i) => ({ ...it, color: it.color || seriesColor(i) }))
  const head = raw.slice(0, props.maxSlices - 1).map((it, i) => ({ ...it, color: it.color || seriesColor(i) }))
  const tail = raw.slice(props.maxSlices - 1)
  head.push({ label: `其他 ${tail.length} 项`, value: tail.reduce((s, it) => s + it.value, 0), color: OTHER_TOKEN })
  return head
})
const total = computed(() => slices.value.reduce((s, it) => s + it.value, 0))

/** 环宽：饼图取到圆心（＝实心饼），环形取一个视觉舒适的固定带 */
const thickness = computed(() => {
  const o = Math.max(10, Math.min(W.value, H.value) / 2 - 4)
  if (props.mode === 'pie') return o
  return Math.max(14, Math.min(30, o * 0.34))
})
const cx = computed(() => Math.round(W.value / 2))
const cy = computed(() => Math.round(H.value / 2))
const outer = computed(() => Math.min(W.value, H.value) / 2 - 4)
const rMid = computed(() => Math.max(6, outer.value - thickness.value / 2))
const circ = computed(() => 2 * Math.PI * rMid.value)

/** 每段的弧长与起点偏移（gap 用 1px 缝隙表达：段落之间不粘连） */
const GAP_PX = 2
const arcs = computed(() => {
  if (total.value <= 0) return []
  let acc = 0
  return slices.value.map((it, i) => {
    const full = (it.value / total.value) * circ.value
    const len = Math.max(1, full - GAP_PX)
    const off = acc
    acc += full
    return { ...it, i, pct: it.value / total.value, len: Math.round(len * 100) / 100, off: Math.round(off * 100) / 100, color: it.color }
  })
})

const centerText = computed(() => (props.fmt === 'money' ? '¥' + compact(total.value) : props.fmt === 'qty' ? compact(total.value) : compact(total.value)))

function fmtVal(v) {
  if (v === null || v === undefined || !isFinite(Number(v))) return '—'
  if (props.fmt === 'money') return money(v)
  if (props.fmt === 'qty') return qty(v)
  return int(v)
}
function pct(r) { return fmtPct(r) }

/* —— 悬停：放大该段 + 给 tooltip —— */
const hoverIdx = ref(null)
const { tip: tipState, tipEl, show, hide } = useChartTip(() => ({ canvasW: W.value * 2, canvasH: H.value }))

function onHover(i) {
  hoverIdx.value = i
  const a = arcs.value[i]
  if (!a) return
  show({
    key: 'a' + i,
    title: a.label,
    rows: [
      { k: '金额', v: fmtVal(a.value), color: a.color },
      { k: '占比', v: fmtPct(a.pct), color: 'transparent' },
      { k: '合计', v: fmtVal(total.value), color: 'transparent' },
    ],
    anchorX: W.value + 8,
    halfW: 0,
    top: 6,
  })
}

const ariaLabel = computed(() => `占比图：${slices.value.map((s) => s.label).join('、')}`)

const fig = inject('chFigure', null)
watchEffect(() => { if (fig) fig.setSvg(svgEl.value) })
</script>
