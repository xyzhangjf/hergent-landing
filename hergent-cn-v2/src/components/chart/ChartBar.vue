<template>
  <ChartFigure
    :title="title" :sub="sub" :loading="loading" :error="error" :empty="empty"
    :empty-text="emptyText" :height="height" :note="note"
    :export-name="exportName || title" :show-export="showExport"
    @retry="emit('retry')"
  >
    <template #ctl><slot name="ctl" /></template>

    <template #legend>
      <div v-if="legendItems.length" class="ch-legend">
        <span
          v-for="s in legendItems" :key="s.name" class="ch-lg-item"
          :class="{ 'is-hit': canToggle, 'is-off': !!off[s.name] }"
          :title="canToggle ? '点一下可以暂时隐藏这一组，再点恢复' : ''"
          @click="canToggle && toggle(s.name)"
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
          <text v-if="axUnitLabel" class="ch-ax-ti" :x="PAD.l - 8" :y="PAD.t - 9" text-anchor="end">{{ axUnitLabel }}</text>

          <!-- 参考线（如月均线 / 应完成进度） -->
          <template v-for="(r, ri) in refLines" :key="'r' + ri">
            <line
              v-if="refY(r.value) != null" class="ch-ref" :stroke="r.color || 'var(--war)'"
              :x1="PAD.l" :x2="W - PAD.r" :y1="refY(r.value)" :y2="refY(r.value)"
            />
            <text
              v-if="refY(r.value) != null && r.label" class="ch-ax-ti" :x="W - PAD.r" :y="refY(r.value) - 4" text-anchor="end"
            >{{ r.label }}</text>
          </template>

          <!-- 柱体 -->
          <template v-for="bar in bars" :key="'b' + bar.i">
            <!-- 参照轨道（目标位）：**明确灰**，且有值就至少 2px 高 ——
                 「只要录到了目标就始终看得见这根柱子」不是期望，是这里的下限保证（v186） -->
            <rect
              v-for="seg in bar.tracks" :key="'t' + seg.k"
              class="ch-bar" :x="seg.x" :y="seg.y" :width="seg.w" :height="seg.h"
              fill="var(--chart-track)"
            />
            <rect
              v-for="seg in bar.fills" :key="'f' + seg.k"
              class="ch-bar" :x="seg.x" :y="seg.y" :width="seg.w" :height="seg.h"
              :fill="seg.color"
            />
            <text
              v-for="seg in (showVals ? bar.labels : [])" :key="'l' + seg.k"
              class="ch-lbl" :x="seg.x" :y="seg.y" text-anchor="middle" :fill="seg.color"
            >{{ seg.t }}</text>
            <!-- 悬停热区：整槽通栏（比只盖柱身好点中得多） -->
            <rect
              class="ch-hit" :x="bar.hx" :y="PAD.t" :width="bar.hw" :height="plotH"
              @mouseenter="onHover(bar.i)" @mousemove="onHover(bar.i)"
            />
          </template>

          <!-- 横轴标签 -->
          <text
            v-for="(l, i) in labels" :key="'x' + i" class="ch-ax-lb"
            :x="Math.round(PAD.l + barLay.slot * (i + 0.5))" :y="H - PAD.b + 16" text-anchor="middle"
          >{{ l }}</text>

          <line class="ch-axis" :x1="PAD.l" :x2="W - PAD.r" :y1="baseY" :y2="baseY" />
        </svg>

        <div
          v-if="tipState" ref="tipEl" class="ch-tip" :class="{ 'to-left': tipState.flip }"
          :style="{ left: tipState.x, top: tipState.top }"
        >
          <b>{{ tipState.title }}</b>
          <div class="ch-tp-row" v-for="r in tipState.rows" :key="r.k">
            <i v-if="r.color && r.color !== 'transparent'" class="ch-lg-dot" :style="{ background: r.color, width: '8px', height: '8px' }"></i>
            <span class="ch-tp-k" style="flex:none">{{ r.k }}</span>
            <span class="ch-tp-v">{{ r.v }}</span>
            <span v-if="r.r" class="ch-tp-r" :class="{ warn: r.warn }">{{ r.r }}</span>
          </div>
        </div>
      </div>
    </div>
  </ChartFigure>
</template>

<script setup>
/* ============================================================================
   ChartBar.vue —— 柱状图（v491）
   ============================================================================
   四种形态共用一套几何与三态：
     · `single`                    单系列对比（品类毛利、日订单数…）
     · `target`                    目标位 + 达成填充（灰轨道＝目标，彩条＝达成，深色段＝超额）
                                   —— 与 `MonthlyAchvChart` 的柱体语义**同源**，两边都走 chartGeom
     · `grouped` / `stacked`       多系列（同比对比 / 多维拆解）

   契约与 ChartLine 一致：`labels` + `series[{name,data}]`；
   `target` 形态下 `series[0]` = 目标位（画成灰轨道）、`series[1]` = 实际值。

   🔴 柱状图 0 起（量程不从 0 起会**放大差异**，是数据可视化的硬规矩）；
      只有全为负（亏损）时才向下取整，并把 0 轴画出来。
   🔴 有值就必须看得见：任何**非零**值都给 MIN_TRACK_PX 的下限高度，
      否则量级小的那几根会算成 0.1px、屏幕上等于没画（v186 的实测教训）。
   ============================================================================ */
import { computed, inject, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import ChartFigure from './ChartFigure.vue'
import { seriesColor, OTHER_TOKEN } from './chartTheme'
import { money, moneyParts, moneyUnit, axisNum, niceMax, niceMin, tickValues, qty, int, pct, compact } from './chartFmt'
import { barLayout, plotBox, MIN_TRACK_PX } from './chartGeom'
import { useChartTip } from './useChartTip'

const props = defineProps({
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: '这段时间还没有数据' },
  note: { type: String, default: '' },
  exportName: { type: String, default: '' },
  showExport: { type: Boolean, default: true },
  labels: { type: Array, default: () => [] },
  series: { type: Array, default: () => [] },
  /** single | target | grouped | stacked */
  mode: { type: String, default: 'single' },
  height: { type: Number, default: 240 },
  fmt: { type: String, default: 'money' },
  valueLabels: { type: Boolean, default: true },
  refLines: { type: Array, default: () => [] },
  /** 每根柱单独指定颜色（如"达标 / 未达标"分色）：与 labels 等长，缺省项回落系列色 */
  colors: { type: Array, default: () => [] },
  /** target 形态下是否在 tooltip 里给达成率 */
  showRate: { type: Boolean, default: true },
  minWidth: { type: Number, default: 520 },
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
  } else window.addEventListener('resize', measureW)
})
onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  window.removeEventListener('resize', measureW)
})

const labels = computed(() => props.labels || [])
const n = computed(() => labels.value.length)

const box = computed(() => plotBox({ W: W.value, H: H.value, pad: PAD }))
const plotW = computed(() => box.value.plotW)
const plotH = computed(() => box.value.plotH)
const baseY = computed(() => box.value.base)

/* —— 系列与图例 —— */
const series = computed(() => (props.series || []).map((s, i) => ({ ...s, color: s.color || seriesColor(i) })))
const castSeries = computed(() => {
  // target 形态：series[0] 是"目标位"，语义上是参照物，不该占主色序的 1 号位（给它灰，与轨道同源）
  if (props.mode === 'target') return series.value.map((s, i) => (i === 0 ? { ...s, color: s.color || OTHER_TOKEN } : s))
  return series.value
})
const legendItems = computed(() => castSeries.value)
const canToggle = computed(() => props.mode === 'grouped' || props.mode === 'stacked')

const off = ref({})
function toggle(name) {
  const next = { ...off.value }
  if (next[name]) delete next[name]
  else next[name] = true
  off.value = next
}
const activeSeries = computed(() => {
  if (!canToggle.value) return castSeries.value
  const list = castSeries.value.filter((s) => !off.value[s.name])
  return list.length ? list : castSeries.value
})

/* —— 量程 —— */
const nums = (arr) => (arr || []).filter((v) => v !== null && v !== undefined && isFinite(Number(v))).map(Number)
const dataMax = computed(() => {
  let m = 0
  if (props.mode === 'stacked') {
    // 堆叠：量程按**逐槽合计**取，否则最高的那摞会顶出画布
    for (let i = 0; i < n.value; i++) {
      let sum = 0
      for (const s of activeSeries.value) sum += Math.max(0, Number((s.data || [])[i]) || 0)
      m = Math.max(m, sum)
    }
    return m
  }
  for (const s of activeSeries.value) for (const v of nums(s.data)) m = Math.max(m, v)
  return m
})
const dataMin = computed(() => {
  let m = 0
  for (const s of activeSeries.value) for (const v of nums(s.data)) m = Math.min(m, v)
  return m
})
const yMax = computed(() => niceMax(dataMax.value))
const yMin = computed(() => (dataMin.value >= 0 ? 0 : niceMin(dataMin.value)))

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
function axText(v) {
  if (props.fmt === 'qty' && axUnitKey.value === '万') {
    const x = Number(v) / 1e4
    return String(Math.abs(x) >= 100 ? Math.round(x) : Number(x.toFixed(2)))
  }
  return axisNum(v, axUnitKey.value)
}
function fmtVal(v) {
  if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return '—'
  if (props.fmt === 'money') return money(v)
  if (props.fmt === 'qty') return qty(v)
  return int(v)
}
/** 柱顶标注：不带 ¥（空间紧，货币单位已由轴标题承担），只留数字+万/亿 */
function shortVal(v) {
  if (v === null || v === undefined || !isFinite(Number(v))) return ''
  if (props.fmt === 'money') {
    const { v: vv, unit } = moneyParts(v)
    return vv === '—' ? '' : `${vv}${unit}`
  }
  return compact(v)
}

const barLay = computed(() => barLayout({ plotW: plotW.value, padL: PAD.l, count: n.value }))

const ticks = computed(() => tickValues(yMin.value, yMax.value, 4).map((v) => ({
  v,
  y: Math.round(baseY.value - ((v - yMin.value) / ((yMax.value - yMin.value) || 1)) * plotH.value),
})))

function hOf(v) {
  const lo = yMin.value
  const hi = yMax.value
  if (hi - lo <= 0) return 0
  return (Math.min(Math.max(Number(v) || 0, lo), hi) - lo) / (hi - lo) * plotH.value
}
function yOf(v) { return baseY.value - hOf(v) }

/* —— 逐柱几何 —— */
const bars = computed(() => {
  const out = []
  const bw = barLay.value.bw
  const slot = barLay.value.slot
  for (let i = 0; i < n.value; i++) {
    const tracks = []
    const fills = []
    const lbls = []
    const hx = PAD.l + i * slot
    const hw = slot
    const xBar = barLay.value.xBar(i)

    if (props.mode === 'target') {
      const tgt = Number((castSeries.value[0]?.data || [])[i]) || 0
      const ach = Number((castSeries.value[1]?.data || [])[i]) || 0
      const hasT = tgt > 0
      const th = hasT ? Math.max(MIN_TRACK_PX, hOf(tgt)) : 0
      const ah = hOf(ach)
      const fillH = hasT ? Math.min(ah, th) : ah
      const deepH = Math.max(0, ah - fillH)
      const col = props.colors[i] || castSeries.value[1]?.color || seriesColor(1)
      if (th > 0) tracks.push({ k: 't', x: xBar, y: baseY.value - th, w: bw, h: Math.round(th) })
      if (fillH > 0) fills.push({ k: 'f', x: xBar, y: baseY.value - fillH, w: bw, h: Math.round(fillH), color: col })
      if (deepH > 0) fills.push({ k: 'd', x: xBar, y: baseY.value - fillH - deepH, w: bw, h: Math.round(deepH), color: col })
      if (ach > 0) {
        const ty = baseY.value - ah - 8
        if (ty > PAD.t - 4) lbls.push({ k: 'l', x: xBar + bw / 2, y: ty, t: shortVal(ach), color: col })
      }
      out.push({ i, tracks, fills, labels: lbls, hx, hw, tgt, ach, color: col })
      continue
    }

    if (props.mode === 'grouped') {
      const cnt = activeSeries.value.length
      activeSeries.value.forEach((s, si) => {
        const v = Number((s.data || [])[i]) || 0
        const g = barLay.value.xInGroup(i, si, cnt)
        const h = Math.max(v > 0 ? MIN_TRACK_PX : 0, hOf(v))
        const col = props.colors[i] || s.color
        if (h > 0) fills.push({ k: 'f' + si, x: g.x, y: baseY.value - h, w: g.w, h: Math.round(h), color: col })
        if (v > 0) lbls.push({ k: 'l' + si, x: g.x + g.w / 2, y: baseY.value - h - 8, t: shortVal(v), color: col })
      })
      out.push({ i, tracks, fills, labels: lbls, hx, hw })
      continue
    }

    if (props.mode === 'stacked') {
      let acc = 0
      let topY = baseY.value
      activeSeries.value.forEach((s, si) => {
        const v = Math.max(0, Number((s.data || [])[i]) || 0)
        if (!v) return
        const y = baseY.value - hOf(acc + v)
        const h = Math.max(MIN_TRACK_PX, (baseY.value - y) - hOf(acc))
        fills.push({ k: 'f' + si, x: xBar, y, w: bw, h: Math.round(h), color: s.color })
        acc += v
        topY = y
      })
      if (acc > 0) lbls.push({ k: 'l', x: xBar + bw / 2, y: topY - 8, t: shortVal(acc), color: 'var(--t2)' })
      out.push({ i, tracks, fills, labels: lbls, hx, hw, total: acc })
      continue
    }

    // single
    const v = Number((activeSeries.value[0]?.data || [])[i]) || 0
    const h = Math.max(v > 0 ? MIN_TRACK_PX : 0, hOf(v))
    const col = props.colors[i] || activeSeries.value[0]?.color || seriesColor(0)
    if (h > 0) fills.push({ k: 'f', x: xBar, y: baseY.value - h, w: bw, h: Math.round(h), color: col })
    if (v > 0) lbls.push({ k: 'l', x: xBar + bw / 2, y: baseY.value - h - 8, t: shortVal(v), color: col })
    out.push({ i, tracks, fills, labels: lbls, hx, hw, value: v, color: col })
  }
  return out
})

const showVals = computed(() => props.valueLabels && n.value <= 14)

function refY(v) {
  const x = Number(v)
  if (!isFinite(x)) return null
  return Math.round(yOf(x))
}

/* —— tooltip —— */
const { tip: tipState, tipEl, show, hide } = useChartTip(() => ({ canvasW: W.value, canvasH: H.value }))

function onHover(i) {
  const rows = []
  if (props.mode === 'target') {
    const b = bars.value[i]
    rows.push({ k: castSeries.value[0]?.name || '目标位', v: fmtVal(b.tgt), color: OTHER_TOKEN })
    rows.push({ k: castSeries.value[1]?.name || '实际', v: fmtVal(b.ach), color: b.color })
    if (props.showRate && b.tgt > 0) {
      rows.push({ k: '达成率', v: pct(b.ach / b.tgt), color: 'transparent', r: b.ach >= b.tgt ? '已达标' : '还差一些', warn: b.ach < b.tgt })
    }
  } else if (props.mode === 'stacked') {
    for (const s of activeSeries.value) rows.push({ k: s.name, v: fmtVal((s.data || [])[i]), color: s.color })
    const b = bars.value[i]
    if (b) rows.push({ k: '合计', v: fmtVal(b.total), color: 'transparent' })
  } else if (props.mode === 'grouped') {
    for (const s of activeSeries.value) rows.push({ k: s.name, v: fmtVal((s.data || [])[i]), color: s.color })
  } else {
    const b = bars.value[i]
    rows.push({ k: activeSeries.value[0]?.name || '数值', v: fmtVal(b ? b.value : null), color: b ? b.color : 'transparent' })
  }
  show({
    key: 'i' + i,
    title: String(labels.value[i] == null ? '' : labels.value[i]),
    rows,
    anchorX: Math.round(PAD.l + barLay.value.slot * (i + 0.5)),
    halfW: barLay.value.bw / 2,
  })
}

const ariaLabel = computed(() => `柱状图：${labels.value.join('、')}`)

const fig = inject('chFigure', null)
watchEffect(() => { if (fig) fig.setSvg(svgEl.value) })
</script>
