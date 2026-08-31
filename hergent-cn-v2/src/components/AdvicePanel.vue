<template>
  <div class="adv-wrap">
    <div class="adv-hd">
      <b>AI 留痕记录</b>
      <div class="adv-hd-right">
        <span class="tag" :class="pendingCount ? 'warn' : 'info'">{{ pendingCount ? pendingCount + ' 条待确认' : '全部已处理' }}</span>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load">刷新</button>
      </div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>
    <div v-else-if="!records.length" class="state-empty">还没有留痕记录。跑一次货损/工资计算后，AI 的建议会自动出现在这里。</div>
    <div v-else class="adv-list">
      <div v-for="r in records" :key="r.id" class="adv-item" :class="r.status">
        <div class="adv-item-top">
          <span class="adv-type">{{ typeLabel(r.task_type) }}</span>
          <span class="adv-status" :class="r.status">{{ statusLabel(r.status) }}</span>
          <span class="adv-time">{{ r.created_at || '—' }}</span>
        </div>
        <div class="adv-text">{{ r.advice_text }}</div>
        <div v-if="r.modified_by_user && r.status !== 'pending'" class="adv-meta">由 {{ r.modified_by_user }} {{ r.decided_at ? '于 ' + r.decided_at : '' }} 处理</div>
        <div v-if="r.status === 'pending'" class="adv-ops">
          <button class="btn btn-primary btn-sm" @click="confirm(r.id, 'approved')">确认采纳</button>
          <button class="btn btn-ghost btn-sm" @click="confirm(r.id, 'rejected')">驳回</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { toast } from '../store'
import { adviceApi } from '../api/modules'

const props = defineProps({
  limit: { type: Number, default: 20 },
  autoLoad: { type: Boolean, default: true },
})
const emit = defineEmits(['confirmed'])

const records = ref([])
const loading = ref(false)

const pendingCount = computed(() => records.value.filter(r => r.status === 'pending').length)

const TYPE_MAP = { loss_calc: '货损计算', payroll_calc: '工资计算' }
const STATUS_MAP = { pending: '待确认', confirmed: '已确认', rejected: '已驳回', approved: '已执行', executed: '已执行', undone: '已撤销' }

function typeLabel(t) { return TYPE_MAP[t] || t || 'AI 建议' }
function statusLabel(s) { return STATUS_MAP[s] || s || '—' }

async function load() {
  loading.value = true
  try {
    const d = await adviceApi.list(props.limit)
    records.value = d.records || []
  } catch (e) {
    toast(e.message || '加载留痕失败', 'err')
  } finally {
    loading.value = false
  }
}

async function confirm(aid, decision) {
  try {
    const d = await adviceApi.confirm(aid, decision)
    toast(decision === 'approved' ? '已确认采纳' : '已驳回', 'ok')
    emit('confirmed', d)
    load()
  } catch (e) {
    toast(e.message || '操作失败', 'err')
  }
}

onMounted(() => { if (props.autoLoad) load() })

defineExpose({ load })
</script>

<style scoped>
.adv-wrap{display:flex;flex-direction:column;gap:12px}
.adv-hd{display:flex;justify-content:space-between;align-items:center}
.adv-hd-right{display:flex;gap:8px;align-items:center}

.adv-list{display:flex;flex-direction:column;gap:10px}
.adv-item{padding:12px 14px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);transition:border-color .15s}
.adv-item.pending{border-color:rgba(var(--war-rgb),.35)}
.adv-item-top{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.adv-type{font-size:12px;font-weight:500;color:var(--p-dark);background:var(--p-bg);padding:2px 8px;border-radius:6px}
.adv-status{font-size:11px;padding:2px 8px;border-radius:8px}
.adv-status.pending{background:rgba(var(--war-rgb),.15);color:var(--war)}
.adv-status.confirmed,.adv-status.approved,.adv-status.executed{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.adv-status.rejected,.adv-status.undone{background:rgba(var(--dan-rgb),.1);color:var(--dan)}
.adv-time{font-size:11px;color:var(--t3);margin-left:auto}
.adv-text{font-size:13px;color:var(--t1);line-height:1.6}
.adv-meta{font-size:11.5px;color:var(--t3);margin-top:4px}
.adv-ops{display:flex;gap:8px;margin-top:10px}
</style>
