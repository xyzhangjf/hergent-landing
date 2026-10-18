import { ref, reactive } from 'vue'
import { auth } from '../api/client.js'
/* 🔴 v607：这里原本有一条 `import { rowSumOf } from '../utils/forecast/calc.js'` —— **死 import**：
   下面函数签名的形参 `rowSumOf` 把它完全遮蔽，calc.js 也从未导出过这个符号。
   生产构建里 Rollup 只当 warning（产物里编译成 undefined，行为照样对），但**本地 dev 直接起不来**：
   ESM 严格校验 ⇒ `The requested module '/src/utils/forecast/calc.js' does not provide an export named 'rowSumOf'`
   ⇒ /forecast 路由整页加载失败，症状是「点菜单 URL 变了、页面还是工作台」，极难与业务 bug 区分。 */

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
  return { MOQ_KEY, moqMap, loadMoq, saveMoq, rowMoq, rowLead, moqWarn, showMoq, syncMoq }
}
