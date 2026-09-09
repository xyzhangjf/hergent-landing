<template>
  <div class="mac" ref="rootEl">
    <div class="mac-hd">
      <div class="mac-ti">
        <b>全年月度达成</b>
        <span class="mac-sub">返利为按规则预估应返，非实际到账</span>
      </div>
      <div class="mac-ctl">
        <select v-model="yearVal" class="input sel-year" @change="emit('update:year', yearVal)">
          <option v-for="y in yearOptions" :key="y" :value="y">{{ y }} 年</option>
        </select>
        <div class="ctl-pop">
          <div v-if="brandOpen" class="bp-mask" @click="brandOpen = false"></div>
          <button class="btn btn-sm btn-ghost" :class="{ on: brandOpen }" @click="brandOpen = !brandOpen">
            <Icon name="filter" /> {{ brandLabel }} <Icon name="chevron-down" />
          </button>
          <div v-if="brandOpen" class="bp-pop" @click.stop>
            <div class="bp-head">
              <span>按品牌筛选</span>
              <div class="bp-acts">
                <button class="link-btn" @click="selectAll">全选</button>
                <button class="link-btn" @click="clearSel">清空</button>
              </div>
            </div>
            <input v-model="brandQuery" class="input bp-search" type="text" placeholder="搜索品牌" />
            <div class="bp-list">
              <label v-for="b in filteredBrands" :key="b" class="bp-item">
                <input type="checkbox" :value="b" :checked="brandSel.includes(b)" @change="toggleBrand(b)" /> {{ b }}
              </label>
              <p v-if="!filteredBrands.length" class="bp-empty">没有匹配的品牌</p>
            </div>
            <p class="bp-tip">不勾选 = 全部品牌合计。达成率按加权计算（合计达成 ÷ 合计目标）。</p>
          </div>
        </div>
        <div class="mac-seg">
          <button class="seg-btn" :class="{ on: view === 'bar' }" @click="view = 'bar'">四柱同屏</button>
          <button class="seg-btn" :class="{ on: view === 'rate' }" @click="view = 'rate'">达成率</button>
        </div>
      </div>
    </div>

    <div class="mac-legend">
      <button
        v-for="s in legend"
        :key="s.k"
        class="lg-item"
        :class="{ off: !shown[s.k] }"
        @click="toggle(s.k)"
      >
        <i :style="{ background: s.fill, borderColor: s.stroke || s.fill }"></i>{{ s.t }}
      </button>
      <span class="lg-note">达成率 = 合计达成 ÷ 合计目标</span>
    </div>

    <!-- 加载态：骨架屏 -->
    <div v-if="loading" class="mac-body mac-skel">
      <div v-for="i in 12" :key="i" class="sk-col">
        <span :style="{ height: (30 + ((i * 37) % 45)) + '%' }"></span>
        <span :style="{ height: (24 + ((i * 23) % 40)) + '%' }"></span>
        <span :style="{ height: (20 + ((i * 41) % 30)) + '%' }"></span>
        <span :style="{ height: (16 + ((i * 17) % 26)) + '%' }"></span>
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
        <text class="ax-ti" :x="PAD.l" :y="16">{{ view === 'rate' ? '销量达成率' : `销量（${unitLeft}）` }}</text>
        <text class="ax-ti" :x="W - PAD.r" :y="16" text-anchor="end">{{ view === 'rate' ? '返利达成率' : '返利（万元）' }}</text>

        <g v-if="view === 'bar'">
          <line
            v-for="g in gridY" :key="'g' + g.v"
            :x1="PAD.l" :x2="W - PAD.r" :y1="g.y" :y2="g.y"
            class="grid"
          />
          <text
            v-for="g in gridY" :key="'gl' + g.v"
            class="ax-lb" :x="PAD.l - 8" :y="g.y + 4" text-anchor="end"
          >{{ g.left }}</text>
          <text
            v-for="g in gridY" :key="'gr' + g.v"
            class="ax-lb" :x="W - PAD.r + 8" :y="g.y + 4"
          >{{ g.right }}</text>
        </g>

        <g v-else>
          <line
            v-for="g in gridR" :key="'rg' + g.v"
            :x1="PAD.l" :x2="W - PAD.r" :y1="g.y" :y2="g.y"
            class="grid"
          />
          <text
            v-for="g in gridR" :key="'rl' + g.v"
            class="ax-lb" :x="PAD.l - 8" :y="g.y + 4" text-anchor="end"
          >{{ g.t }}</text>
          <line
            :x1="PAD.l" :x2="W - PAD.r" :y1="yRate(1)" :y2="yRate(1)"
            class="grid mark"
          />
        </g>

        <g v-for="(mo, i) in months" :key="mo.key">
          <rect
            v-if="view === 'bar'"
            v-for="(b, bi) in barsOf(mo)" :key="mo.key + bi"
            :x="xBar(i, bi)" :y="yBar(b.v, b.axis)"
            :width="BW" :height="Math.max(0, PAD.t + plotH - yBar(b.v, b.axis))"
            :fill="b.fill" :stroke="b.stroke || 'none'" stroke-width="0.5"
            rx="1"
          />
          <rect
            v-if="view === 'rate'"
            v-for="(b, bi) in rateBarsOf(mo)" :key="mo.key + 'r' + bi"
            :x="xBarR(i, bi)" :y="yRate(b.v)"
            :width="BW" :height="Math.max(0, PAD.t + plotH - yRate(b.v))"
            :fill="b.fill" rx="1"
          />
          <circle
            v-if="dotOf(mo)"
            :cx="xGroup(i) + GW / 2" :cy="yBar(Math.max(mo.salesTarget, mo.salesAchv), 'l') - 6"
            r="2.6" :fill="dotOf(mo)"
          />
          <text class="ax-mo" :x="xGroup(i) + GW / 2" :y="H - PAD.b + 20" text-anchor="middle">
            {{ mo.m }}月
          </text>
          <circle v-if="mo.key === curKey" :cx="xGroup(i) + GW / 2" :cy="H - PAD.b + 30" r="2.5" class="cur-dot" />
          <rect
            :x="xGroup(i)" :y="PAD.t" :width="GW" :height="plotH"
            fill="transparent" @mouseenter="onHover(mo, i)" @mousemove="onHover(mo, i)"
          />
        </g>

        <line :x1="PAD.l" :x2="W - PAD.r" :y1="PAD.t + plotH" :y2="PAD.t + plotH" class="axis" />
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

    <div v-if="!loading && hasAny" class="mac-ft">
      <span v-if="emptyMonths">灰色月份尚未填报达成，去「达成填报」补录</span>
      <span v-if="excluded.nonBrand">另有 {{ excluded.nonBrand }} 条非品牌维度目标未计入本图</span>
      <span v-if="excluded.crossUnit">另有 {{ excluded.crossUnit }} 条{{ measure === 'amount' ? '数量' : '金额' }}口径规则因单位不同未计入</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { rate, niceMax } from './useMonthlyAchv.js'

const props = defineProps({
  model: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  year: { type: [Number, String], default: '' },
  yearOptions: { type: Array, default: () => [] },
  brandList: { type: Array, default: () => [] },
  brandSel: { type: Array, default: () => [] },
  singleBrand: { type: Boolean, default: false },
})
const emit = defineEmits(['update:year', 'update:brandSel'])

// 品牌筛选下拉
const brandOpen = ref(false)
const brandQuery = ref('')
const yearVal = ref(props.year)
const brandNames = computed(() => (props.brandList || []).map(b => b.name || b).filter(Boolean))
const filteredBrands = computed(() => {
  const q = String(brandQuery.value || '').trim()
  return q ? brandNames.value.filter(n => n.includes(q)) : brandNames.value
})
const brandLabel = computed(() => {
  const n = (props.brandSel || []).length
  if (!n) return '全部品牌'
  return n === 1 ? props.brandSel[0] : `已选 ${n} 个品牌`
})
function toggleBrand(b) {
  const cur = (props.brandSel || []).slice()
  const i = cur.indexOf(b)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(b)
  emit('update:brandSel', cur)
}
function selectAll() { emit('update:brandSel', brandNames.value.slice()) }
function clearSel() { emit('update:brandSel', []) }
watch(() => props.year, v => { yearVal.value = v })

// v124：画布宽度跟随容器自适应（viewBox 宽度 = 实际渲染宽度，避免 SVG 等比缩放导致左右大片留白）
const MIN_W = 680
const rootEl = ref(null)
const W = ref(MIN_W)
const H = 300
const PAD = { l: 62, r: 66, t: 24, b: 36 }
const plotW = computed(() => W.value - PAD.l - PAD.r)
const plotH = H - PAD.t - PAD.b
const GW = computed(() => plotW.value / 12)
const GAP = 2
// 柱宽随可用月槽宽度放大（8~22px），窄屏退回最小值后由横向滚动兜底
const BW = computed(() => Math.max(8, Math.min(22, (GW.value - GAP * 3 - 6) / 4)))

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

const view = ref('bar')
const tip = ref(null)
const shown = ref({ st: true, sa: true, rt: true, ra: true })

const C = {
  st: { fill: '#cbd5e1', stroke: '#94a3b8' },
  sa: { fill: '#06b6d4' },
  rt: { fill: '#fde68a', stroke: '#fcd34d' },
  ra: { fill: '#f59e0b' },
}
const legend = [
  { k: 'st', t: '销量目标', ...C.st },
  { k: 'sa', t: '销量达成', ...C.sa },
  { k: 'rt', t: '返利目标', ...C.rt },
  { k: 'ra', t: '返利达成', ...C.ra },
]
function toggle(k) { shown.value = { ...shown.value, [k]: !shown.value[k] } }

const months = computed(() => props.model?.months || [])
const totals = computed(() => props.model?.totals || {})
const excluded = computed(() => props.model?.excluded || { nonBrand: 0, crossUnit: 0 })
const measure = computed(() => props.model?.measure || 'amount')
const hasAny = computed(() => !!props.model?.hasAny)
const unitLeft = computed(() => (measure.value === 'quantity' ? '件' : '万元'))
const curKey = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})
const emptyMonths = computed(() => months.value.some(m => m.salesTarget > 0 && !m.salesAchv))
const emptyText = computed(() => {
  if (!props.model) return '暂无数据'
  if (excluded.value.nonBrand && !months.value.some(m => m.salesTarget > 0)) {
    return `${props.year} 年暂无品牌维度目标`
  }
  return `${props.year} 年还没有品牌目标或达成数据`
})

// 单位换算：元 → 万元（数量度量不换算）
function toDisp(v, axis) {
  const n = Number(v) || 0
  if (measure.value === 'quantity' && axis === 'l') return n
  return n / 10000
}
const maxLeft = computed(() => {
  let mx = 0
  for (const m of months.value) {
    if (shown.value.st) mx = Math.max(mx, toDisp(m.salesTarget, 'l'))
    if (shown.value.sa) mx = Math.max(mx, toDisp(m.salesAchv, 'l'))
  }
  return niceMax(mx) || 1
})
const maxRight = computed(() => {
  let mx = 0
  for (const m of months.value) {
    if (shown.value.rt) mx = Math.max(mx, toDisp(m.rebateTarget, 'r'))
    if (shown.value.ra) mx = Math.max(mx, toDisp(m.rebateAchv, 'r'))
  }
  return niceMax(mx) || 1
})
const maxRate = computed(() => {
  let mx = 1
  for (const m of months.value) {
    if (shown.value.sa) mx = Math.max(mx, rate(m.salesAchv, m.salesTarget) || 0)
    if (shown.value.ra) mx = Math.max(mx, rate(m.rebateAchv, m.rebateTarget) || 0)
  }
  return Math.min(2, niceMax(Math.min(mx * 1.1, 2)) || 1.2)
})

function xGroup(i) { return PAD.l + i * GW.value }
function xBar(i, bi) { return xGroup(i) + (GW.value - (BW.value * 4 + GAP * 3)) / 2 + bi * (BW.value + GAP) }
function xBarR(i, bi) { return xGroup(i) + (GW.value - (BW.value * 2 + GAP * 4)) / 2 + bi * (BW.value + GAP * 2) }
function yBar(v, axis) {
  const mx = axis === 'l' ? maxLeft.value : maxRight.value
  const d = toDisp(v, axis)
  return PAD.t + plotH - (Math.max(0, Math.min(d, mx)) / mx) * plotH
}
function yRate(v) {
  const d = Math.max(0, Math.min(Number(v) || 0, maxRate.value))
  return PAD.t + plotH - (d / maxRate.value) * plotH
}

const gridY = computed(() => {
  const out = []
  for (const f of [1, 0.5, 0]) {
    out.push({
      v: f,
      y: PAD.t + plotH - f * plotH,
      left: fmtAxis(maxLeft.value * f),
      right: fmtAxis(maxRight.value * f),
    })
  }
  return out
})
const gridR = computed(() => {
  const out = []
  for (const f of [1, 0.5, 0]) {
    out.push({ v: f, y: PAD.t + plotH - f * plotH, t: (maxRate.value * f * 100).toFixed(0) + '%' })
  }
  return out
})
function fmtAxis(v) {
  if (measure.value === 'quantity') return String(Math.round(v))
  const x = Number(v) || 0
  return x >= 1000 ? (x / 1000).toFixed(0) + 'k' : (x % 1 === 0 ? String(x) : x.toFixed(1))
}

function barsOf(mo) {
  const out = []
  if (shown.value.st) out.push({ v: mo.salesTarget, axis: 'l', ...C.st })
  if (shown.value.sa) out.push({ v: mo.salesAchv, axis: 'l', ...C.sa })
  if (shown.value.rt) out.push({ v: mo.rebateTarget, axis: 'r', ...C.rt })
  if (shown.value.ra) out.push({ v: mo.rebateAchv, axis: 'r', ...C.ra })
  return out
}
function rateBarsOf(mo) {
  const out = []
  if (shown.value.sa) out.push({ v: rate(mo.salesAchv, mo.salesTarget) || 0, fill: C.sa.fill })
  if (shown.value.ra) out.push({ v: rate(mo.rebateAchv, mo.rebateTarget) || 0, fill: C.ra.fill })
  return out
}
function dotOf(mo) {
  const r = rate(mo.salesAchv, mo.salesTarget)
  if (r == null) return null
  if (r >= 1) return '#16a34a'
  if (r < 0.8) return '#dc2626'
  return null
}

function money(v) {
  const n = Number(v) || 0
  if (measure.value === 'quantity') return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
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
  const rs = rate(mo.salesAchv, mo.salesTarget)
  const rr = rate(mo.rebateAchv, mo.rebateTarget)
  const rows = [
    { k: '销量目标', v: measure.value === 'quantity' ? qty(mo.salesTarget) : money(mo.salesTarget), r: '' },
    { k: '销量达成', v: measure.value === 'quantity' ? qty(mo.salesAchv) : money(mo.salesAchv), r: pct(rs), warn: rs != null && rs < 1 },
    { k: '返利目标', v: money(mo.rebateTarget), r: '' },
    { k: '返利达成', v: money(mo.rebateAchv), r: pct(rr), warn: rr != null && rr < 1 },
  ]
  const extra = []
  if (props.singleBrand) {
    extra.push({ k: '距目标差额', v: measure.value === 'quantity' ? qty(Math.max(0, mo.salesTarget - mo.salesAchv)) : money(Math.max(0, mo.salesTarget - mo.salesAchv)) })
    extra.push({ k: '影响返利', v: money(Math.max(0, mo.rebateTarget - mo.rebateAchv)) })
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
.ctl-pop { position: relative; z-index: 41; }
.bp-mask { position: fixed; inset: 0; z-index: 40; }
.bp-pop {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 42;
  width: 240px; padding: 10px 12px; border-radius: var(--radius-sm, 8px);
  background: var(--bg); border: 1px solid var(--bd); box-shadow: var(--shadow-md);
}
.bp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; color: var(--t1); }
.bp-acts { display: flex; gap: 8px; }
.bp-search { width: 100%; height: 26px; font-size: 12px; margin: 8px 0 4px; }
.bp-list { display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow: auto; }
.bp-item { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--t1); cursor: pointer; padding: 2px; }
.bp-item:hover { background: var(--bg2); }
.bp-empty { color: var(--t3); font-size: 12px; margin: 4px 0; }
.bp-tip { font-size: 12px; color: var(--t3); margin: 8px 0 0; line-height: 1.5; }

.mac-legend { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.lg-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--t2); background: none; border: 0; padding: 0; cursor: pointer; }
.lg-item.off { opacity: .38; text-decoration: line-through; }
.lg-item i { width: 10px; height: 10px; border-radius: 2px; border: 1px solid transparent; display: inline-block; }
.lg-note { font-size: 12px; color: var(--t3); margin-left: auto; }

.mac-body { height: 240px; }
.mac-skel { display: flex; align-items: flex-end; gap: 6px; padding: 10px 0; }
.sk-col { flex: 1; display: flex; align-items: flex-end; gap: 2px; height: 100%; }
.sk-col span { flex: 1; background: var(--border-subtle)); border-radius: 2px; animation: macpulse 1.2s ease-in-out infinite; }
@keyframes macpulse { 0%, 100% { opacity: .45; } 50% { opacity: .9; } }
.mac-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--t3); font-size: 13px; }

.mac-scroll { position: relative; width: 100%; min-width: 0; overflow-x: auto; overflow-y: hidden; }
/* 画布层：宽度＝容器可用宽度，viewBox 与其 1:1 对应；窄屏时锁 680px 由外层横向滚动兜底 */
.mac-canvas { position: relative; width: 100%; min-width: 680px; }
.mac-svg { width: 100%; height: 300px; display: block; }
.grid { stroke: var(--border-subtle); stroke-width: 1; stroke-dasharray: 3 3; }
.grid.mark { stroke: var(--t3); stroke-dasharray: 4 3; }
.axis { stroke: var(--bd); stroke-width: 1; }
.ax-ti { font-size: 12px; fill: var(--t2); }
.ax-lb { font-size: 11px; fill: var(--t3); }
.ax-mo { font-size: 11px; fill: var(--t3); }
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
.tp-ex { display: flex; gap: 8px; line-height: 1.9; border-top: 1px solid var(--border-subtle); margin-top: 4px; padding-top: 4px; }
.tp-ex .tp-v { color: var(--t2); }

.mac-ft { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--t3); }
</style>
