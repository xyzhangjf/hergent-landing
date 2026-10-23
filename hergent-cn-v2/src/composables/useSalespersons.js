import { ref } from 'vue'
import { reportsApi } from '../api/modules'

/**
 * 报单人（业务员）下拉字典 —— **唯一读取口**。
 *
 * 供销售订单汇总 / 客户销额排名 / 商品销售汇总等页共用，避免每页各写一份取数。
 *
 * 🔴 字典来源只能是「销售订单里真实出现过的 operator_id」（`/api/reports/salespersons`）：
 *    `hr_employees` ∪ `report_mapping.report_alias` 与真实报单人**互不包含** ——
 *    实测 tenant_1 里「尹红燕 / 李琴 / 秦小芳」三个真实报单人不在那两套字典中，
 *    而那两套字典里又有 18 个从来没报过单的名字。拿员工档案当下拉 = 漏人 + 多废项。
 *
 * fail-safe：取不到就是空数组，下拉只剩「全部业务员」，绝不阻塞页面渲染。
 */
export function useSalespersons() {
  const salespersons = ref([])
  const spLoading = ref(false)

  async function loadSalespersons() {
    spLoading.value = true
    try {
      const d = await reportsApi.salespersons()
      const items = (d && d.items) || []
      salespersons.value = Array.isArray(items) ? items : []
    } catch {
      salespersons.value = []
    } finally {
      spLoading.value = false
    }
  }

  return { salespersons, spLoading, loadSalespersons }
}
