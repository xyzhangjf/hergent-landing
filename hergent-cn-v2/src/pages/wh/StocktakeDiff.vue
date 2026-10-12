<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>{{ detail ? (detail.take_no || ('盘点差异 #' + detail.id)) : '盘点差异单' }}</h2>
        <span class="page-sub">{{ detail ? subDetail : '只看有差异的行：实盘 ≠ 账面 · 数据源为「盘点单」的期次' }}</span>
      </div>
      <div class="std-acts">
        <template v-if="detail">
          <button class="btn btn-ghost btn-sm" @click="backToList">返回列表</button>
          <button class="btn btn-ghost btn-sm" :disabled="dLoading" @click="loadDetail(detail.id)">
            <Icon name="refresh" :size="14" />刷新
          </button>
        </template>
        <template v-else>
          <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadList()">
            <Icon name="refresh" :size="14" />刷新
          </button>
          <button class="btn btn-ghost btn-sm" :disabled="loading" @click="onlyDiff = !onlyDiff">
            <Icon :name="onlyDiff ? 'check' : 'list'" :size="14" />{{ onlyDiff ? '只看有差异' : '显示全部期次' }}
          </button>
        </template>
      </div>
    </div>

    <!-- ==================== 列表模式 ==================== -->
    <template v-if="!detail">
      <template v-if="!loading && !err">
        <div class="card kpi-strip cols-4">
          <div class="kpi">
            <div class="kpi-label">有差异期次</div>
            <div class="kpi-val" :class="hasRows.length ? 'val-warn' : 'val-ok'">{{ hasRows.length }}</div>
            <div class="kpi-sub">实盘与账面不一致的期次</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">差异项合计</div>
            <div class="kpi-val">{{ sumDiffCount }}</div>
            <div class="kpi-sub">有差异的商品行数</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">净差异</div>
            <div class="kpi-val" :class="diffCls(sumDiffQty)">{{ fmtSigned(sumDiffQty) }}</div>
            <div class="kpi-sub">正 = 净盘盈，负 = 净盘亏</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">已完成期次</div>
            <div class="kpi-val val-ok">{{ cnt.completed }}</div>
            <div class="kpi-sub">差异已落到库存</div>
          </div>
        </div>

        <div v-if="!rows.length" class="card">
          <div class="state-empty">
            <div class="se-ic"><Icon name="inbox" :size="22" /></div>
            <p>还没有盘点期次。</p>
            <p class="std-empty-hint">差异单是「盘点单」的<b>结果视图</b> —— 先去「盘点单」开一期、录完实盘数，
              这里就会出现差异。</p>
          </div>
        </div>

        <div v-else-if="!hasRows.length" class="card">
          <div class="state-empty">
            <div class="se-ic"><Icon name="check" :size="22" /></div>
            <p>账实相符，没有差异。</p>
            <p class="std-empty-hint">共 {{ rows.length }} 期盘点，每一期的实盘数都等于账面数。
              要看全部期次（含无差异的）请点右上角「显示全部期次」。</p>
          </div>
        </div>

        <div v-else class="card std-card">
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th>盘点单号</th>
                  <th>状态</th>
                  <th class="num">商品行数</th>
                  <th class="num">已录数</th>
                  <th class="num">差异项</th>
                  <th class="num">净差异</th>
                  <th>完成时间</th>
                  <th style="width:96px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in listRows" :key="r.id" :class="{ 'std-nodiff': !Number(r.diff_count || 0) }">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td class="std-mono">{{ r.take_no || ('#' + r.id) }}</td>
                  <td><span class="tag" :class="r.status === 'completed' ? 'ok' : 'warn'">{{ statusText(r.status) }}</span></td>
                  <td class="num">{{ r.item_count || 0 }}</td>
                  <td class="num">
                    {{ r.counted || 0 }}<span class="std-pct">/ {{ r.item_count || 0 }}</span>
                  </td>
                  <td class="num" :class="{ 'std-bad': r.diff_count > 0 }">{{ r.diff_count || 0 }}</td>
                  <td class="num" :class="diffCls(r.diff_qty)">{{ fmtSigned(r.diff_qty) }}</td>
                  <td class="std-time">{{ r.completed_at ? dt(r.completed_at) : '—' }}</td>
                  <td>
                    <button class="std-op" :disabled="!Number(r.diff_count || 0)"
                            :title="Number(r.diff_count || 0) ? '' : '本期没有差异'"
                            @click="openDetail(r.id)">查看差异</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p class="std-foot">
          口径：本页是「盘点单」的<b>结果视图</b>，不是独立单据 —— 数据来自盘点期次的
          <b>账面数（开单时的快照）</b>与<b>实盘数（逐行录入）</b>之差。
          「净差异」= 该期所有差异行的〈实盘 − 账面〉求和，<b>正 = 净盘盈，负 = 净盘亏</b>。
          <br />⚠️ 「已完成」的期次差异<b>已经落到库存</b>（盘盈入库 / 盘亏扣减）；
          「进行中」的期次差异只是<b>预览</b>，点「完成盘点」前库存不会变。
        </p>
      </template>

      <div v-else-if="loading" class="state-empty">加载中…</div>

      <div v-else class="state-error">
        <div class="se-ic"><Icon name="alert" :size="22" /></div>
        <p>{{ err }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadList()">重试</button>
      </div>
    </template>

    <!-- ==================== 明细模式 ==================== -->
    <template v-else>
      <template v-if="!dLoading && !dErr">
        <div class="card kpi-strip cols-4">
          <div class="kpi">
            <div class="kpi-label">差异项</div>
            <div class="kpi-val" :class="diffItems.length ? 'val-bad' : 'val-ok'">{{ diffItems.length }}</div>
            <div class="kpi-sub">实盘 ≠ 账面的行</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">盘盈行</div>
            <div class="kpi-val val-ok">{{ gainRows.length }}</div>
            <div class="kpi-sub">实盘 &gt; 账面</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">盘亏行</div>
            <div class="kpi-val val-bad">{{ lossRows.length }}</div>
            <div class="kpi-sub">实盘 &lt; 账面</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">净差异</div>
            <div class="kpi-val" :class="diffCls(netDiff)">{{ fmtSigned(netDiff) }}</div>
            <div class="kpi-sub">正 = 净盘盈，负 = 净盘亏</div>
          </div>
        </div>

        <div v-if="detail.status === 'completed'" class="std-lock">
          <Icon name="check" :size="14" />本期已完成，差异已落到库存 —— 只能查看。
        </div>
        <div v-else class="std-tip">
          <Icon name="lightbulb" :size="14" />本期还在进行中，下面的差异只是<b>预览</b> ——
          回「盘点单」录完数并点「完成盘点」才会真正落到库存。
        </div>

        <div class="std-meta">
          <span><b>商品行数：</b>{{ detail.item_count || 0 }}</span>
          <span><b>已录数：</b>{{ detail.counted || 0 }}</span>
          <span><b>创建：</b>{{ dt(detail.created_at) }}</span>
          <span><b>完成：</b>{{ detail.completed_at ? dt(detail.completed_at) : '—' }}</span>
        </div>

        <div v-if="!diffItems.length" class="card">
          <div class="state-empty">
            <div class="se-ic"><Icon name="check" :size="22" /></div>
            <p>本期账实相符，没有差异行。</p>
          </div>
        </div>

        <div v-else class="card std-card">
          <div class="table-wrap">
            <table class="tbl std-tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th style="width:28%">商品</th>
                  <th>规格</th>
                  <th>单位</th>
                  <th>仓库</th>
                  <th class="num">账面数</th>
                  <th class="num">实盘数</th>
                  <th class="num">差异</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in diffItems" :key="it.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td>
                    <div class="std-name">{{ it.product_name || ('商品#' + it.product_id) }}</div>
                    <div v-if="it.product_barcode" class="std-bc">{{ it.product_barcode }}</div>
                  </td>
                  <td class="std-dim">{{ it.product_spec || '—' }}</td>
                  <td class="std-dim">{{ it.unit_label || '—' }}</td>
                  <td class="std-dim">{{ it.warehouse_name || ('仓库#' + it.warehouse_id) }}</td>
                  <td class="num">{{ fmtQty(it.system_qty) }}</td>
                  <td class="num">{{ fmtQty(it.actual_qty) }}</td>
                  <td class="num" :class="diffCls(rowDiff(it))">{{ fmtSigned(rowDiff(it)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p class="std-foot">
          「差异」= <b>实盘数 − 账面数</b>。账面数是<b>开单时</b>拍的快照 ——
          盘点期间如果有出入库，快照不会跟着变，这正是静态盘点的意义。
        </p>
      </template>

      <div v-else-if="dLoading" class="state-empty">加载中…</div>

      <div v-else class="state-error">
        <div class="se-ic"><Icon name="alert" :size="22" /></div>
        <p>{{ dErr }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadDetail(detail.id)">重试</button>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 盘点差异单（仓配管理 · 库存作业 · P2）
   ------------------------------------------------------------------
   数据源 = **P1 自建的** `/api/wh/stocktake`（`wh_stock_takes` / `wh_stock_take_items`）。
   ⚠️ 新增后端**零**：本页是纯前端视图，只做「筛 + 摊平」。

   🔴 为什么不去后端加一个 `/diff` 端点（本轮的取舍）：
      `GET /api/wh/stocktake` 列表本身已经带 `diff_count` / `diff_qty`（后端 `_take_stats` 现算），
      够做「哪些期次有差异」这一层；点到哪一期再拉 `/{tid}` 取明细。
      差异单是**低频只读**视图，N+1 只发生在「用户点开某一期」时，不在列表渲染路径上。
      ⇒ 不值得为它新增一个后端端点 + 一轮部署；**薄壳纪律优先**。
      哪天期次数量到几百上千、需要跨期次平铺差异明细，再加端点也不迟（那时才真有 N+1 问题）。

   🔴 与兄弟页的口径一致性：列表 KPI 与表格读**同一个数组**（一次拉全 + 本地计数）。
      明细页的 KPI 用后端返回的**实时** `diff_count` / `diff_qty`（`_take_stats` 现算，不落冗余列），
      但**盘盈行/盘亏行**这两个是本页自己按行算的（后端没这两个数）——
      所以那两个 KPI 的 sub 文案写清了"实盘 > 账面"的判据，不含糊。

   ⚠️ 与「静态盘点单」的分工：那一组的 `stock_freezes` 是**冻结快照 + 状态标识**，
      与这里的盘点期次**没有数据联动**。本页只读 P1 的盘点引擎。 */

import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'

const LIST_LIMIT = 50

const loading = ref(true)
const err = ref('')
const rows = ref([])
/** 默认只看有差异的期次（这页叫"差异单"）；可切到全部。 */
const onlyDiff = ref(true)

const detail = ref(null)
const dLoading = ref(false)
const dErr = ref('')
const items = ref([])

const hasRows = computed(() => rows.value.filter(r => Number(r.diff_count || 0) > 0))
const listRows = computed(() => (onlyDiff.value ? hasRows.value : rows.value))
const sumDiffCount = computed(() => hasRows.value.reduce((s, r) => s + Number(r.diff_count || 0), 0))
const sumDiffQty = computed(() => hasRows.value.reduce((s, r) => s + Number(r.diff_qty || 0), 0))
const cnt = computed(() => {
  const c = { completed: 0 }
  rows.value.forEach(r => { if (r.status === 'completed') c.completed += 1 })
  return c
})

/** 只看差异行的明细（实盘已录且 ≠ 账面）。 */
const diffItems = computed(() => items.value.filter(it => {
  if (it.actual_qty === null || it.actual_qty === undefined) return false
  return Number(it.actual_qty) !== Number(it.system_qty || 0)
}))
const gainRows = computed(() => diffItems.value.filter(it => rowDiff(it) > 0))
const lossRows = computed(() => diffItems.value.filter(it => rowDiff(it) < 0))
const netDiff = computed(() => diffItems.value.reduce((s, it) => s + rowDiff(it), 0))

const subDetail = computed(() => {
  const d = detail.value
  const st = statusText(d.status)
  return st + ' · ' + (d.status === 'completed'
    ? '差异已落到库存，只能查看'
    : '差异只是预览，完成盘点后才落库存')
})

function statusText (s) { return s === 'completed' ? '已完成' : '进行中' }
function dt (s) { return String(s || '').replace('T', ' ').slice(0, 16) }
function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}
function fmtSigned (n) {
  const v = Number(n || 0)
  if (!v) return '0'
  return (v > 0 ? '+' : '') + fmtQty(v)
}
function diffCls (n) {
  const v = Number(n || 0)
  return v > 0 ? 'std-gain' : (v < 0 ? 'std-loss' : '')
}
function rowDiff (it) { return Number(it.actual_qty || 0) - Number(it.system_qty || 0) }

async function loadList () {
  loading.value = true
  err.value = ''
  try {
    rows.value = await whApi.stocktakeList(LIST_LIMIT)
  } catch (e) {
    err.value = e.message || '盘点期次读取失败'
  } finally {
    loading.value = false
  }
}

async function loadDetail (tid) {
  dLoading.value = true
  dErr.value = ''
  try {
    const t = await whApi.stocktakeGet(tid)
    if (!t || !t.id) throw new Error('盘点期次不存在')
    detail.value = t
    items.value = Array.isArray(t.items) ? t.items : []
  } catch (e) {
    dErr.value = e.message || '差异明细读取失败'
  } finally {
    dLoading.value = false
  }
}

function openDetail (tid) {
  detail.value = { id: tid }
  items.value = []
  loadDetail(tid)
}
function backToList () {
  detail.value = null
  items.value = []
  loadList()
}

onMounted(loadList)
defineExpose({ load: loadList })
</script>

<style scoped>
/* 页面私有类一律 `std-` 前缀（仓配·盘点差异单）。 */
.std-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

.std-card { padding: 0; overflow: hidden }
.std-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.std-time { font-size: 12px; color: var(--t3) }
.std-dim { color: var(--t3); font-size: 12px }
.std-pct { color: var(--t3); font-size: 12px }
.std-bad { color: var(--dan); font-weight: 600 }

.std-gain { color: var(--ok); font-variant-numeric: tabular-nums; font-weight: 600 }
.std-loss { color: var(--dan); font-variant-numeric: tabular-nums; font-weight: 600 }

/* 无差异的期次整行压暗，一眼看出哪几期真的要处理 */
.std-nodiff td { color: var(--t3) }
.std-nodiff .std-mono { color: var(--t2) }

.std-op {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.std-op:hover { text-decoration: underline }
.std-op:disabled { color: var(--t3); cursor: not-allowed; text-decoration: none }

.std-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }
.std-empty-hint { font-size: 12px; color: var(--t3); margin-top: 6px }

.std-tip, .std-lock {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg2); color: var(--t2);
}
.std-tip { border-left: 3px solid var(--p) }
.std-lock { border-left: 3px solid var(--ok); color: var(--ok) }

.std-meta {
  display: flex; flex-wrap: wrap; gap: 18px;
  margin-bottom: 12px; font-size: 12px; color: var(--t2);
}
.std-meta b { color: var(--t3); font-weight: 500 }

.std-tbl { table-layout: fixed }
.std-tbl th { white-space: nowrap }
.std-name { font-weight: 500 }
.std-bc { font-size: 11px; color: var(--t3); font-variant-numeric: tabular-nums; margin-top: 2px }
</style>
