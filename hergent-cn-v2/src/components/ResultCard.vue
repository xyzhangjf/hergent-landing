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

    <!-- 迷你趋势图（M3） -->
    <div v-if="card.chart && !props.compact" class="rc-chart">
      <svg v-if="chartPoints" class="rc-spark" viewBox="0 0 200 48" preserveAspectRatio="none">
        <polyline :points="chartPoints" fill="none" stroke="var(--p-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle :cx="lastX" :cy="lastY" r="3" fill="var(--p-dark)"/>
      </svg>
      <div v-else class="rc-chart-empty">暂无趋势数据</div>
      <div class="rc-chart-cap" v-if="chartCaption">{{ chartCaption }}</div>
    </div>
    <div v-else-if="card.chart && card.chart.url" class="rc-chart">
      <img :src="card.chart.url" class="rc-chart-img" alt="趋势图"/>
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

function onAction(a) {
  emit('action', { key: a.key, card: props.card })
}

/* ---- M3 迷你趋势图：把 series 映射成 sparkline 几何 ---- */
const chartSeries = computed(() => {
  const c = props.card.chart
  if (!c) return null
  if (Array.isArray(c.series)) return c.series
  return null
})
const chartCaption = computed(() => {
  const c = props.card.chart
  if (!c) return ''
  // 无趋势数据时不再回退默认文案，避免误导
  if (!chartSeries.value || chartSeries.value.length < 2) return c.caption || ''
  return c.caption || (c.kind === 'mini' ? '近 7 日趋势' : '')
})
const chartGeom = computed(() => {
  const s = chartSeries.value
  if (!s || s.length < 2) return null
  const min = Math.min(...s), max = Math.max(...s)
  const span = max - min || 1
  const W = 200, H = 48, pad = 4
  const pts = s.map((v, i) => {
    const x = pad + (i / (s.length - 1)) * (W - pad * 2)
    const y = H - (pad + ((v - min) / span) * (H - pad * 2))
    return [x, y]
  })
  return {
    poly: pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '),
    lx: pts[pts.length - 1][0],
    ly: pts[pts.length - 1][1]
  }
})
const chartPoints = computed(() => chartGeom.value ? chartGeom.value.poly : null)
const lastX = computed(() => chartGeom.value ? chartGeom.value.lx : 0)
const lastY = computed(() => chartGeom.value ? chartGeom.value.ly : 0)
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

.rc-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px}
.rc-status{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;font-size:11px;font-weight:500}
.st-draft{background:rgba(var(--war-rgb),.15);color:var(--war)}
.st-confirmed{background:var(--p-bg);color:var(--p-dark)}
.st-executed{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.st-rejected{background:rgba(var(--dan-rgb),.12);color:var(--dan)}
.rc-actions{margin-left:auto;display:flex;gap:6px}
.btn-sm{height:30px;padding:0 12px;font-size:12px;border-radius:var(--radius-sm)}

.rc-chart{margin-top:2px}
.rc-spark{width:100%;height:48px;display:block}
.rc-chart-cap{font-size:11px;color:var(--t3);margin-top:4px;text-align:right}
.rc-chart-empty{font-size:11px;color:var(--t3);padding:10px 0;text-align:center;background:var(--bg2);border-radius:var(--radius-md)}
.rc-chart-img{width:100%;border-radius:var(--radius-md);display:block}
.rc-source{font-size:11px;color:var(--t3);line-height:1.5;border-top:1px dashed var(--border-subtle);padding-top:7px;margin-top:2px}
.rc.compact .rc-source{font-size:10.5px;padding-top:5px}
</style>
