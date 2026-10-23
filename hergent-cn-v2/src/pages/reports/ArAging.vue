<template>
  <ReportTable
    title="账龄汇总表"
    subtitle="应收账款按逾期天数分档 · 1-30 天 / 31-60 天 / 60 天以上"
    :table-title="'账龄明细（共 ' + rows.length + ' 笔）'"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="当前没有未结清的应收单。"
    @reload="load"
  >
    <template #extra>
      <!-- ⚠️ 数据完整性提醒：原文案整段保留，只换容器（原分档 tfoot 的「应收 / 已收」合计
           已并入各档 KPI 的副行，避免重复渲染一列同样的数字）。 -->
      <div v-if="staleHint" class="card rpt-warn">
        <div class="rpt-warn-hd"><Icon name="alert" :size="14" /> 数据完整性提醒</div>
        <p>
          当前 <b>{{ countAll }}</b> 笔应收<b>全部</b>落在「60 天以上」档，前两档为 0 —— 这通常不是真的全部逾期多年，
          而是这批应收的<b>到期日停留在 {{ staleDueText }}</b>，且<b>没有任何一笔登记过回款核销</b>。
          属于<b>未核销的历史挂账</b>：请先核销已收回的款项（或修正到期日），本表分档才会反映真实欠款。
        </p>
      </div>
    </template>

    <template #footnote>
      口径：只统计 <code>type='ar'</code>、状态非已结清、且 <code>amount &gt; paid_amount</code> 的应收单；
      余额 = 应收金额 − 已收金额；逾期天数 = 今天 − 到期日（到期日缺失才回退取创建日），按
      1-30 / 31-60 / 60 以上 三档归类。数据源 <code>GET /api/reports/ar-aging</code>，
      与「坏账计提」读的是同一个后端函数；前端不重算分档。
      表格按三档顺序合并展示，「账龄档」列标出每行所属档位。
    </template>
  </ReportTable>
</template>

<script setup>
/* 应收账龄（数据报表 › 往来账） —— 数据源：GET /api/reports/ar-aging（= db.get_ar_aging）。
   🔴 分档**不在前端算**：后端已按逾期天数归好 1_30 / 31_60 / 60_plus 三档，
      前端自己算一遍就会与「坏账计提」用的分档分岔成第二份实现。
   🔴 staleHint（数据完整性提示）是**生产实测后**加的：tenant 1 的 181 笔应收
      due_date 全为 2023-11-30 / 2023-12-31、created_at 同为 2026-06-29（批量导入）、
      paid_amount>0 的笔数为 0 ⇒ 全部落 60+。若不提示，老板会把历史挂账读成当期欠款。
      判定方式保持宽松（前两档为空 且 存在逾期 > 365 天的单），避免写死某次数据快照。
   v646：外壳收编进 ReportTable。原三张分档表合并为一张（新增「账龄档」列标识归属），
      取数、分档、合计、警示判定一字未动；各档「应收 / 已收」合计并入 KPI 副行。
   🔴 不开 `filterable`：/api/reports/ar-aging 不支持 date_from/date_to，开了就是假筛选。 */
import ReportTable from '../../components/ReportTable.vue'
import Icon from '../../components/Icon.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const data = ref({ '1_30': [], '31_60': [], '60_plus': [] })

const groups = [
  { key: '1_30', name: '1-30 天' },
  { key: '31_60', name: '31-60 天' },
  { key: '60_plus', name: '60 天以上' },
]

const columns = [
  { key: 'seq', label: '序号', cls: 'num' },
  { key: 'bucket', label: '账龄档' },
  { key: 'contact_name', label: '客户' },
  { key: 'due_date', label: '到期日', fmt: 'date' },
  { key: 'overdue_days', label: '逾期天数', fmt: 'num', cls: 'num' },
  { key: 'amount', label: '应收金额', fmt: 'money', cls: 'num' },
  { key: 'paid_amount', label: '已收', fmt: 'money', cls: 'num' },
  { key: 'balance', label: '余额', fmt: 'money', cls: 'num val-bad' },
]

function list(k) { return Array.isArray(data.value[k]) ? data.value[k] : [] }
function sum(k) { return list(k).reduce((s, r) => s + Number(r.balance || 0), 0) }
/* 每档合计：只对当前档可见行的可加总列求和（应收 / 已收 / 余额）；逾期天数为天数，不合计。 */
function gtot(k) {
  const rows = list(k)
  let amount = 0, paid = 0, balance = 0
  for (const r of rows) {
    amount += Number(r.amount || 0)
    paid += Number(r.paid_amount || 0)
    balance += Number(r.balance || 0)
  }
  return { amount, paid, balance }
}

/* 三档顺序铺平成一表；空值统一转成空串，交给骨架 fmt 显示「—」，避免出现 NaN。 */
const rows = computed(() => {
  const out = []
  for (const g of groups) {
    for (const r of list(g.key)) {
      out.push({
        ...r,
        seq: out.length + 1,
        bucket: g.name,
        contact_name: r.contact_name || '',
        due_date: String(r.due_date || '').slice(0, 10),
        overdue_days: r.overdue_days ?? '',
        amount: Number(r.amount || 0),
        paid_amount: Number(r.paid_amount || 0),
        balance: Number(r.balance || 0),
      })
    }
  }
  return out
})

const countAll = computed(() => groups.reduce((s, g) => s + list(g.key).length, 0))
const sumAll = computed(() => groups.reduce((s, g) => s + sum(g.key), 0))

/** 前两档为空 + 存在逾期超过 365 天的单 ⇒ 高度疑似未核销的历史挂账 */
const staleHint = computed(() => {
  if (list('1_30').length || list('31_60').length) return false
  return list('60_plus').some(r => Number(r.overdue_days || 0) > 365)
})

const staleDueText = computed(() => {
  const ds = list('60_plus').map(r => String(r.due_date || '')).filter(Boolean).sort()
  if (!ds.length) return '很早以前'
  return ds[0] === ds[ds.length - 1] ? ds[0] : (ds[0] + ' 至 ' + ds[ds.length - 1])
})

const kpis = computed(() => [
  { label: '应收合计', value: fmtMoney(sumAll.value), sub: `${countAll.value} 笔未结清` },
  ...groups.map(g => ({
    label: g.name,
    value: fmtMoney(sum(g.key)),
    sub: `${list(g.key).length} 笔 · 应收 ${fmtMoney(gtot(g.key).amount)} · 已收 ${fmtMoney(gtot(g.key).paid)}`,
  })),
])

function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.arAging()
    data.value = {
      '1_30': Array.isArray(d && d['1_30']) ? d['1_30'] : [],
      '31_60': Array.isArray(d && d['31_60']) ? d['31_60'] : [],
      '60_plus': Array.isArray(d && d['60_plus']) ? d['60_plus'] : [],
    }
  } catch (e) {
    err.value = (e && e.message) || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 仅保留仍被引用的私有类：警示卡挂在 ReportTable 的 #extra 插槽里，插槽内容在本页作用域编译，
   故这里的作用域样式照样生效。 */
.rpt-warn { margin-top: 14px; padding: 12px 14px; border-left: 3px solid var(--warn-amber); background: var(--bg2); }
.rpt-warn-hd { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--war); font-size: 13px; }
.rpt-warn p { margin: 6px 0 0; font-size: 12px; line-height: 1.9; color: var(--t2); }
</style>
