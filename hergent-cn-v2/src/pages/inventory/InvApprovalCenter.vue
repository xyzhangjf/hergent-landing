<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>待我审核</h2>
        <span class="page-sub">只列出当前轮到我这一关的单据</span>
      </div>
      <div class="isd-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading || busy" @click="load">刷新</button>
      </div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>
    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load">重试</button>
    </div>
    <div v-else-if="!items.length" class="card empty">
      <Icon name="check" :size="20" />
      <span>当前没有需要你审批的单据。</span>
    </div>

    <div v-else class="card">
      <table class="tbl">
        <thead>
          <tr>
            <th>单据类型</th>
            <th>单号</th>
            <th>当前审批关</th>
            <th>进度</th>
            <th class="op-th">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, i) in items" :key="it.doc_type + '-' + it.id">
            <td class="seq-cell">{{ i + 1 }}</td>
            <td>{{ docTypeLabel(it.doc_type) }}</td>
            <td class="mono">{{ it.order_no || ('#' + it.id) }}</td>
            <td>第 {{ it.node + 1 }} 关：{{ it.current_node_name || '—' }}</td>
            <td>
              <span class="tag tag-warn">第 {{ it.node + 1 }} / {{ it.total_nodes }} 关</span>
            </td>
            <td class="op-td">
              <button v-if="linkOf(it)" class="btn btn-primary btn-sm" @click="go(it)">去处理</button>
              <span v-else class="muted">退单暂未在列表页接入</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
/* 待我审核中心 —— 数据源：`GET /api/approvals/pending`。
   🔴 后端 `pending_for_user` 已按「当前用户角色能否审这一关」过滤，返回的就是要我处理的单；
      前端不二次过滤，直接渲染（避免「看到了却点不动」的假清单）。
   🔴 跳转落点：采购/销售 → 详情页（带审批按钮）；调拨 → 列表页（调拨无详情页，行内直接审）。
      退单（return）暂未在前端列表页接入 ⇒ 不渲染死链，只提示。 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { approvalApi } from '../../api/approvals'
import { toast } from '../../store'

const router = useRouter()
const loading = ref(true)
const err = ref('')
const busy = ref(false)
const items = ref([])

const DOC_LABELS = { purchase: '采购单', sale: '销售单', transfer: '调拨单', return: '退货单' }
function docTypeLabel (t) { return DOC_LABELS[t] || t }

/* 跳转到可处理该单的页面（null = 前端未接入，不渲染链接） */
function linkOf (it) {
  if (it.doc_type === 'purchase') return `/inventory/purchase/${it.id}`
  if (it.doc_type === 'sale') return `/inventory/sale/${it.id}`
  if (it.doc_type === 'transfer') return `/inventory/transfer`
  return null
}
function go (it) {
  const p = linkOf(it)
  if (p) router.push(p)
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await approvalApi.pending()
    items.value = Array.isArray(d) ? d : []
  } catch (e) {
    err.value = e.message || '待审清单读取失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<style scoped>
.inv-page { display: block }
.page-hd { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 12px }
.page-sub { font-size: 12px; color: var(--t3) }
.isd-acts { display: flex; gap: 8px }
.card { padding: 0; overflow: hidden }
.empty { display: flex; align-items: center; gap: 10px; padding: 28px; color: var(--t2) }
.empty svg { color: var(--ok, #16a34a) }
.tbl th, .tbl td { padding: 10px 12px; text-align: left }
.seq-cell { color: var(--t3); width: 40px }
.mono { font-variant-numeric: tabular-nums }
.op-th, .op-td { text-align: right; width: 120px }
.muted { font-size: 12px; color: var(--t3) }
</style>
