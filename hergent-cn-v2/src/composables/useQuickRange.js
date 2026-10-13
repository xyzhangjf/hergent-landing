/* v496：进销存列表页「快捷时间档」共享逻辑 —— 采购 / 销售 / 调拨三页共用。
   基准实现逐字上提自 InvPurchaseList.vue（v479 P0-2），本仓三页各写一份必然漂移。
   🔴 三页共用件：改口径（档位 / 日期算法 / 重拉时机）必须同时核对三处调用方。
   🔴 时区：日期一律**本地时区**切片。⛔ 不用 toISOString() 直接取 UTC ——
      北京时间凌晨 0–8 点会把"今天"算成昨天（用户按日期归档会以为导错了）。 */
import { ref } from 'vue'

/**
 * @param {import('vue').Ref<Object>} f      页面筛选对象（需含 date_from / date_to）
 * @param {Function} reload                   重拉函数（通常就是页面的 load）
 * @returns quickRange 只用于芯片高亮；真实值落在 f.date_from/date_to
 *          （与手动填日期框同一条路径，不另造一份状态）。 */
export function useQuickRange (f, reload) {
  const quickRange = ref('')

  function toLocalISO (d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    return z.toISOString().slice(0, 10)
  }
  function setDateRange (r) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const fmt = toLocalISO(today)
    if (r === 'today') { f.value.date_from = fmt; f.value.date_to = fmt }
    else if (r === 'yesterday') { const y = new Date(today); y.setDate(today.getDate() - 1); const yf = toLocalISO(y); f.value.date_from = yf; f.value.date_to = yf }
    else if (r === '7') { const s = new Date(today); s.setDate(today.getDate() - 6); f.value.date_from = toLocalISO(s); f.value.date_to = fmt }
    else if (r === '30') { const s = new Date(today); s.setDate(today.getDate() - 29); f.value.date_from = toLocalISO(s); f.value.date_to = fmt }
    quickRange.value = r
    reload()
  }
  /** 「全部」档：清空两个日期框并重拉。 */
  function clearDateRange () { f.value.date_from = ''; f.value.date_to = ''; quickRange.value = ''; reload() }
  /** 手动改日期框 ⇒ 清芯片高亮（否则"芯片亮着但区间不对"，v479 起的行为）。 */
  function onDateManual () { quickRange.value = ''; reload() }
  /** 模板里 `<QuickRangeChips @pick="pickRange">` 直接接这个；`''` = 全部。 */
  function pickRange (k) { if (k === '') clearDateRange(); else setDateRange(k) }

  return { quickRange, setDateRange, clearDateRange, onDateManual, pickRange }
}
