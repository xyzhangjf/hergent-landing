<template>
  <div class="rc" :class="['rc-' + (card.type || 'kpi'), { compact: props.compact }]">
    <!-- 头部：图标 + 标题 + 场景徽标 -->
    <div class="rc-head">
      <span class="rc-ic"><Icon :name="icon"/></span>
      <div class="rc-title">{{ card.title }}</div>
      <span class="rc-badge" :class="badgeCls">{{ badgeLabel }}</span>
    </div>

    <!-- 摘要行：一句话结论 -->
    <p v-if="card.summary" class="rc-summary">{{ card.summary }}</p>

    <!-- 指标网格 -->
    <div v-if="card.metrics && card.metrics.length" class="rc-metrics">
      <div v-for="(m, i) in card.metrics" :key="i" class="rc-metric">
        <div class="rc-m-label">{{ m.label }}</div>
        <div class="rc-m-value" :class="'tone-' + (m.tone || 'neutral')">{{ m.value }}</div>
        <div v-if="m.hint" class="rc-m-hint">{{ m.hint }}</div>
      </div>
    </div>

    <!-- 明细清单：AI 直给的结构化行（如 `items:[{name,daily_avg,stock,suggest}]`）。
         规范字段只有 metrics/points，不兜底的话这类卡片会只剩一个标题、数据全丢。 -->
    <div v-if="detail && !props.compact" class="rc-items">
      <div class="rc-item-hd">
        <span v-for="(c, i) in detail.cols" :key="i">{{ c.label }}</span>
      </div>
      <div v-for="(r, ri) in detail.rows" :key="ri" class="rc-item-row">
        <span v-for="(c, ci) in detail.cols" :key="ci" :class="ci === 0 ? 'rc-item-name' : ''">{{ r[c.key] }}</span>
      </div>
      <div v-if="detail.meta" class="rc-item-meta">{{ detail.meta }}</div>
    </div>

    <!-- 要点列表 -->
    <ul v-if="!props.compact && card.points && card.points.length" class="rc-points">
      <li v-for="(p, i) in card.points" :key="i" :class="'dot-' + (p.tone || 'neutral')">
        <span class="rc-dot"></span><span>{{ p.text }}</span>
      </li>
    </ul>

    <!-- 状态留痕 + 操作区 -->
    <div v-if="!props.compact" class="rc-foot">
      <span v-if="card.status" class="rc-status" :class="'st-' + card.status">{{ statusLabel }}</span>
      <div class="rc-actions">
        <button
          v-for="a in actions"
          :key="a.key"
          class="btn btn-sm"
          :class="a.primary ? 'btn-primary' : 'btn-ghost'"
          @click="onAction(a)"
        >{{ a.label }}</button>
      </div>
    </div>

    <!-- 图表（M2：支持一卡多图 —— `card.chart` 可以是对象或数组；
         每张按 kind 选型：mini 折线 / bar 柱状 / donut 环形，零依赖自绘 SVG） -->
    <div v-if="charts.length && !props.compact" class="rc-charts">
      <div v-for="(ch, ci) in charts" :key="ci" class="rc-chart">
        <svg v-if="ch.kind === 'mini' && pointsOf(ch)" class="rc-spark" viewBox="0 0 200 48" preserveAspectRatio="none">
          <polyline :points="pointsOf(ch).poly" fill="none" stroke="var(--p-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle :cx="pointsOf(ch).lx" :cy="pointsOf(ch).ly" r="3" fill="var(--p-dark)"/>
        </svg>
        <svg v-else-if="ch.kind === 'bar' && barsOf(ch)" class="rc-spark" viewBox="0 0 200 60" preserveAspectRatio="none">
          <g v-for="(b, i) in barsOf(ch)" :key="i">
            <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2" fill="var(--p-dark)" opacity="0.85">
              <title>{{ b.label }}{{ b.label ? '：' : '' }}¥{{ b.value.toLocaleString() }}</title>
            </rect>
          </g>
        </svg>
        <template v-else-if="ch.kind === 'donut' && donutOf(ch)">
          <svg class="rc-donut" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="18" fill="none" stroke="var(--bg2)" stroke-width="8"/>
            <circle v-for="(seg, i) in donutOf(ch)" :key="i" cx="24" cy="24" r="18" fill="none"
              :stroke="seg.color" stroke-width="8"
              :stroke-dasharray="`${seg.dash} ${2 * Math.PI * 18 - seg.dash}`"
              :stroke-dashoffset="seg.offset" transform="rotate(-90 24 24)"/>
          </svg>
          <div v-if="ch.segments" class="rc-donut-legend">
            <span v-for="(s, i) in ch.segments" :key="i" class="rc-donut-lg">
              <i :style="{ background: (donutOf(ch)[i] && donutOf(ch)[i].color) || 'var(--p)' }"></i>{{ s.label }}
            </span>
          </div>
        </template>
        <div v-else class="rc-chart-empty">暂无数据</div>
        <div class="rc-chart-cap" v-if="capOf(ch)">{{ capOf(ch) }}</div>
      </div>
    </div>
    <div v-else-if="chartImg" class="rc-chart">
      <img :src="chartImg" class="rc-chart-img" alt="趋势图"/>
    </div>

    <!-- 数据溯源：增强非技术老板信任（P1-6） -->
    <div v-if="card.source" class="rc-source"><Icon name="paperclip"/> {{ card.source }}</div>
  </div>
</template>

<script setup>
import Icon from './Icon.vue'
import { computed } from 'vue'

const props = defineProps({
  card: { type: Object, required: true },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['action'])

const SCENE = {
  loss:      { label: '货损', icon: 'trending-down', badge: 'badge-red' },
  rebate:    { label: '返利', icon: 'coins', badge: 'badge-blue' },
  forecast:  { label: '预报', icon: 'package', badge: 'badge-blue' },
  reconcile: { label: '对账', icon: 'search', badge: 'badge-amber' },
  payroll:   { label: '工资', icon: 'users', badge: 'badge-blue' },
  kpi:       { label: '指标', icon: 'bar-chart', badge: 'badge-green' }
}

const STATUS = {
  draft:     '待确认',
  confirmed: '已确认',
  executed:  '已执行',
  rejected:  '已驳回'
}

const scene = computed(() => SCENE[props.card.type] || SCENE.kpi)
const icon = computed(() => scene.value.icon)
const badgeLabel = computed(() => scene.value.label)
const badgeCls = computed(() => scene.value.badge)
const statusLabel = computed(() => STATUS[props.card.status] || STATUS.draft)
const actions = computed(() =>
  (props.card.actions && props.card.actions.length)
    ? props.card.actions
    : [{ key: 'adopt', label: '采纳', primary: true }, { key: 'reject', label: '驳回' }]
)

/* ---- 明细清单兜底（2026-09-11）：
   AI 直出经营卡时常给 items / rows / detail / list 这类自定义数组，而规范卡只认
   metrics/points → 不兜底就只剩一个标题、数据全丢。这里做一层字段名映射成小表。 ---- */
const ITEM_LABELS = {
  name: '品名', product: '品名', title: '品名', sku: '品名', item: '品名',
  daily_avg: '日均', avg: '日均', daily: '日均', daily_sales: '日均', sales: '销量',
  stock: '库存', inventory: '库存', stock_qty: '库存',
  qty: '数量', quantity: '数量', num: '数量', unit: '单位',
  suggest: '建议', suggest_qty: '建议', recommend: '建议', need: '建议', advice: '建议',
  days_supply: '可销天数', supply_days: '可销天数', cover_days: '可销天数',
  price: '单价', amount: '金额', money: '金额', sum: '金额', total: '合计'
}
const DETAIL_KEYS = ['items', 'rows', 'detail', 'list']
const detail = computed(() => {
  const c = props.card || {}
  const arr = DETAIL_KEYS.map((k) => c[k])
    .find((a) => Array.isArray(a) && a.length && a[0] && typeof a[0] === 'object')
  if (!arr) return null
  const keys = []
  arr.forEach((o) => Object.keys(o || {}).forEach((k) => { if (!keys.includes(k)) keys.push(k) }))
  const cols = keys.slice(0, 4).map((k) => ({ key: k, label: ITEM_LABELS[k] || k }))
  if (!cols.length) return null
  const rows = arr.slice(0, 12).map((o) => {
    const r = {}
    cols.forEach((col) => {
      const v = o[col.key]
      r[col.key] = (v === null || v === undefined || v === '') ? '—' : String(v)
    })
    return r
  })
  const meta = []
  if (c.note) meta.push(String(c.note))
  if (c.data_date) meta.push('数据截至 ' + String(c.data_date).slice(0, 10))
  if (c.reorder_date) meta.push('建议下单 ' + String(c.reorder_date).slice(0, 10))
  if (c.arrival_date) meta.push('预计到货 ' + String(c.arrival_date).slice(0, 10))
  if (arr.length > rows.length) meta.push(`仅列前 ${rows.length} 项，共 ${arr.length} 项`)
  return { cols, rows, meta: meta.join(' · ') }
})

function onAction(a) {
  emit('action', { key: a.key, card: props.card })
}

/* ---- M2 图表：一卡多图（`card.chart` 视作对象或数组），几何按「图对象」现算 ---- */
const charts = computed(() => {
  const c = props.card.chart
  if (!c) return []
  if (Array.isArray(c)) return c.filter((x) => x && typeof x === 'object')
  return c.url ? [] : [c]
})
const chartImg = computed(() => {
  const c = props.card.chart
  return (c && !Array.isArray(c) && c.url) ? c.url : null
})

function seriesOf(ch) {
  return (ch && Array.isArray(ch.series)) ? ch.series : null
}

/* 折线（sparkline）：把 series 映射成 polyline 几何 */
function pointsOf(ch) {
  const s = seriesOf(ch)
  if (!s || s.length < 2) return null
  const min = Math.min(...s), max = Math.max(...s)
  const span = (max - min) || 1
  const W = 200, H = 48, pad = 4
  const pts = s.map((v, i) => {
    const x = pad + (i / (s.length - 1)) * (W - pad * 2)
    const y = H - (pad + ((v - min) / span) * (H - pad * 2))
    return [x, y]
  })
  return {
    poly: pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '),
    lx: pts[pts.length - 1][0],
    ly: pts[pts.length - 1][1],
  }
}

/* 柱状：按最大值归一 */
function barsOf(ch) {
  const s = seriesOf(ch)
  if (!s || !s.length) return null
  const labels = (ch && ch.labels) || []
  const max = Math.max(...s) || 1
  const W = 200, H = 60, pad = 4, top = 8
  const n = s.length
  const gap = (W - pad * 2) / n
  const bw = gap * 0.6
  return s.map((v, i) => {
    const h = Math.max((v / max) * (H - pad - top), v > 0 ? 2 : 0)
    const x = pad + i * gap + (gap - bw) / 2
    return { x, y: H - pad - h, w: bw, h, label: labels[i] || '', value: v }
  })
}

const DONUT_PALETTE = ['var(--p)', 'var(--suc)', 'var(--war)', 'var(--dan)', 'var(--t3)']
/* 环形：按 segments.value 占比切弧（M2 起真正被使用：构成占比类） */
function donutOf(ch) {
  const segs = ch && ch.segments
  if (!Array.isArray(segs) || !segs.length) return null
  const total = segs.reduce((a, s) => a + (s.value || 0), 0) || 1
  const C = 2 * Math.PI * 18
  let acc = 0
  return segs.map((s, i) => {
    const frac = (s.value || 0) / total
    const dash = frac * C
    const offset = -acc * C
    acc += frac
    return { dash, offset, color: s.color || DONUT_PALETTE[i % DONUT_PALETTE.length] }
  })
}

function capOf(ch) {
  if (!ch) return ''
  // 无足够趋势数据时不回退默认文案，避免误导
  if (ch.kind === 'mini' && (!seriesOf(ch) || seriesOf(ch).length < 2)) return ch.caption || ''
  return ch.caption || (ch.kind === 'mini' ? '近 7 日趋势' : '')
}
</script>

<style scoped>
.rc{
  width:100%;
  background:var(--bg);
  border:1px solid var(--border-subtle);
  border-radius:var(--radius-lg);
  box-shadow:var(--shadow-sm);
  padding:12px 14px;
  display:flex;flex-direction:column;gap:10px;
  transition:box-shadow .18s ease,border-color .18s ease;
}
.rc:hover{box-shadow:var(--shadow-md);border-color:var(--bd)}
.rc.compact{padding:10px 12px;gap:7px}
.rc.compact .rc-title{font-size:13px}
.rc.compact .rc-m-value{font-size:15px}

.rc-head{display:flex;align-items:center;gap:8px}
.rc-ic{width:28px;height:28px;border-radius:9px;background:var(--p-bg);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.rc-title{font-size:13.5px;font-weight:600;color:var(--t1);flex:1;line-height:1.4}
.rc-badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;font-size:11px;font-weight:500;flex-shrink:0}
.badge-red{background:rgba(var(--dan-rgb),.12);color:var(--dan)}
.badge-blue{background:var(--p-bg);color:var(--p-dark)}
.badge-amber{background:rgba(var(--war-rgb),.15);color:var(--war)}
.badge-green{background:rgba(var(--suc-rgb),.12);color:var(--suc)}

.rc-summary{font-size:13px;line-height:1.6;color:var(--t1);margin:0}

.rc-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px}
.rc-metric{background:var(--bg2);border-radius:var(--radius-md);padding:8px 10px;display:flex;flex-direction:column;gap:2px}
.rc-m-label{font-size:11px;color:var(--t3)}
.rc-m-value{font-size:16px;font-weight:600;color:var(--t1);font-variant-numeric:tabular-nums;line-height:1.2}
.rc-m-hint{font-size:10.5px;color:var(--t3)}
.tone-good{color:var(--suc)!important}
.tone-warn{color:var(--war)!important}
.tone-bad{color:var(--dan)!important}
.tone-neutral{color:var(--t1)}

.rc-points{list-style:none;display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
.rc-points li{display:flex;align-items:flex-start;gap:7px;font-size:12.5px;color:var(--t2);line-height:1.5}
.rc-dot{width:6px;height:6px;border-radius:50%;margin-top:6px;flex-shrink:0;background:var(--t3)}
.dot-good .rc-dot{background:var(--suc)}
.dot-warn .rc-dot{background:var(--war)}
.dot-bad  .rc-dot{background:var(--dan)}

/* 明细清单（AI 直出 items）：首列品名自适应省略，其余数值列右对齐固定宽 */
.rc-items{border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;background:var(--bg)}
.rc-item-hd,.rc-item-row{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;line-height:1.4}
.rc-item-hd{background:var(--bg2);font-size:11px;color:var(--t3)}
.rc-item-hd span,.rc-item-row span{flex:0 0 auto;min-width:44px;text-align:right;color:var(--t2);white-space:nowrap}
.rc-item-hd span:first-child,.rc-item-row span:first-child{flex:1 1 auto;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis}
.rc-item-row+.rc-item-row{border-top:1px solid var(--border-subtle)}
.rc-item-name{color:var(--t1)}
.rc-item-meta{padding:6px 10px;font-size:11px;color:var(--t3);line-height:1.5;border-top:1px solid var(--border-subtle);background:var(--bg2)}

.rc-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px}
.rc-status{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;font-size:11px;font-weight:500}
.st-draft{background:rgba(var(--war-rgb),.15);color:var(--war)}
.st-confirmed{background:var(--p-bg);color:var(--p-dark)}
.st-executed{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.st-rejected{background:rgba(var(--dan-rgb),.12);color:var(--dan)}
.rc-actions{margin-left:auto;display:flex;gap:6px}
.btn-sm{height:30px;padding:0 12px;font-size:12px;border-radius:var(--radius-sm)}

.rc-charts{display:flex;flex-direction:column;gap:10px;margin-top:2px}
.rc-chart{margin-top:2px}
.rc-spark{width:100%;height:48px;display:block}
.rc-chart-cap{font-size:11px;color:var(--t3);margin-top:4px;text-align:right}
.rc-chart-empty{font-size:11px;color:var(--t3);padding:10px 0;text-align:center;background:var(--bg2);border-radius:var(--radius-md)}
.rc-donut{width:48px;height:48px;display:block;margin:0 auto}
.rc-donut-legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:6px;justify-content:center}
.rc-donut-lg{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--t2)}
.rc-donut-lg i{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.rc-chart-img{width:100%;border-radius:var(--radius-md);display:block}
.rc-source{font-size:11px;color:var(--t3);line-height:1.5;border-top:1px dashed var(--border-subtle);padding-top:7px;margin-top:2px}
.rc.compact .rc-source{font-size:10.5px;padding-top:5px}
</style>
