import { ref, reactive } from 'vue'
import { auth } from '../api/client.js'
import { rowSumOf } from '../utils/forecast/calc.js'

// 最小起订量 / 到货周期（MOQ & lead days）本地配置
// 抽离自 Forecast.vue（v567）：纯逻辑，依赖宿主 cross + rowSumOf。
export function useForecastMoq(cross, rowSumOf) {
const MOQ_KEY = () => 'forecast_moq_' + (auth.user?.id || 'default')
const moqMap = reactive({})
function loadMoq() { try { Object.assign(moqMap, JSON.parse(localStorage.getItem(MOQ_KEY()) || '{}')) } catch (e) {} }
function saveMoq() { localStorage.setItem(MOQ_KEY(), JSON.stringify(moqMap)) }
function rowMoq(r) { return Number(moqMap[r.product_id]?.moq) || 0 }
function rowLead(r) { return Number(moqMap[r.product_id]?.lead_days) || 0 }
function moqWarn(r) { const m = rowMoq(r); return m > 0 && rowSumOf(r) < m ? 'below' : '' }
const showMoq = ref(false)
function syncMoq() {
  cross.value.rows.forEach(r => { if (r.product_id) moqMap[r.product_id] = { moq: Number(r.moq) || 0, lead_days: Number(r.lead_days) || 0 } })
  saveMoq()
}
}
