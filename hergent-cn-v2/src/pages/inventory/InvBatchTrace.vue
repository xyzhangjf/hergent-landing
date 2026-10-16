<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>批次追溯</h2>
        <span class="page-sub">输入批次号，查看该批货的入库来源、出库去向与召回影响</span>
      </div>
    </div>

    <!-- 搜索区：支持 URL query ?batch=xxx 进入即自动查一次（见 script onMounted） -->
    <div class="card ibt-search">
      <input v-model.trim="batchNo" class="input ibt-input" placeholder="请输入批次号"
             @keyup.enter="trace" />
      <button class="btn btn-primary" :disabled="loading || !batchNo" @click="trace">追溯</button>
    </div>

    <!-- 未搜索 -->
    <div v-if="!searched && !loading" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="package" :size="22" /></div>
        <p>输入批次号开始追溯</p>
      </div>
    </div>

    <!-- 搜索中 -->
    <div v-else-if="loading" class="state-empty">追溯中…</div>

    <!-- 失败 -->
    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="trace">重试</button>
    </div>

    <!-- 结果区 -->
    <template v-else-if="data">
      <!-- 诚实空态守卫：入库 / 出库 / 在库 三项全空 ⇒ 明说「没有记录」，
           绝不许把空数据显示成「一切正常」（导入/补录数据不经系统收货也会这样） -->
      <div v-if="isEmpty" class="card">
        <div class="state-empty">
          <div class="se-ic"><Icon name="alert" :size="22" /></div>
          <p>未找到批次 {{ batchNo }} 的系统内记录。若该批次确有货，可能是导入/补录数据，未经系统确认收货或销售出库。</p>
        </div>
      </div>
      <template v-else>
        <!-- 概况卡 -->
        <div class="card kpi-strip cols-3">
          <div class="kpi">
            <div class="kpi-label">累计入库</div>
            <div class="kpi-val">{{ fmtQty(data.total_in) }}</div>
            <div class="kpi-sub">按商品档案单位</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">累计出库</div>
            <div class="kpi-val">{{ fmtQty(data.total_out) }}</div>
            <div class="kpi-sub">按商品档案单位</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">当前在库</div>
            <div class="kpi-val">{{ fmtQty(stockTotal) }}</div>
            <div class="kpi-sub">成本价合计 ¥{{ fmtMoney(stockCost) }}</div>
          </div>
        </div>

        <!-- 当前在库明细（多行则小表；单行时概况卡已够，仍列出到期日与成本价） -->
        <div v-if="stockRows.length" class="card ibt-card">
          <div class="sec-hd">当前在库明细</div>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr><th>商品</th><th class="num">数量</th><th>到期日</th><th class="num">成本价</th></tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in stockRows" :key="i">
                  <td>{{ r.product_name || '—' }}</td>
                  <td class="num">{{ fmtQty(r.quantity) }}</td>
                  <td>{{ r.expiry_date || '—' }}</td>
                  <td class="num">¥{{ fmtMoney(r.cost_price) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 出入库记录表：inbound（方向=入库）+ outbound（方向=出库）按时间倒序 -->
        <div class="card ibt-card">
          <div class="sec-hd">出入库记录<span class="sec-sub">按时间倒序，共 {{ moves.length }} 笔</span></div>
          <div class="table-wrap freeze-list">
            <table class="tbl">
              <thead>
                <tr><th>方向</th><th>商品</th><th class="num">数量</th><th>单据类型</th><th>单据编号</th><th>对方</th><th>时间</th></tr>
              </thead>
              <tbody>
                <tr v-for="(m, i) in moves" :key="i">
                  <td><span class="tag" :class="m.direction === 'in' ? 'ok' : 'warn'">{{ m.direction === 'in' ? '入库' : '出库' }}</span></td>
                  <td>{{ m.product_name || ('商品 ' + m.product_id) }}</td>
                  <td class="num">{{ fmtQty(m.quantity) }}</td>
                  <td>{{ refTypeText(m.ref_type) }}</td>
                  <td>{{ m.ref_no || '—' }}</td>
                  <td>{{ m.contact_name || '—' }}</td>
                  <td>{{ m.created_at || '—' }}</td>
                </tr>
                <tr v-if="!moves.length">
                  <td colspan="7" class="ibt-empty">系统内没有该批次的出入库流水</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 召回影响区 -->
        <div class="card ibt-card">
          <div class="sec-hd">召回影响<span class="sec-sub">以下客户收到过该批次，如需召回按电话联系</span></div>
          <!-- v531（QA P2-6）：后端 get_recall_affected_customers 用
               LEFT JOIN contacts ON contact_name=name 按**客户名**匹配电话 ——
               联系人重名时电话可能错配，必须明示让人工核对 -->
          <p class="ibt-hint">召回清单按客户名匹配电话，若客户重名请人工核对后再联系。</p>
          <div v-if="recallLoading" class="state-empty">正在查召回清单…</div>
          <div v-else-if="recallErr" class="state-error">
            <p>{{ recallErr }}</p>
            <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadRecall(tracedNo)">重试</button>
          </div>
          <div v-else-if="!recall.length" class="state-empty">系统内无该批次的销售出库记录，无客户受影响</div>
          <div v-else class="table-wrap">
            <table class="tbl">
              <thead>
                <tr><th>客户</th><th>电话</th><th>单据编号</th><th class="num">数量</th><th>时间</th></tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in recall" :key="i">
                  <td>{{ c.contact_name || '—' }}</td>
                  <td>{{ c.phone || '—' }}</td>
                  <td>{{ c.ref_no || '—' }}</td>
                  <td class="num">{{ fmtQty(c.quantity) }}</td>
                  <td>{{ c.created_at || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
/* 批次追溯查询页（v529 · P1-5）。
   数据源（后端均已生产部署）：
     · GET /api/batch-trace/{batch_no}         → 批次全链路（入库/出库/在库）
     · GET /api/batch/recall-impact/{batch_no} → 召回影响客户清单
   🔴 诚实空态：入库 / 出库 / 在库 三项全空 ⇒ 明确告诉用户「系统内没有记录」，
      并提示可能是导入/补录数据 —— 绝不许把空数据显示成「一切正常」。
   🔴 召回清单失败单独兜底（recallErr），不拽翻主结果区。 */
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { batchTraceApi } from '../../api/batchTrace'
import { fmtMoney } from '../../constants/psiLabels'

const route = useRoute()

const batchNo = ref('')
/* v531（QA P2-1）tracedNo：本次追溯**实际生效**的批次号。输入框可能被用户
   清空/改写，召回区的「重试」只认 tracedNo —— 否则重试会拿当前输入框
   （甚至空值）去拉召回清单，错批次或空转。 */
const tracedNo = ref('')
/* v531（QA P2-1）traceSeq：单调递增令牌。连续追溯 A→B 时，A 的召回响应
   可能晚于 B 到达 ⇒ 不设令牌就会用旧批次数据覆盖新结果。 */
const traceSeq = ref(0)
/* searched 在点击「追溯」时即置真 —— 否则失败后 v-if 链会退回「输入批次号开始追溯」，
   错误信息永远露不出来（v-else-if 顺序依赖）。 */
const searched = ref(false)
const loading = ref(false)
const err = ref('')
const data = ref(null)

/* 单据类型中文映射（ref_type 是后端英文枚举，界面上一律不出现英文） */
const REF_TYPE_TEXT = {
  purchase_order: '采购入库',
  sale_order: '销售出库',
  stocktake: '盘点',
  adjust: '调整',
  purchase_return: '采购退货',
  sale_return: '销售退货',
}
function refTypeText (v) {
  if (!v) return '—'
  // v531（QA P2-2）：未收录的 ref_type 不再回落英文原值 —— 界面一律不出现英文
  return REF_TYPE_TEXT[v] || '其他单据'
}

/* 数量格式化：整数千分位（与 InvStock.vue 的 fmtQty 同口径） */
function fmtQty (n) { return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }

/* 出入库合成表：inbound + outbound 按 created_at 倒序（库内格式为 'YYYY-MM-DD HH:MM:SS'，
   字典序即时间序，无需解析 Date） */
const moves = computed(() => {
  const d = data.value
  if (!d) return []
  const inb = (d.inbound || []).map(r => ({ ...r, direction: 'in' }))
  const outb = (d.outbound || []).map(r => ({ ...r, direction: 'out' }))
  return [...inb, ...outb].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
})

const stockRows = computed(() => (data.value && data.value.current_stock) || [])

/* 诚实空态守卫：入库、出库、在库 三项全空才算「没有记录」 */
const isEmpty = computed(() => {
  const d = data.value
  if (!d) return false
  return !(d.inbound || []).length && !(d.outbound || []).length && !stockRows.value.length
})

const stockTotal = computed(() => stockRows.value.reduce((s, r) => s + Number(r.quantity || 0), 0))
const stockCost = computed(() => stockRows.value.reduce((s, r) => s + Number(r.quantity || 0) * Number(r.cost_price || 0), 0))

/* 召回影响（单独拉取，失败不拽翻主结果） */
const recall = ref([])
const recallLoading = ref(false)
const recallErr = ref('')

async function trace () {
  const no = (batchNo.value || '').trim()
  if (!no || loading.value) return
  searched.value = true
  loading.value = true
  err.value = ''
  data.value = null
  recall.value = []
  recallErr.value = ''
  tracedNo.value = no
  const seq = ++traceSeq.value
  try {
    const d = await batchTraceApi.full(no)
    if (seq !== traceSeq.value) return // 已被更新的追溯取代，丢弃过期响应
    data.value = d || {}
  } catch (e) {
    if (seq !== traceSeq.value) return
    err.value = e.message || '追溯失败'
  } finally {
    if (seq === traceSeq.value) loading.value = false
  }
  /* 主结果落定后再拉召回清单（不阻塞结果区渲染；主请求失败则不拉） */
  if (!err.value) loadRecall(no, seq)
}

async function loadRecall (no, seq) {
  /* v531（QA P2-1）：不再回落 batchNo.value —— 只接受显式传入的批次号；
     seq 缺省时取当前令牌（供召回区「重试」按钮使用）。 */
  const key = (no || '').trim()
  if (!key) return
  const token = seq === undefined ? traceSeq.value : seq
  recallLoading.value = true
  recallErr.value = ''
  try {
    const list = await batchTraceApi.recall(key)
    if (token !== traceSeq.value) return
    recall.value = Array.isArray(list) ? list : []
  } catch (e) {
    if (token !== traceSeq.value) return
    recallErr.value = e.message || '召回清单读取失败'
  } finally {
    if (token === traceSeq.value) recallLoading.value = false
  }
}

/* URL query ?batch=xxx 进入即自动查一次（从库存查询页批次号下钻进来即此形态） */
onMounted(() => {
  const q = route.query.batch
  if (q && typeof q === 'string') {
    batchNo.value = q
    trace()
  }
})
</script>

<style scoped>
.ibt-search { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; padding: 14px 16px }
.ibt-input { max-width: 340px }
.ibt-card { margin-bottom: 12px }
.ibt-empty { text-align: center; color: var(--t2) }
.ibt-hint { margin: -4px 0 10px; font-size: 12px; color: var(--t2) }
</style>
