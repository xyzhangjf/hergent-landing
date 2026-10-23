<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>{{ title }}</h2>
        <span class="page-sub">{{ subtitle }}</span>
      </div>
      <div class="rpt-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="$emit('reload')">
          <Icon name="refresh" :size="14" />刷新
        </button>
        <!-- v643 P1-②：内置导出。一次实现 ⇒ 所有用 ReportTable 的报表页同时获得导出能力
             （此前 41 个报表页只有 1 个能导）。按钮并入现有操作区，不新增主工具栏按钮。 -->
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="exportCsv">
          <Icon name="download" :size="14" />导出
        </button>
      </div>
    </div>

    <!-- v643 P0-②：统一日期筛选条。🔴 仅当 `filterable` 为真才渲染 —— 后端端点**未支持**
         date_from/date_to 的报表一律不显示，避免"看着能筛、其实没筛"的静默失效
         （FastAPI 对未声明 query 参数静默忽略）。接入顺序：**后端先支持，前端才开**。 -->
    <div v-if="filterable" class="card rpt-filter">
      <QuickRangeChips :range="quickRange" @pick="pickRange" />
      <div class="rpt-date">
        <label>从<input v-model="f.date_from" type="date" @change="onDateManual" /></label>
        <label>到<input v-model="f.date_to" type="date" @change="onDateManual" /></label>
      </div>
      <div v-if="rangeText" class="rpt-range">当前：{{ rangeText }}</div>
    </div>

    <!-- v649：维度筛选插槽（客户 / 业务员 / 品牌…）。
         🔴 与日期筛选同一条纪律：**后端不支持的维度一律不显示控件**，
            由各页自行按需声明，骨架不代为发明筛选。 -->
    <slot name="filters" />

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="$emit('reload')">重试</button>
    </div>

    <template v-else>
      <div v-if="kpis && kpis.length" class="card kpi-strip" :class="kpiCls">
        <div class="kpi" v-for="k in kpis" :key="k.label">
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-val">{{ k.value }}</div>
          <div class="kpi-sub" v-if="k.sub">{{ k.sub }}</div>
        </div>
      </div>

      <!-- v648：图表位（KPI 之后、表格之前）。只给"决策型"报表用，其余页面不放 ——
           报表是查数工具，无差别铺图会变成噪音。图表组件统一取自 components/chart/。 -->
      <slot name="chart" />

      <div class="card rpt-card">
        <div class="sec-hd rpt-sec"><span>{{ tableTitle || title }}</span></div>

        <div v-if="rows.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th v-for="c in columns" :key="c.key"
                    :class="c.cls || ((c.fmt === 'num' || c.fmt === 'money') ? 'num' : '')">{{ c.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="rowKey(r, i)">
                <td v-for="c in columns" :key="c.key"
                    :class="c.cls || ((c.fmt === 'num' || c.fmt === 'money') ? 'num' : '')">{{ fmt(r[c.key], c.fmt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="state-empty">{{ emptyHint || '暂无数据。' }}</div>
      </div>

      <!-- v646：`#extra` 插槽 —— 给「主体统一、局部特殊」的报表留口子（合计行 / 维度页签 /
           警示卡 / 第二张表）。🔴 为什么要有它：收编旧页时若骨架容不下这些结构，只能整页
           跳过 ⇒ 一致性做不下去；有了插槽，主体（标题/KPI/表/空态/口径）统一、特殊部分
           原样保留，既一致又不丢功能。 -->
      <slot name="extra" />

      <p class="rpt-foot" v-if="$slots.footnote"><slot name="footnote" /></p>
    </template>
  </div>
</template>

<script setup>
/* 通用报表展示组件（数据报表区复用）—— KPI 卡 + 冻结表 + 空态 + 口径脚注。
   🔴 纯展示：数据由调用方（各报表页）通过 reportsApi 取好传入；本组件**不发起请求、不重算**。
   🔴 columns[i].fmt 支持 text / money / num / date / rmb；money 自动按「万元」缩写、负数标红；rmb 精确金额（不缩写，用于单据明细）。
   🔴 空数据 = 真实业务状态（模块尚未使用），显式展示 emptyHint，不静默当零。 */
import Skeleton from './Skeleton.vue'
import Icon from './Icon.vue'
import QuickRangeChips from './QuickRangeChips.vue'
import { useQuickRange } from '../composables/useQuickRange'
import { ref, computed } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  tableTitle: { type: String, default: '' },
  columns: { type: Array, default: () => [] },
  rows: { type: Array, default: () => [] },
  kpis: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  err: { type: String, default: '' },
  emptyHint: { type: String, default: '暂无数据。' },
  /* v643：仅当**后端该端点已支持** date_from/date_to 时才传 true。 */
  filterable: { type: Boolean, default: false },
})
const emit = defineEmits(['reload', 'filter'])

/* v643：筛选状态与快捷档复用进销存同一套 `useQuickRange`（同一份日期算法，不另造一份）。 */
const f = ref({ date_from: '', date_to: '' })
const { quickRange, pickRange, onDateManual } = useQuickRange(f, () => {
  emit('filter', { date_from: f.value.date_from, date_to: f.value.date_to })
})
/** 当前口径回显：让用户随时知道自己在看哪一段、多少行。 */
const rangeText = computed(() => {
  if (!f.value.date_from && !f.value.date_to) return props.rows.length ? `全部数据 · 共 ${props.rows.length} 行` : ''
  const a = f.value.date_from || '不限'
  const b = f.value.date_to || '不限'
  return `${a} ~ ${b} · 共 ${props.rows.length} 行`
})

const kpiCls = 'cols-' + (props.kpis.length <= 3 ? 3 : props.kpis.length >= 6 ? 6 : String(props.kpis.length))

function rowKey(r, i) {
  return r && r.id != null ? (r.id + '-' + i) : String(i)
}

function fmt(v, t) {
  if (v === null || v === undefined || v === '') return '—'
  if (t === 'money') {
    const n = Number(v || 0)
    const s = Math.abs(n) >= 10000 ? '¥' + (n / 10000).toFixed(1) + ' 万' : '¥' + n.toFixed(2)
    return s
  }
  /* v640b：rmb = 精确金额（不缩写万元），用于单据级明细行，避免「¥1.2 万」丢精度。 */
  if (t === 'rmb') {
    return '¥' + Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (t === 'num') return Number(v).toLocaleString('zh-CN')
  if (t === 'date') return String(v)
  return String(v)
}

/* v643 P1-②：导出 CSV（Excel 友好）。
   🔴 文件头带三行元信息（报表名 / 日期范围 / 导出时间）—— 表格发出去后仍能看出"这是哪段数"，
      避免对方拿到一堆数字不知道口径。
   🔴 加 BOM（\ufeff）：不加 Excel 打开中文是乱码。含逗号/引号/换行的单元格按 CSV 规范转义。 */
function exportCsv() {
  const esc = (s) => {
    const v = s === null || s === undefined ? '' : String(s)
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
  }
  const head = props.columns.map((c) => esc(c.label)).join(',')
  const body = props.rows.map((r) => props.columns.map((c) => esc(r[c.key])).join(',')).join('\n')
  const meta = []
  if (props.title) meta.push(esc('报表名') + ',' + esc(props.title))
  if (f.value.date_from || f.value.date_to) {
    meta.push(esc('日期范围') + ',' + esc(`${f.value.date_from || '不限'} ~ ${f.value.date_to || '不限'}`))
  }
  meta.push(esc('导出时间') + ',' + esc(new Date().toLocaleString('zh-CN')))
  const csv = meta.join('\n') + '\n\n' + head + '\n' + body
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${props.title || '报表'}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<style scoped>
.rpt-acts { display: flex; gap: 8px; align-items: center; }
/* v643：日期筛选条（复用进销存 `.psi-quick` 芯片样式，不另造一套 chip）。 */
.rpt-filter { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; padding: 10px 12px; }
.rpt-date { display: flex; align-items: center; gap: 10px; }
.rpt-date label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--t2); }
.rpt-date input { padding: 5px 8px; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg); color: var(--t1); font-size: 12px; }
.rpt-range { font-size: 12px; color: var(--t2); margin-left: auto; }
.rpt-card { margin-top: 14px; }
.rpt-sec { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rpt-foot { margin: 14px 2px 0; font-size: 12px; line-height: 1.9; color: var(--t2); }
.rpt-foot :deep(code) { background: var(--bg2); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
</style>
