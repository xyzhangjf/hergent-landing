<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>账龄汇总表</h2>
        <span class="page-sub">应收账款按逾期天数分档 · 1-30 天 / 31-60 天 / 60 天以上</span>
      </div>
      <div class="rpt-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <template v-else>
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">应收合计</div>
          <div class="kpi-val">{{ fmtMoney(sumAll) }}</div>
          <div class="kpi-sub">{{ countAll }} 笔未结清</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">1-30 天</div>
          <div class="kpi-val">{{ fmtMoney(sum('1_30')) }}</div>
          <div class="kpi-sub">{{ list('1_30').length }} 笔</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">31-60 天</div>
          <div class="kpi-val val-warn">{{ fmtMoney(sum('31_60')) }}</div>
          <div class="kpi-sub">{{ list('31_60').length }} 笔</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">60 天以上</div>
          <div class="kpi-val val-bad">{{ fmtMoney(sum('60_plus')) }}</div>
          <div class="kpi-sub">{{ list('60_plus').length }} 笔</div>
        </div>
      </div>

      <!-- ⚠️ 数据完整性：这批应收全部落在 60+，根因是到期日为 2023 年且从未核销 -->
      <div v-if="staleHint" class="card rpt-warn">
        <div class="rpt-warn-hd"><Icon name="alert" :size="14" /> 数据完整性提醒</div>
        <p>
          当前 <b>{{ countAll }}</b> 笔应收<b>全部</b>落在「60 天以上」档，前两档为 0 —— 这通常不是真的全部逾期多年，
          而是这批应收的<b>到期日停留在 {{ staleDueText }}</b>，且<b>没有任何一笔登记过回款核销</b>。
          属于<b>未核销的历史挂账</b>：请先核销已收回的款项（或修正到期日），本表分档才会反映真实欠款。
        </p>
      </div>

      <div v-for="g in groups" :key="g.key" class="card rpt-card">
        <div class="sec-hd rpt-sec">
          <span>{{ g.name }}（{{ list(g.key).length }} 笔 · {{ fmtMoney(sum(g.key)) }}）</span>
        </div>
        <div v-if="list(g.key).length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>客户</th>
                <th>到期日</th>
                <th class="num">逾期天数</th>
                <th class="num">应收金额</th>
                <th class="num">已收</th>
                <th class="num">余额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in list(g.key)" :key="g.key + '-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.contact_name || '—' }}</td>
                <td>{{ fmtDate(r.due_date) }}</td>
                <td class="num">{{ r.overdue_days ?? '—' }}</td>
                <td class="num">{{ fmtMoney(r.amount) }}</td>
                <td class="num">{{ fmtMoney(r.paid_amount) }}</td>
                <td class="num" :class="Number(r.balance || 0) > 0 ? 'val-bad' : ''">{{ fmtMoney(r.balance) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="3">本页合计</td>
                <td></td>
                <td class="num">{{ fmtMoney(gtot(g.key).amount) }}</td>
                <td class="num">{{ fmtMoney(gtot(g.key).paid) }}</td>
                <td class="num">{{ fmtMoney(gtot(g.key).balance) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div v-else class="state-empty">该档暂无数据。</div>
      </div>

      <p class="rpt-foot">
        口径：只统计 <code>type='ar'</code>、状态非已结清、且 <code>amount &gt; paid_amount</code> 的应收单；
        余额 = 应收金额 − 已收金额；逾期天数 = 今天 − 到期日（到期日缺失才回退取创建日），按
        1-30 / 31-60 / 60 以上 三档归类。数据源 <code>GET /api/reports/ar-aging</code>，
        与「坏账计提」读的是同一个后端函数；前端不重算分档。
      </p>
    </template>
  </div>
</template>

<script setup>
/* 应收账龄（数据报表 › 往来账） —— 数据源：GET /api/reports/ar-aging（= db.get_ar_aging）。
   🔴 分档**不在前端算**：后端已按逾期天数归好 1_30 / 31_60 / 60_plus 三档，
      前端自己算一遍就会与「坏账计提」用的分档分岔成第二份实现。
   🔴 staleHint（数据完整性提示）是**生产实测后**加的：tenant 1 的 181 笔应收
      due_date 全为 2023-11-30 / 2023-12-31、created_at 同为 2026-06-29（批量导入）、
      paid_amount>0 的笔数为 0 ⇒ 全部落 60+。若不提示，老板会把历史挂账读成当期欠款。
      判定方式保持宽松（前两档为空 且 存在逾期 > 365 天的单），避免写死某次数据快照。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const data = ref({ '1_30': [], '31_60': [], '60_plus': [] })

const groups = [
  { key: '1_30', name: '1-30 天' },
  { key: '31_60', name: '31-60 天' },
  { key: '60_plus', name: '60 天以上' },
]

function list(k) { return Array.isArray(data.value[k]) ? data.value[k] : [] }
function sum(k) { return list(k).reduce((s, r) => s + Number(r.balance || 0), 0) }
/* 本页合计：只对当前档可见行的可加总列求和（应收 / 已收 / 余额）；逾期天数为天数，不合计。 */
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

function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}
function fmtDate(v) {
  const s = String(v || '')
  return s ? s.slice(0, 10) : '—'
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
.rpt-acts { display: flex; gap: 8px; align-items: center; }
.rpt-card { margin-top: 14px; }
.rpt-sec { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rpt-warn {
  margin-top: 14px; padding: 12px 14px;
  border-left: 3px solid var(--warn-amber); background: var(--bg2);
}
.rpt-warn-hd { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--war); font-size: 13px; }
.rpt-warn p { margin: 6px 0 0; font-size: 12px; line-height: 1.9; color: var(--t2); }
.rpt-foot { margin: 14px 2px 0; font-size: 12px; line-height: 1.9; color: var(--t2); }
.rpt-foot code { background: var(--bg2); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
</style>
