<template>
  <div class="page">
    <!-- v701：下探路径（面包屑）。🔴 只在**确实有层级**的报表上传（明细页），
         汇总页不传就不渲染 —— 不给纯视图页凭空造一层"上级"。
         末级（当前页）不可点，其余级可回跳，这是「返回上一级」的显式入口。 -->
    <nav v-if="breadcrumb && breadcrumb.length" class="rpt-crumb" aria-label="当前位置">
      <template v-for="(b, i) in breadcrumb" :key="i">
        <!-- 🔴 三态必须分清（v701 探针当场抓到）：末级 = 当前页（加粗 + aria-current）；
             中间级有 `to` = 可回跳；中间级没 `to` = **只是路径文字**（如侧栏分组「数据报表」
             没有独立首页），不能也算"当前页" —— 否则屏幕阅读器会说「当前页面：数据报表」，
             而且两级都加粗，一眼看不出自己在哪一级。 -->
        <button v-if="b.to && i < breadcrumb.length - 1" type="button" class="rpt-crumb-a" @click="goTo(b.to)">{{ b.label }}</button>
        <span v-else-if="i < breadcrumb.length - 1" class="rpt-crumb-txt">{{ b.label }}</span>
        <span v-else class="rpt-crumb-cur" aria-current="page">{{ b.label }}</span>
        <Icon v-if="i < breadcrumb.length - 1" name="chevron-right" :size="12" class="rpt-crumb-sep" />
      </template>
    </nav>

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
                    :class="c.cls || ((c.fmt === 'num' || c.fmt === 'money') ? 'num' : '')">
                  <!-- v701 下探：列声明 `drill` 且该行有主键时，值渲染成可点链接。
                       🔴 判据是 `r.id != null`：报表接口必须真的返回主键（v701 三个端点已补）。
                          拿 order_no 当 id 拼地址会 404 或打开别人的单 —— 所以没 id 就**不渲染成链接**，
                          宁可显示成普通文本，也不给一个点了会错的入口。 -->
                  <button v-if="c.drill && r.id != null" type="button" class="rpt-drill"
                          :title="'查看该' + drillName(c.drill) + '的完整明细'"
                          @click="openDrill(r, c)">{{ fmt(r[c.key], c.fmt) }}</button>
                  <template v-else>{{ fmt(r[c.key], c.fmt) }}</template>
                </td>
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
   🔴 空数据 = 真实业务状态（模块尚未使用），显式展示 emptyHint，不静默当零。

   v701（2026-10-27）**下探三件套**，只为「有层级」的报表提供，纯汇总页不传即不启用：
     ① `columns[i].drill = 'sale' | 'purchase'` → 该列值渲染成可点链接，跳对应单据详情页；
     ② `breadcrumb = [{label, to}]` → 顶部路径条，末级不可点（当前页），其余可回跳；
     ③ `persistKey = 'xxx'` → 把日期筛选存 sessionStorage，从单据页回来时**筛选不丢**。
   🔴 三者都**不自己造数据**：id 由后端给（v701 三个明细端点已补），路径由 DRILL_BASE 给，
      筛选值就是本组件已有的 `f`。组件不猜、不重算。 */
import Skeleton from './Skeleton.vue'
import Icon from './Icon.vue'
import QuickRangeChips from './QuickRangeChips.vue'
import { useQuickRange } from '../composables/useQuickRange'
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'

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
  /* v701：下探路径。末级不做跳转（无 `to`），其余级可点回上级。不传 = 不渲染。 */
  breadcrumb: { type: Array, default: () => [] },
  /* v701：筛选持久化键。传了才存 sessionStorage（从单据页回来时日期筛选不丢）。 */
  persistKey: { type: String, default: '' },
})
const emit = defineEmits(['reload', 'filter'])

const router = useRouter()

/* v701：下探目标。🔴 只登记**确实有详情页**的单据：
   /inventory/sale/:id（InvSaleDetail）、/inventory/purchase/:id（InvPurchaseDetail）。
   调拨单没有详情页（行本身就是商品级），故不进这张表 —— 不给点了会 404 的入口。 */
const DRILL_BASE = {
  sale: '/inventory/sale/',
  purchase: '/inventory/purchase/',
}
const DRILL_NAME = {
  sale: '销售单',
  purchase: '采购单',
}

function drillName(type) {
  return DRILL_NAME[type] || '单据'
}

/* 跳到单据详情页，并把「我现在在哪张报表、什么筛选」交给详情页（history.state）。
   详情页据此把「返回列表」换成「返回报表」—— 这就是「返回上一级」的落点。 */
function openDrill(r, c) {
  const base = DRILL_BASE[c.drill]
  if (!base || !r || r.id == null) return
  router.push({
    path: base + r.id,
    state: { fromReport: router.currentRoute.value.fullPath }
  })
}

function goTo(to) {
  if (to) router.push(to)
}

/* v643：筛选状态与快捷档复用进销存同一套 `useQuickRange`（同一份日期算法，不另造一份）。 */
const f = ref({ date_from: '', date_to: '' })
const { quickRange, pickRange, onDateManual } = useQuickRange(f, () => {
  emit('filter', { date_from: f.value.date_from, date_to: f.value.date_to })
})

/* v701：筛选持久化。返回报表时不该从"全部数据"重新开始 —— 老板是看完一张单
   接着看下一张，把区间丢了等于每次都要重选。
   ⚠️ 这两段必须在 `f` 定义**之后**：`watch(f)` 若写在 `f` 之前会撞 TDZ，
      表现为整页白屏（不是报错提示），极易被误判成"部署坏了"。 */
const STORE_PREFIX = 'hg_rpt_filter:'
watch(f, (v) => {
  if (!props.persistKey) return
  try {
    sessionStorage.setItem(
      STORE_PREFIX + props.persistKey,
      JSON.stringify({ date_from: v.date_from || '', date_to: v.date_to || '' })
    )
  } catch (_) { /* 隐私模式禁用 storage 时静默跳过，不影响主流程 */ }
}, { deep: true })

/* 回填在 mounted 做一次。⚠️ 只在**真有值**时才 emit filter —— 没有历史筛选却 emit，
   会让父页多打一次空筛选请求。 */
onMounted(() => {
  if (!props.persistKey) return
  try {
    const raw = sessionStorage.getItem(STORE_PREFIX + props.persistKey)
    if (!raw) return
    const v = JSON.parse(raw) || {}
    const df = String(v.date_from || '')
    const dt = String(v.date_to || '')
    if (!df && !dt) return
    f.value = { date_from: df, date_to: dt }
    emit('filter', { date_from: df, date_to: dt })
  } catch (_) { /* 坏数据当作没有 */ }
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

/* ===== v701 下探：面包屑 + 单据链接 ===== */
/* 面包屑：末级是当前位置（不可点），前几级可回跳。刻意不用大字号 —— 它是路径提示，
   不是标题（标题在下面 h2 里），两级同样大反而看不出层级。 */
.rpt-crumb { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; margin-bottom: 8px; font-size: 12px; color: var(--t2) }
.rpt-crumb-a {
  background: none; border: 0; padding: 2px 4px; font-family: inherit;
  font-size: 12px; color: var(--p); cursor: pointer; border-radius: 4px;
}
.rpt-crumb-a:hover { background: var(--p-bg); text-decoration: underline }
.rpt-crumb-cur { padding: 2px 4px; color: var(--t1); font-weight: 600 }
/* 中间级但无跳转目标（如侧栏分组）—— 是路径文字，不是当前页，不加粗。 */
.rpt-crumb-txt { padding: 2px 4px; color: var(--t2) }
.rpt-crumb-sep { color: var(--t3); flex-shrink: 0 }

/* 单据号链接：虚下线表示"可点"，hover 变实线。不用蓝色粗体 —— 一列全是链接时会抢掉
   金额列的视觉重心（报表里老板先看的是数字，其次才是单号）。 */
.rpt-drill {
  background: none; border: 0; padding: 0; margin: 0; font: inherit;
  color: var(--p); cursor: pointer; text-align: left; line-height: 1.6;
  border-bottom: 1px dashed currentColor;
}
.rpt-drill:hover { color: var(--p-dark); border-bottom-style: solid }
.rpt-drill:focus-visible { outline: 2px solid var(--p); outline-offset: 2px; border-radius: 2px }

/* ===== v701 移动端（≤760px） =====
   表格本身保持横向滚动（列多是事实，挤成两行反而更难读），
   但把筛选条与面包屑改成竖排、把单据号的可点区域放大到 28px 以上（手指点得中）。 */
@media (max-width: 760px) {
  .rpt-crumb { font-size: 11px; margin-bottom: 6px }
  .rpt-crumb-a, .rpt-crumb-cur, .rpt-crumb-txt { padding: 4px 3px }
  .rpt-filter { gap: 8px; padding: 8px 10px }
  .rpt-date { flex-wrap: wrap; gap: 6px }
  .rpt-range { margin-left: 0; width: 100% }
  .rpt-drill { display: inline-flex; align-items: center; min-height: 28px }
  /* 标题栏右侧两个按钮：窄屏下被挤成「刷/新」「导/出」各占两行（真机截图看到）。
     nowrap 让它保持一行，整组允许换行到下一行去。 */
  .rpt-acts { flex-wrap: wrap }
  .rpt-acts .btn { white-space: nowrap }
}
</style>
