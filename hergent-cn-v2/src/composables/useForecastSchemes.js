import { ref } from 'vue'
import { auth } from '../api/client.js'
import { toast } from '../store'
import { columnSchemeApi } from '../api/modules'

// 列方案（列顺序 / 可见性）云端 + 本地兜底
// 抽离自 Forecast.vue（v567）：纯逻辑，依赖宿主 clone + colOrder + colVis + _persistCols。
export function useForecastSchemes(clone, colOrder, colVis, _persistCols) {
const SCHEME_KEY = () => 'forecast_col_schemes_' + (auth.user?.id || 'default')
const schemes = ref([])
const schemeName = ref('')
const schemeSaveName = ref('')    // 「保存当前」时输入的新方案名（独立于下拉选中的 schemeName）
async function loadSchemes() {
  try {
    const d = await columnSchemeApi.list()           // 后端随租户配方下发（跨设备同步）
    if (d && Array.isArray(d.schemes)) { schemes.value = d.schemes; return }  // 后端成功即以云端为准（含空数组）
  } catch (e) { /* 后端未部署/出错，回退本地 */ }
  try { schemes.value = JSON.parse(localStorage.getItem(SCHEME_KEY()) || '[]') } catch (e) { schemes.value = [] }
}
async function saveScheme() {
  const n = (schemeSaveName.value || '').trim(); if (!n) { toast('请输入方案名', 'warn'); return }
  const item = { name: n, order: clone(colOrder.value), vis: clone(colVis.value) }
  const i = schemes.value.findIndex(x => x.name === n); if (i >= 0) schemes.value[i] = item; else schemes.value.push(item)
  localStorage.setItem(SCHEME_KEY(), JSON.stringify(schemes.value))   // 本地兜底
  // 云端同步失败不说成成功：本地已落盘，但换设备/清缓存后会丢，须让用户知道
  let cloudOk = true
  try { await columnSchemeApi.save(schemes.value) } catch (e) { cloudOk = false }
  schemeName.value = n          // 保存后下拉自动选中刚保存的方案
  schemeSaveName.value = ''     // 清空输入框
  toast(cloudOk ? '已保存列方案「' + n + '」' : '已存到本地，但云端同步失败（换设备不可用）', cloudOk ? 'ok' : 'warn')
}
function applyScheme(name) {
  const s = schemes.value.find(x => x.name === name); if (!s) return
  colOrder.value = clone(s.order); colVis.value = clone(s.vis); _persistCols(); toast('已应用方案「' + name + '」', 'ok')
}
async function delScheme(name) {
  if (!name) return
  schemes.value = schemes.value.filter(x => x.name !== name)
  localStorage.setItem(SCHEME_KEY(), JSON.stringify(schemes.value)) // 本地兜底
  if (schemeName.value === name) schemeName.value = ''
  let cloudOk = true
  try { await columnSchemeApi.save(schemes.value) } catch (e) { cloudOk = false }
  toast(cloudOk ? '已删除方案「' + name + '」' : '已删除本地方案，但云端同步失败', cloudOk ? 'ok' : 'warn')
}
  return { SCHEME_KEY, schemes, schemeName, schemeSaveName, loadSchemes, saveScheme, applyScheme, delScheme }
}
