<template>
  <ChartFigure
    :title="title" :sub="sub" :loading="loading" :error="error" :empty="empty"
    :empty-text="emptyText" :height="height" :note="note"
    :export-name="exportName || title" :show-export="showExport"
    @retry="emit('retry')"
  >
    <!-- 操作区插槽透传：调用方可以往标题行右侧塞自己的控件（区间切换等），
         而不必在外层再包一层自己排版的头 -->
    <template #ctl><slot name="ctl" /></template>

    <template #legend>
      <div v-if="series.length > 1" class="ch-legend">
        <span
          v-for="s in series" :key="s.name" class="ch-lg-item is-hit"
          :class="{ 'is-off': !!off[s.name] }"
          title="点一下可以暂时隐藏这条线，再点恢复"
          @click="toggle(s.name)"
        >
          <i class="ch-lg-dot" :style="{ background: s.color }"></i>{{ s.name }}
        </span>
      </div>
    </template>

    <div ref="rootEl" class="ch-scroll">
      <div class="ch-canvas" :style="{ minWidth: minWidth + 'px' }">
        <svg
          ref="svgEl" class="ch-svg" :viewBox="`0 0 ${W} ${H}`" :style="{ height: H + 'px' }"
          preserveAspectRatio="none" role="img" :aria-label="ariaLabel"
          @mouseleave="hide()"
        >
          <!-- 网格 + 纵轴刻度 -->
          <line
            v-for="t in ticks" :key="'g' + t.v" class="ch-grid"
            :x1="PAD.l" :x2="W - PAD.r" :y1="t.y" :y2="t.y"
          />
          <text
            v-for="t in ticks" :key="'yl' + t.v" class="ch-ax-lb"
            :x="PAD.l - 8" :y="t.y + 4" text-anchor="end"
          >{{ axText(t.v) }}</text>

          <!-- 纵轴单位：只在轴顶写一次；刻度数字只留数字（两处都写单位＝冗余） -->
          <text v-if="axUnitLabel" class="ch-ax-ti" :x="PAD.l - 8" :y="PAD.t - 9" text-anchor="end">{{ axUnitLabel }}</text>

          <!-- 参考线（如"时间进度应完成"）：虚线 + 右端标签 -->
          <template v-for="(r, ri) in refLines" :key="'r' + ri">
            <line
              v-if="refY(r.value) != null" class="ch-ref" :stroke="r.color || 'var(--war)'"
              :x1="PAD.l" :x2="W - PAD.r" :y1="refY(r.value)" :y2="refY(r.value)"
            />
            <text
              v-if="refY(r.value) != null && r.label" class="ch-ax-ti" :x="W - PAD.r" :y="refY(r.value) - 4" text-anchor="end"
            >{{ r.label }}</text>
          </template>

          <!-- 各系列：面积 → 线 → 数据点 →（可选）数值标注 -->
          <template v-for="(s, si) in visibleSeries" :key="'ser' + si">
            <path
              v-if="s.showArea" class="ch-area" :fill="s.color" opacity=".13"
              :d="areaD(s)"
            />
            <path
              class="ch-line" :stroke="s.color" :d="lineD(s)"
              :stroke-dasharray="s.dashed ? '5 3' : ''"
            />
            <circle
              v-for="p in dotsOf(s)" :key="'d' + p.i"
              class="ch-dot" :class="{ 'is-on': hoverIdx === p.i }"
              :cx="p.x" :cy="p.y" :r="hoverIdx === p.i ? 4 : 2.6"
              :fill="s.color" stroke="var(--bg)" stroke-width="1.5"
            />
            <text
              v-for="p in (s.showVals ? dotsOf(s) : [])" :key="'v' + p.i"
              class="ch-lbl" :x="p.x" :y="p.y - 8" text-anchor="middle" :fill="s.color"
            >{{ shortVal(p.v) }}</text>
          </template>

          <!-- 横轴标签：点多时按步长抽稀（避免叠字）；首尾必留 -->
          <text
            v-for="l in xLabels" :key="'x' + l.i" class="ch-ax-lb"
            :x="l.x" :y="H - PAD.b + 16" text-anchor="middle"
          >{{ l.t }}</text>

          <!-- 0 轴 -->
          <line class="ch-axis" :x1="PAD.l" :x2="W - PAD.r" :y1="baseY" :y2="baseY" />

          <!-- 悬停热区：每个索引一条通栏竖带（比给每个点画热区好点中得多） -->
          <rect
            v-for="(lb, i) in labels" :key="'h' + i" class="ch-hit"
            :x="bandX(i)" :y="PAD.t" :width="bandWAt(i)" :height="plotH"
            @mouseenter="onHover(i)" @mousemove="onHover(i)"
          />
        </svg>

        <div
          v-if="tipState" ref="tipEl" class="ch-tip" :class="{ 'to-left': tipState.flip }"
          :style="{ left: tipState.x, top: tipState.top }"
        >
          <b>{{ tipState.title }}</b>
          <div class="ch-tp-row" v-for="r in tipState.rows" :key="r.k">
            <i class="ch-lg-dot" :style="{ background: r.color, width: '8px', height: '8px' }"></i>
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
   ChartLine.vue —— 折线 / 面积图（v491）
   ============================================================================
   契约（四个图型共用）：
     labels: string[]                                 横轴标签（等距分布，不按真实时间刻度）
     series: [{ name, data:(number|null)[], color?, area?, dashed?, valueLabels? }]
   `null` = **该点没有数据** ⇒ 线在此断开，不画成 0。
   🔴 「0」与「没有数据」必须视觉可分：0 是贴着基线的一个点，没数据是一个**断口**。
      把它们画成同一个样子，正是本项目反复在修的那一族缺陷（空值被读成"生意为零"）。

   坐标是 1:1 的：viewBox 宽高 = 实测宽 × 指定高，`preserveAspectRatio="none"`
   只用于避免额外缩放（v124 的既有做法）⇒ 字号不被拉扁、左右不留白。

   本组件自带外壳（ChartFigure）⇒ 调用方只给数据，标题/图例/三态/导出图片一并拿到。
   ============================================================================ */
import { computed, inject, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import ChartFigure from './ChartFigure.vue'
import { seriesColor } from './chartTheme'
import { money, moneyUnit, axisNum, niceMax, niceMin, tickValues, compact, qty, int } from './chartFmt'
import { lineGeometry, smoothPath } from './chartGeom'
import { useChartTip } from './useChartTip'

const props = defineProps({
  // —— 外壳 ——
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: '这段时间还没有数据' },
  note: { type: String, default: '' },
  exportName: { type: String, default: '' },
  showExport: { type: Boolean, default: true },
  // —— 数据 ——
  labels: { type: Array, default: () => [] },
  series: { type: Array, default: () => [] },
  height: { type: Number, default: 240 },
  /** 数值口径：money=金额 / qty=数量 / plain=纯数字。只影响**显示**，不参与任何计算 */
  fmt: { type: String, default: 'money' },
  smooth: { type: Boolean, default: false },
  valueLabels: { type: Boolean, default: false },
  refLines: { type: Array, default: () => [] },
  zeroBase: { type: Boolean, default: true },
  minWidth: { type: Number, default: 560 },
})
const emit = defineEmits(['retry'])

const H = computed(() => props.height)
const PAD = { l: 56, r: 18, t: 26, b: 30 }

const rootEl = ref(null)
const svgEl = ref(null)
const W = ref(680)

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
  } else {
    window.addEventListener('resize', measureW)
  }
})
onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  window.removeEventListener('resize', measureW)
})

const labels = computed(() => props.labels || [])
const n = computed(() => labels.value.length)

const plotH = computed(() => Math.max(1, H.value - PAD.t - PAD.b))
const plotW = computed(() => Math.max(1, W.value - PAD.l - PAD.r))
const baseY = computed(() => PAD.t + plotH.value)

/* —— 量程：只对**真实存在的数值**取值，null 不参与
   （把 null 当 0 会把量程整体压扁，图看起来"很平"而原因在数据不在图） —— */
const nums = (arr) => (arr || []).filter((v) => v !== null && v !== undefined && isFinite(Number(v))).map(Number)
const dataMax = computed(() => {
  let m = 0
  for (const s of props.series || []) for (const v of nums(s.data)) m = Math.max(m, v)
  return m
})
const dataMin = computed(() => {
  let m = 0
  for (const s of props.series || []) for (const v of nums(s.data)) m = Math.min(m, v)
  return m
})
const yMax = computed(() => niceMax(dataMax.value))
const yMin = computed(() => (props.zeroBase || dataMin.value >= 0 ? 0 : niceMin(dataMin.value)))

/** 纵轴单位键（用于数字换算）与单位标签（写在轴顶） */
const axUnitKey = computed(() => {
  if (props.fmt === 'money') return moneyUnit(yMax.value)
  if (props.fmt === 'qty' && yMax.value >= 1e4) return '万'
  return ''
})
const axUnitLabel = computed(() => {
  if (props.fmt === 'money') return axUnitKey.value ? axUnitKey.value + '元' : '元'
  if (props.fmt === 'qty') return axUnitKey.value ? '万件' : '件'
  return ''
})

const series = computed(() =>
  (props.series || []).map((s, i) => ({
    ...s,
    color: s.color || seriesColor(i),
    // 面积只给"系列少"的时候：三条以上互相盖住，反而看不清
    showArea: s.area !== false && (props.series || []).length <= 2,
    showVals: props.valueLabels || s.valueLabels === true,
  })),
)

/* —— 图例点击显隐（L2）。全关掉时退回"全显"，避免点出一个空图还以为坏了 —— */
const off = ref({})
function toggle(name) {
  const next = { ...off.value }
  if (next[name]) delete next[name]
  else next[name] = true
  off.value = next
}
const visibleSeries = computed(() => {
  const list = series.value.filter((s) => !off.value[s.name])
  return list.length ? list : series.value
})

const scales = computed(() => lineGeometry({
  plotW: plotW.value, plotH: plotH.value, base: baseY.value, padL: PAD.l, padT: PAD.t, count: n.value,
}))

const ticks = computed(() =>
  tickValues(yMin.value, yMax.value, 4).map((v) => ({ v, y: scales.value.yAt(v, yMin.value, yMax.value) })))

function axText(v) {
  if (props.fmt === 'qty' && axUnitKey.value === '万') {
    const x = Number(v) / 1e4
    return String(Math.abs(x) >= 100 ? Math.round(x) : Number(x.toFixed(2)))
  }
  return axisNum(v, axUnitKey.value)
}

const xLabels = computed(() => {
  const N = n.value
  if (!N) return []
  const step = N <= 12 ? 1 : Math.ceil(N / 8)
  const out = []
  for (let i = 0; i < N; i++) {
    if (i % step !== 0 && i !== N - 1) continue
    out.push({ i, x: Math.round(scales.value.xAt(i)), t: labels.value[i] })
  }
  return out
})

/* —— 断点切段：null 处断开，而不是连成一条斜线（那会让读者以为中间有值）—— */
function segsOf(s) {
  const out = []
  let cur = []
  const d = s.data || []
  for (let i = 0; i < n.value; i++) {
    const v = d[i]
    if (v === null || v === undefined || !isFinite(Number(v))) {
      if (cur.length) out.push(cur)
      cur = []
      continue
    }
    cur.push({ i, x: scales.value.xAt(i), y: scales.value.yAt(Number(v), yMin.value, yMax.value), v: Number(v) })
  }
  if (cur.length) out.push(cur)
  return out
}
const r2 = (x) => Math.round(x * 100) / 100
function pathOf(seg) {
  if (!seg.length) return ''
  if (props.smooth && seg.length >= 3) return smoothPath(seg)
  return 'M ' + seg.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(' L ')
}
function lineD(s) { return segsOf(s).map(pathOf).join(' ') }
function areaD(s) {
  return segsOf(s).map((seg) => {
    if (seg.length < 2) return ''
    const a = r2(seg[0].x)
    const b = r2(seg[seg.length - 1].x)
    return `M ${a} ${r2(baseY.value)} L ` + seg.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(' L ') + ` L ${b} ${r2(baseY.value)} Z`
  }).join(' ')
}
function dotsOf(s) { return segsOf(s).flat() }

/* —— 悬停热区：竖带取相邻点中线为界（不重叠、不留缝）—— */
const stepX = computed(() => (n.value <= 1 ? plotW.value : plotW.value / (n.value - 1)))
function bandX(i) {
  const xc = scales.value.xAt(i)
  return r2(Math.max(PAD.l, xc - stepX.value / 2))
}
function bandWAt(i) {
  const xc = scales.value.xAt(i)
  const x0 = Math.max(PAD.l, xc - stepX.value / 2)
  const x1 = Math.min(W.value - PAD.r, xc + stepX.value / 2)
  return r2(Math.max(1, x1 - x0))
}

function refY(v) {
  const x = Number(v)
  if (!isFinite(x)) return null
  return r2(scales.value.yAt(x, yMin.value, yMax.value))
}

/** tooltip 数值：区分"没有数据"与"值为 0" */
function fmtVal(v) {
  if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return '—'
  if (props.fmt === 'money') return money(v)
  if (props.fmt === 'qty') return qty(v)
  return int(v)
}
function shortVal(v) {
  if (v === null || v === undefined || !isFinite(Number(v))) return ''
  return compact(v)
}

const hoverIdx = ref(null)
const { tip: tipState, tipEl, show, hide } = useChartTip(() => ({ canvasW: W.value, canvasH: H.value }))

function onHover(i) {
  hoverIdx.value = i
  const rows = visibleSeries.value.map((s) => ({
    k: s.name,
    v: fmtVal((s.data || [])[i]),
    color: s.color,
  }))
  show({
    key: 'i' + i,
    title: String(labels.value[i] == null ? '' : labels.value[i]),
    rows,
    anchorX: scales.value.xAt(i),
    halfW: 0,
  })
}
function clearHover() { hoverIdx.value = null; hide() }
defineExpose({ clearHover })

const ariaLabel = computed(() => `折线图：${series.value.map((s) => s.name).join('、')}`)

/* 把 <svg> 登记给外壳的「导出图片」按钮（不必一层层传 ref） */
const fig = inject('chFigure', null)
watchEffect(() => { if (fig) fig.setSvg(svgEl.value) })
</script>
