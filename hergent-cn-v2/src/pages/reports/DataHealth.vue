<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>数据健康自检</h2>
        <span class="page-sub">
          8 项不变量 · 每次改完账务或库存都来这一页看一眼
        </span>
      </div>
      <div class="rpt-acts">
        <span v-if="checkedAt" class="dh-stamp">检查于 {{ checkedAt }}</span>
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
      <!-- 摘要：四态各多少张 -->
      <div class="card kpi-strip cols-4">
        <div v-for="s in summary" :key="s.key" class="kpi">
          <div class="kpi-label">{{ s.label }}</div>
          <div class="kpi-val" :class="s.cls">{{ s.n }}</div>
          <div class="kpi-sub">{{ s.sub }}</div>
        </div>
      </div>

      <!-- 口径说明：这一段是给「看不懂为什么是黄灯」的人准备的 -->
      <div class="card dh-legend">
        <b>怎么看这一页：</b>
        <span class="dh-chip st-pass">通过</span>判据成立 ·
        <span class="dh-chip st-warn">提醒</span>数字不好看，但配置允许（比如负库存） ·
        <span class="dh-chip st-fail">不平</span>真的对不上，要查 ·
        <span class="dh-chip st-unavailable">算不了</span>结构上缺东西，要等后续开发
      </div>

      <div v-for="c in cards" :key="c.key" class="card dh-card" :class="'st-' + c.status">
        <div class="dh-hd">
          <span class="dh-dot"></span>
          <span class="dh-title">{{ c.title }}</span>
          <span class="dh-badge">{{ statusText(c.status) }}</span>
          <span class="dh-headline">{{ c.headline }}</span>
        </div>

        <div v-if="numEntries(c).length" class="dh-nums">
          <div v-for="kv in numEntries(c)" :key="kv[0]" class="dh-num">
            <span class="dh-nk">{{ numLabel(kv[0]) }}</span>
            <span class="dh-nv">{{ fmtNum(kv[0], kv[1]) }}</span>
          </div>
        </div>

        <p v-if="c.why" class="dh-why">{{ c.why }}</p>
        <p v-if="c.hint" class="dh-hint"><b>怎么修：</b>{{ c.hint }}</p>

        <div v-if="c.rows && c.rows.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th v-for="col in c.columns" :key="col" :class="numCol(col) ? 'num' : ''">
                  {{ colLabel(col) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in c.rows" :key="i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td v-for="col in c.columns" :key="col" :class="numCol(col) ? 'num' : ''">
                  {{ fmtCell(col, r[col]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="c.rows && c.rows.length" class="dh-foot">
          明细只显示前 {{ previewLimit }} 行{{ moreText(c) }}
        </p>
      </div>

      <p class="dh-note">
        判据全部在服务端计算（<code>routers/data_health.py</code>），本页只负责呈现，不做任何二次加工 ——
        界面改写判据等于让「报警器」失去意义。
      </p>
    </template>
  </div>
</template>

<script setup>
/* 数据健康自检（v720 / 开发计划 阶段1 · M5）
   ────────────────────────────────────────────────────────────
   数据源：GET /api/reports/data-health（一次取全 8 张卡）

   🔴 四条前端纪律：
   1. **不改判据**。status 由后端给，前端只映射成颜色和中文。把 warn 画成红色、
      或把 unavailable 画成绿色，都等于推翻后端判据 —— 而这一页存在的意义
      恰恰是「结论不被界面美化」。
   2. **一次请求**。不要按卡发 6 个请求：卡的结论必须来自同一个快照，
      否则会出现「凭证卡说 0 张不平、勾稽卡说差 3 块」这种自相矛盾的画面。
   3. **错误要显示**。`catch {}` 吞掉异常是本项目明令禁止的（空 catch 会让页面
      停在 spinner 上，无红字、无提示，是最难查的一类故障）。
   4. **诚实空态**。没有明细行就说清楚为什么，不画空表。
   ──────────────────────────────────────────────────────────── */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import Skeleton from '../../components/Skeleton.vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const cards = ref([])
const counted = ref({ pass: 0, warn: 0, fail: 0, unavailable: 0 })
const checkedAt = ref('')
const previewLimit = 20

/* numbers 的键 → 中文。漏了哪个就用原键名兜底（不会静默消失，但要补）。 */
const NUM_LABELS = {
  negative_rows: '负库存行数',
  negative_qty: '缺货数量合计',
  warehouses_total: '仓库总数',
  warehouses_allow_neg: '允许负库存的仓',
  inventory_qty: '台账数量合计',
  log_qty: '流水数量合计',
  diff_raw: '差额（含孤儿）',
  orphan_rows: '孤儿流水行数',
  orphan_qty: '孤儿流水数量',
  diff_ex_orphan: '差额（剔除孤儿）',
  cells_ledger: '台账格数',
  cells_log: '流水格数',
  mismatch_cells: '不符格数',
  orphan_cells: '孤儿格数',
  voucher_groups: '凭证张数',
  journal_lines: '分录行数',
  unbalanced: '不平张数',
  pnl_net_profit_sum: '利润表净利合计',
  balance_unclosed_profit: '资产负债表未结转利润',
  diff: '差额',
  balance_balanced: '资产负债表自身平衡',
  inventory_columns: '库存表列数',
  gl_inventory_balance: '总账存货科目余额',
  qty_x_cost_estimate: '数量×进价 估算值',
  cells: '库存格数',
  balance_cells: '余额格数',
  mismatch_cells: '不符格数',
  log_rows: '流水总行数',
  broken: '损坏行数',
}

/* 数值格式：int 千分位整数 / qty 数量 / money 金额 / bool 是·否 */
const NUM_FMT = {
  negative_rows: 'int', negative_qty: 'qty', warehouses_total: 'int',
  warehouses_allow_neg: 'int', inventory_qty: 'qty', log_qty: 'qty',
  diff_raw: 'qty', orphan_rows: 'int', orphan_qty: 'qty', diff_ex_orphan: 'qty',
  cells_ledger: 'int', cells_log: 'int', mismatch_cells: 'int', orphan_cells: 'int',
  voucher_groups: 'int', journal_lines: 'int', unbalanced: 'int',
  pnl_net_profit_sum: 'money', balance_unclosed_profit: 'money', diff: 'money',
  balance_balanced: 'bool', inventory_columns: 'int',
  gl_inventory_balance: 'money', qty_x_cost_estimate: 'money',
  cells: 'int', balance_cells: 'int', mismatch_cells: 'int',
  log_rows: 'int', broken: 'int',
}

const COL_LABELS = {
  product_id: '商品ID', product: '商品', warehouse_id: '仓库ID', warehouse: '仓库',
  quantity: '数量', cost_price: '进价',
  ledger_qty: '台账数量', log_qty: '流水数量', diff: '差额',
  voucher_no: '凭证号', ref_type: '来源类型', ref_id: '来源ID', lines: '行数',
  debit: '借方', credit: '贷方',
  month: '月份', net_profit: '净利', basis: '口径', source: '数据源',
  inv_qty: '库存数量', bal_qty: '余额数量', inv_value: '库存金额',
  bal_value: '余额金额', q_diff: '数量差', value_diff: '金额差',
  change_type: '变动类型', change_qty: '变动量', before_qty: '变动前数量',
  after_qty: '变动后数量', stock_value_before: '变动前金额',
  stock_value_after: '变动后金额', stock_value_difference: '金额变动',
}

const NUM_COLS = new Set(['quantity', 'cost_price', 'ledger_qty', 'log_qty', 'diff',
  'lines', 'debit', 'credit', 'net_profit', 'product_id', 'warehouse_id', 'ref_id',
  'inv_qty', 'bal_qty', 'inv_value', 'bal_value', 'q_diff', 'value_diff',
  'change_qty', 'before_qty', 'after_qty', 'stock_value_before',
  'stock_value_after', 'stock_value_difference'])

const sum = computed(() => counted.value)

const summary = computed(() => ([
  { key: 'pass', label: '通过', n: sum.value.pass || 0, cls: 'val-ok', sub: '判据成立' },
  { key: 'warn', label: '提醒', n: sum.value.warn || 0, cls: 'val-warn', sub: '配置允许，但要知情' },
  { key: 'fail', label: '不平', n: sum.value.fail || 0, cls: 'val-bad', sub: '真对不上，要查' },
  { key: 'unavailable', label: '算不了', n: sum.value.unavailable || 0, cls: 'val-grey', sub: '等后续阶段' },
]))

function statusText(s) {
  return ({ pass: '通过', warn: '提醒', fail: '不平', unavailable: '算不了' })[s] || s
}

function numEntries(c) {
  const n = (c && c.numbers) || {}
  return Object.keys(n).map(k => [k, n[k]])
}

function numLabel(k) {
  return NUM_LABELS[k] || k
}

function colLabel(c) {
  return COL_LABELS[c] || c
}

function numCol(c) {
  return NUM_COLS.has(c)
}

function fmtNum(k, v) {
  const t = NUM_FMT[k] || 'int'
  if (t === 'bool') return v === true ? '是' : (v === false ? '否' : '—')
  const n = Number(v)
  if (!isFinite(n)) return String(v ?? '—')
  if (t === 'money') {
    const abs = Math.abs(n)
    if (abs >= 10000) return '¥' + (n / 10000).toFixed(2) + ' 万'
    return '¥' + n.toFixed(2)
  }
  if (t === 'qty') {
    // 数量保留两位但去掉无意义的 .00（经销商看的是「个/箱」，不是小数）
    return Number.isInteger(n) ? n.toLocaleString('zh-CN')
      : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  }
  return n.toLocaleString('zh-CN')
}

function fmtCell(col, v) {
  if (v === null || v === undefined || v === '') return '—'
  if (col === 'debit' || col === 'credit' || col === 'net_profit') {
    const n = Number(v)
    return isFinite(n) ? n.toFixed(2) : String(v)
  }
  if (NUM_COLS.has(col)) {
    const n = Number(v)
    return isFinite(n) ? fmtNum('_qty', n) : String(v)
  }
  return String(v)
}

/* 「另有 N 项未显示」——优先用判据总数，回落到行数 */
function moreText(c) {
  const n = (c && c.numbers) || {}
  const total = Number(n.negative_rows ?? n.mismatch_cells ?? n.unbalanced ?? 0)
  if (total > previewLimit) return '（共 ' + total.toLocaleString('zh-CN') + ' 项）'
  return ''
}

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.dataHealth()
    cards.value = Array.isArray(d && d.cards) ? d.cards : []
    counted.value = (d && d.summary) || { pass: 0, warn: 0, fail: 0, unavailable: 0 }
    checkedAt.value = (d && d.checked_at) || ''
    if (!cards.value.length) err.value = '接口返回空卡列表（正常应有 8 张）'
  } catch (e) {
    err.value = (e && e.message) || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.rpt-acts { display: flex; gap: 10px; align-items: center; }
.dh-stamp { font-size: 12px; color: var(--t2); }

.dh-legend {
  margin-top: 14px; padding: 10px 14px; font-size: 12px;
  line-height: 2.1; color: var(--t2); background: var(--bg2);
}
.dh-chip {
  display: inline-block; margin: 0 4px; padding: 0 7px; border-radius: 4px;
  font-size: 11px; font-weight: 600; line-height: 18px;
}
.dh-chip.st-pass { color: var(--ok-green); background: var(--ok-green-bg); }
.dh-chip.st-warn { color: var(--warn-amber); background: var(--warn-amber-bg); }
.dh-chip.st-fail { color: var(--danger-txt); background: var(--danger-bg); }
.dh-chip.st-unavailable { color: var(--t2); background: var(--bg2); border: 1px dashed var(--bd); }

.dh-card {
  margin-top: 14px; padding: 14px 16px 12px;
  border-left: 3px solid var(--bd);
}
.dh-card.st-pass { border-left-color: var(--ok-green); }
.dh-card.st-warn { border-left-color: var(--warn-amber); }
.dh-card.st-fail { border-left-color: var(--danger-txt); }
.dh-card.st-unavailable { border-left-color: var(--bd); border-left-style: dashed; }

.dh-hd { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dh-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--t2); flex: none; }
.st-pass .dh-dot { background: var(--ok-green); }
.st-warn .dh-dot { background: var(--warn-amber); }
.st-fail .dh-dot { background: var(--danger-txt); }
.st-unavailable .dh-dot { background: var(--bd); }

.dh-title { font-size: 14px; font-weight: 600; color: var(--t1); }
.dh-badge {
  font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 4px;
  color: var(--t2); background: var(--bg2);
}
.st-pass .dh-badge { color: var(--ok-green); background: var(--ok-green-bg); }
.st-warn .dh-badge { color: var(--warn-amber); background: var(--warn-amber-bg); }
.st-fail .dh-badge { color: var(--danger-txt); background: var(--danger-bg); }
.dh-headline { font-size: 13px; color: var(--t1); margin-left: 2px; }
.st-fail .dh-headline { color: var(--danger-txt); font-weight: 600; }

.dh-nums {
  display: flex; flex-wrap: wrap; gap: 6px 22px;
  margin-top: 10px; padding: 9px 12px; background: var(--bg2); border-radius: 6px;
}
.dh-num { display: flex; flex-direction: column; gap: 1px; min-width: 92px; }
.dh-nk { font-size: 11px; color: var(--t2); }
.dh-nv { font-size: 13px; font-weight: 600; color: var(--t1); font-variant-numeric: tabular-nums; }

.dh-why, .dh-hint {
  margin: 10px 0 0; font-size: 12px; line-height: 1.95; color: var(--t2);
}
.dh-hint { color: var(--t1); }
.dh-hint b { color: var(--warn-amber); }

.dh-card .table-wrap { margin-top: 10px; }
.dh-foot { margin: 6px 2px 0; font-size: 11px; color: var(--t2); }
.dh-note {
  margin: 16px 2px 0; font-size: 11px; line-height: 1.9; color: var(--t2);
}
.dh-note code { background: var(--bg2); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
</style>
