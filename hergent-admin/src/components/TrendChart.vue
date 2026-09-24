<template>
  <div class="trend-wrap">
    <div class="trend-head">
      <span class="big">{{ total }}</span>
      <span class="sub">{{ caption }}</span>
    </div>
    <svg
      class="trend-svg"
      :viewBox="'0 0 ' + W + ' ' + H"
      preserveAspectRatio="none"
      role="img"
      :aria-label="ariaLabel"
    >
      <line class="trend-axis" :x1="0" :y1="H - PAD" :x2="W" :y2="H - PAD" />
      <path class="trend-area" :d="areaPath" />
      <path class="trend-line" :d="linePath" vector-effect="non-scaling-stroke" />
      <circle
        v-for="(p, i) in points"
        :key="i"
        class="trend-dot"
        :cx="p.x"
        :cy="p.y"
        r="2"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div class="trend-foot muted text-xs">
      <span>{{ data.length ? data[0].date.slice(5) : '—' }}</span>
      <span>{{ data.length ? data[data.length - 1].date.slice(5) : '—' }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// 手绘 SVG 趋势图：零第三方依赖（与全站"零运行时依赖"路线一致）。
// preserveAspectRatio="none" + vector-effect=non-scaling-stroke ⇒ 拉伸时线宽不畸变。
const props = defineProps({
  data: { type: Array, default: () => [] },   // [{date:'YYYY-MM-DD', count:Number}]
  caption: { type: String, default: '' },
})

const W = 300
const H = 90
const PAD = 10

const total = computed(() => props.data.reduce((s, d) => s + Number(d.count || 0), 0))
const max = computed(() => Math.max(1, ...props.data.map((d) => Number(d.count || 0))))

const points = computed(() => {
  const n = props.data.length
  if (!n) return []
  const inner = H - PAD * 2
  return props.data.map((d, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * W
    const y = H - PAD - (Number(d.count || 0) / max.value) * inner
    return { x, y }
  })
})

const linePath = computed(() =>
  points.value.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ')
)
const areaPath = computed(() => {
  if (!points.value.length) return ''
  const first = points.value[0]
  const last = points.value[points.value.length - 1]
  return linePath.value + ' L' + last.x.toFixed(1) + ' ' + (H - PAD) + ' L' + first.x.toFixed(1) + ' ' + (H - PAD) + ' Z'
})

const ariaLabel = computed(() => {
  if (!props.data.length) return '暂无趋势数据'
  return '近 ' + props.data.length + ' 天每日新增，合计 ' + total.value + '，'
    + '区间 ' + props.data[0].date + ' 至 ' + props.data[props.data.length - 1].date
})
</script>

<style scoped>
.trend-foot { display: flex; justify-content: space-between; margin-top: 4px; }
</style>
