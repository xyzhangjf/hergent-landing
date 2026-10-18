import { ref } from 'vue'
import * as XLSX from 'xlsx'
import { store, toast } from '../store'
import { rowSum } from '../utils/forecast/calc.js'

// P4-8 版本快照对比 + 快照差异导出 Excel
// 抽离自 Forecast.vue（v566）：纯逻辑，只依赖宿主注入的 cross（响应式）与 clone（深拷贝助手）。
// 注：applySnap 在父页属死代码（仅定义、无调用），抽离时一并剔除。
export function useForecastSnapshot(cross, clone) {
// P4-8 版本快照对比
const SNAP_KEY = () => 'forecast_snaps_' + (cross.value.period ? cross.value.period.id : 'default')
const snaps = ref([])
const snapCompare = ref(null)
function loadSnaps() { try { snaps.value = JSON.parse(localStorage.getItem(SNAP_KEY()) || '[]') } catch (e) { snaps.value = [] } }
async function saveSnap() {
  const name = (await store.prompt('快照名称：') || '').trim() || ('快照 ' + new Date().toLocaleString())
  let list = []
  try { list = JSON.parse(localStorage.getItem(SNAP_KEY()) || '[]') } catch (e) { list = [] }
  list.push({ name, time: Date.now(), data: clone(cross.value) })
  localStorage.setItem(SNAP_KEY(), JSON.stringify(list.slice(-10)))
  loadSnaps(); toast('已保存快照', 'ok')
}
function diffSnap(name) {
  const s = snaps.value.find(x => x.name === name); if (!s) return
  snapCompare.value = name
  const base = {}
  ;(s.data.rows || []).forEach(r => { base[r.name] = r.qtyByUnit || {} })
  cross.value.rows.forEach(r => {
    const b = base[r.name] || {}
    const d = {}
    cross.value.units.forEach(u => { const cur = parseInt(r.qtyByUnit[u.name]) || 0; const was = parseInt(b[u.name]) || 0; if (cur !== was) d[u.name] = cur - was })
    r._diff = d
  })
  toast('已对比快照「' + name + '」', 'ok')
}
function cellDiff(ri, ui) {
  const d = cross.value.rows[ri]._diff; if (!d) return 0
  return d[cross.value.units[ui].name] || 0
}

// P4-8 补充：快照差异导出 Excel
function exportDiffXlsx() {
  if (!snapCompare.value) { toast('请先在快照栏选择对比快照', 'warn'); return }
  const base = snaps.value.find(s => s.name === snapCompare.value)
  if (!base) return
  const units = cross.value.units
  const baseMap = {}
  ;(base.data.rows || []).forEach(r => { baseMap[r.name] = r.qtyByUnit || {} })
  const headers = ['商品', '当前合计', '对比合计', '合计差异']
  units.forEach(u => headers.push(u.name + '差异'))
  const data = [headers]
  cross.value.rows.forEach(r => {
    const cur = rowSum(r)
    let was = 0
    units.forEach(u => { was += parseInt((baseMap[r.name] || {})[u.name]) || 0 })
    const line = [r.name || '', cur, was, cur - was]
    units.forEach(u => {
      const c = parseInt(r.qtyByUnit[u.name]) || 0
      const w = parseInt((baseMap[r.name] || {})[u.name]) || 0
      line.push(c - w)
    })
    data.push(line)
  })
  // 合计行
  const tot = ['合计', 0, 0, 0]
  units.forEach(() => tot.push(0))
  cross.value.rows.forEach(r => {
    tot[1] += rowSum(r)
    let was = 0
    units.forEach(u => { was += parseInt((baseMap[r.name] || {})[u.name]) || 0 })
    tot[2] += was
    tot[3] += rowSum(r) - was
  })
  units.forEach((u, ui) => {
    cross.value.rows.forEach(r => {
      const c = parseInt(r.qtyByUnit[u.name]) || 0
      const w = parseInt((baseMap[r.name] || {})[u.name]) || 0
      tot[4 + ui] += c - w
    })
  })
  data.push(tot)
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '差异对比')
  XLSX.writeFile(wb, `差异对比_${snapCompare.value}.xlsx`)
  toast('已导出差异 Excel', 'ok')
}
  return { SNAP_KEY, snaps, snapCompare, loadSnaps, saveSnap, diffSnap, cellDiff, exportDiffXlsx }
}
