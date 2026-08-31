<template>
  <div class="card history-card">
    <div class="history-hd">
      <h3>预报订单历史</h3>
      <span class="hint">按报单期次汇总，点击查看该期汇总表明细</span>
    </div>
    <div v-if="loading" class="history-loading">加载中…</div>
    <div v-else-if="!list.length" class="history-empty">暂无历史预报期次</div>
    <div v-else class="table-wrap">
      <table class="tbl history-tbl">
        <thead>
          <tr>
            <th>期次名称</th>
            <th>下单区间</th>
            <th>到货日期</th>
            <th class="num">报单人数</th>
            <th class="num">总件数</th>
            <th class="num">下单金额</th>
            <th>状态</th>
            <th>定稿</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in list" :key="row.id" :class="{ active: row.status === 'open' }">
            <td><b>{{ row.name || '—' }}</b></td>
            <td>{{ row.order_start || '—' }} ~ {{ row.order_end || '—' }}</td>
            <td>{{ row.arrival_date || '—' }}</td>
            <td class="num">{{ fmt(row.reporter_count) }}</td>
            <td class="num">{{ fmt(row.total_qty) }}</td>
            <td class="num">¥{{ fmt(row.total_amount) }}</td>
            <td><span class="tag" :class="row.status === 'open' ? 'ok' : 'info'">{{ row.status === 'open' ? '进行中' : '已关闭' }}</span></td>
            <td><span class="tag" :class="row.finalized ? 'ok' : 'info'">{{ row.finalized ? '已定稿' : '未定稿' }}</span></td>
            <td>
              <button class="btn btn-sm btn-ghost" @click="$emit('view', row)">查看</button>
              <button v-if="row.status === 'open'" class="btn btn-sm btn-ghost" @click="$emit('close', row)">关闭</button>
              <button v-if="row.status !== 'open'" class="btn btn-sm btn-ghost danger" @click="$emit('delete', row)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { forecastApi } from '../api/modules'

const emit = defineEmits(['view', 'delete', 'close'])
const list = ref([])
const loading = ref(false)

function fmt(n) {
  if (n == null || n === '') return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

async function load() {
  loading.value = true
  try {
    const d = await forecastApi.orderBoard()
    list.value = d.board || []
  } catch (e) {
    list.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.history-card { padding: 16px 18px; }
.history-hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.history-hd h3 { font-size: 16px; font-weight: 600; margin: 0; }
.history-hd .hint { font-size: 12px; color: var(--t3); }
.history-loading, .history-empty { color: var(--t3); padding: 40px 0; text-align: center; font-size: 13px; }
.history-tbl { min-width: 900px; }
.history-tbl tbody tr.active { background: rgba(6, 182, 212, 0.04); }
.history-tbl td { font-size: 13px; }
.history-tbl th { font-size: 12px; color: var(--t2); font-weight: 500; }
.history-tbl .danger { color: var(--dan); }
.history-tbl .danger:hover { text-decoration: underline; }
</style>
