<template>
  <ReportTable
    title="调拨汇总表"
    subtitle="仓库间调拨单的总体、按状态与明细"
    table-title="按状态"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="暂无状态分布数据。"
    filterable
    @reload="load"
    @filter="onFilter"
  >
    <template #extra>
      <!-- 第二张表：调拨明细 —— 原样保留，骨架只承载主表。 -->
      <div class="card pts-card">
        <div class="sec-hd"><span>调拨明细</span></div>
        <div v-if="details.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th>单号</th><th>商品</th><th>调出仓 → 调入仓</th>
                <th class="num">数量</th><th>状态</th><th class="num">手续费</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in details" :key="r.id">
                <td>{{ r.order_no || '—' }}</td>
                <td>{{ r.product_name || '—' }}</td>
                <td>{{ whName(r.from_warehouse_id) }} → {{ whName(r.to_warehouse_id) }}</td>
                <td class="num">{{ fmtNum(r.quantity) }}</td>
                <td>{{ statusText(r.status) }}</td>
                <td class="num">{{ fmtMoney(r.handling_fee) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="state-empty">暂无调拨单明细。</div>
      </div>
    </template>

    <template #footnote>
      口径：统计 <code>/api/reports/transfer-summary</code>，覆盖全部调拨单；数量单位与单据一致（件 / 箱），
      金额单位元。仓库名称由 <code>/api/warehouses/full</code> 映射。当前生产仅 1 张草稿调拨单、数量为空 ——
      这是**真实业务状态**（调拨业务尚未实际开展），不是系统缺数，照实展示。
    </template>
  </ReportTable>
</template>

<script setup>
/* 调拨汇总表（数据报表）—— 数据源：GET /api/reports/transfer-summary（v634 新增只读端点）。
   🔴 口径**不在前端重算**；仓库 ID → 名称由 warehouseApi.list()（/api/warehouses/full）前端映射。
   🔴 本页**只读**；做调拨去「调拨单」模块。
   ⚠️ 生产仅 1 张草稿单、数量为空 ⇒ 如实展示，不编造数据（与「买赠活动 0 条」同族诚实空态纪律）。
   v646：外壳收编进 ReportTable（KPI / 主表=按状态 / 口径脚注）；「调拨明细」表移入 #extra，
      取数、状态映射、仓库名映射一字未动。
   🔴 金额沿用原页精确元格式（fmt 'rmb'），不缩万元。
   ✅ 开 `filterable`：v643 后端已为 /api/reports/transfer-summary 加上 date_from/date_to（按 created_at），
      本页 v651 接上内置日期筛选条，参数拼 query 交给后端算，前端绝不本地过滤。 */
import ReportTable from '../../components/ReportTable.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi, warehouseApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const s = ref({ order_count: 0, total_quantity: 0, total_handling_fee: 0 })
const byStatus = ref([])
const details = ref([])
const whMap = ref({})

/* v651：日期筛选（后端 transfer-summary 已支持 date_from/date_to，按 created_at）。拼 query 给后端算，前端不本地过滤。 */
const filter = ref({ date_from: '', date_to: '' })
function qs() {
  const p = []
  if (filter.value.date_from) p.push('date_from=' + encodeURIComponent(filter.value.date_from))
  if (filter.value.date_to) p.push('date_to=' + encodeURIComponent(filter.value.date_to))
  return p.length ? '?' + p.join('&') : ''
}
function onFilter(r) { filter.value = { ...r }; load() }

const statusMap = { draft: '草稿', confirmed: '已确认', done: '已完成', cancelled: '已作废' }
function statusText (st) { return statusMap[st] || st || '未知' }
function whName (id) { return (whMap.value && whMap.value[id]) || ('仓库#' + id) }

const columns = [
  { key: 'status_txt', label: '状态' },
  { key: 'cnt', label: '单数', fmt: 'num', cls: 'num' },
  { key: 'quantity', label: '数量', fmt: 'num', cls: 'num' },
]

const rows = computed(() => byStatus.value.map((r) => ({
  ...r,
  status_txt: statusText(r.status),
  cnt: Number(r.cnt || 0),
  quantity: Number(r.quantity || 0),
})))

const kpis = computed(() => [
  { label: '调拨单数', value: String(s.value.order_count), sub: '全部调拨单' },
  { label: '调拨总数量', value: fmtNum(s.value.total_quantity), sub: '件 / 箱（与单据一致）' },
  { label: '总手续费', value: fmtMoney(s.value.total_handling_fee), sub: '搬运 / 运费合计' },
  { label: '状态数', value: String(rows.value.length), sub: '不同单据状态' },
])

function fmtMoney (n) {
  const v = Number(n || 0)
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtNum (n) {
  const v = Number(n || 0)
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const [d, whs] = await Promise.all([
      reportsApi.transferSummary(qs()),
      warehouseApi.list().catch(() => [])
    ])
    const sum = d.summary || {}
    s.value = {
      order_count: Number(sum.order_count || 0),
      total_quantity: Number(sum.total_quantity || 0),
      total_handling_fee: Number(sum.total_handling_fee || 0)
    }
    byStatus.value = Array.isArray(d.by_status) ? d.by_status : []
    details.value = Array.isArray(d.details) ? d.details : []
    const m = {}
    if (Array.isArray(whs)) {
      for (const w of whs) { if (w && w.id != null) m[w.id] = w.name || ('仓库#' + w.id) }
    }
    whMap.value = m
  } catch (e) {
    err.value = (e && e.message) || '调拨汇总读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 仅保留仍被引用的私有类（第二张表挂在 #extra 插槽，插槽内容在本页作用域编译）。 */
.pts-card { margin-top: 14px }
</style>
