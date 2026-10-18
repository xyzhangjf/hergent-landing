import { ref } from 'vue'
import { toast } from '../store'
import { forecastApproveApi } from '../api/modules'
import { rowSum } from '../utils/forecast/calc.js'

// P5-4 季节因子同环比（去年同期基线）
// 抽离自 Forecast.vue（v567）：纯逻辑，依赖宿主 cross + periods。
export function useForecastYoY(cross, periods) {
// P5-4 季节因子同环比（去年同期基线）
const yoyOn = ref(false)
const yoyMap = ref({})
const yoyPeriodName = ref('')
async function loadYoY() {
  const cur = cross.value.period
  if (!cur || !periods.value.length) { toast('请先选定期次', 'warn'); return }
  const sorted = [...periods.value].sort((a, b) => (a.order_start || '').localeCompare(b.order_start || ''))
  const idx = sorted.findIndex(x => Number(x.id) === Number(cur.id))
  const curStart = cur.order_start || ''
  const yStart = (curStart.length >= 4 && curStart.slice(0, 4) !== '0000') ? (parseInt(curStart.slice(0, 4)) - 1) + curStart.slice(4) : ''
  const yoy = yStart ? sorted.find(x => (x.order_start || '').slice(0, 7) === yStart.slice(0, 7)) : null
  if (!yoy) { toast('无去年同期期次（需同名月份期次）', 'warn'); return }
  yoyPeriodName.value = yoy.name
  try {
    const d = await forecastApproveApi.summary('', yoy.order_start || '', yoy.order_end || '', yoy.id || 0)
    const m = {}
    ;(d.rows || []).forEach(r => { const name = r.product_name || r.name; const total = (r.sources || []).reduce((s, x) => s + (parseInt(x.qty) || 0), 0); m[name] = (m[name] || 0) + total })
    yoyMap.value = m; yoyOn.value = true
    toast('已载入去年同期「' + yoy.name + '」', 'ok')
  } catch (e) { toast('去年同期载入失败', 'err') }
}
function yoyQty(r) { const v = yoyMap.value[r.name]; return v != null ? v : null }
function yoyPct(r) { const y = yoyQty(r); if (y == null || y === 0) return null; return Math.round((rowSum(r) - y) / y * 100) }
}
