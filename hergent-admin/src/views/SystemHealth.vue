<template>
  <div>
    <div class="page-note">
      只读排障页：服务端库体积、最近备份与主库表行数。数据来自既有接口（<code class="code-chip">/api/system/health</code>
      + <code class="code-chip">/api/platform/stats</code>），不提供任何写操作。
    </div>

    <div class="toolbar">
      <span class="muted text-xs">用于判断「是不是库大了 / 备份有没有跑 / 某张表有没有在涨」</span>
      <span class="spacer"></span>
      <button class="btn sm icon-only" :disabled="loading" aria-label="刷新" title="刷新" @click="load">
        <Icon name="refresh" :size="15" />
      </button>
    </div>

    <div v-if="loading" class="card"><Skeleton :rows="4" :widths="['22%', '30%', '24%', '20%']" /></div>

    <template v-else>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="label" title="主库 erp.db 文件字节数">主库体积</div>
          <div class="value">{{ health.db_size_mb }} <span class="metric-unit">兆</span></div>
          <div class="foot">erp.db</div>
        </div>
        <div class="stat-card">
          <div class="label" title="主库 + 全部租户库（含 -wal/-shm）">数据总体积</div>
          <div class="value">{{ stats.total_db_size_mb }} <span class="metric-unit">兆</span></div>
          <div class="foot">主库 + 全部租户库</div>
        </div>
        <div class="stat-card">
          <div class="label" title="sqlite_master 中 type=table 的条目数">主库表数</div>
          <div class="value">{{ health.table_count }}</div>
          <div class="foot">含各租户登记表</div>
        </div>
        <div class="stat-card">
          <div class="label" title="取自助手备份历史的第一条">最近备份</div>
          <div class="value sm-text">{{ lastBackup }}</div>
          <div class="foot">来自备份历史记录</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>主库各表行数</h3>
          <span class="muted text-xs">共 {{ tableRows.length }} 张表</span>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr><th>表名</th><th>行数</th><th>占比</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in tableRows" :key="r.name">
                <td><code class="code-chip">{{ r.name }}</code></td>
                <td>{{ r.count }}</td>
                <td class="muted">
                  <span class="bar-track"><span class="bar-fill" :style="{ width: pct(r.count) + '%' }"></span></span>
                </td>
              </tr>
              <tr v-if="tableRows.length === 0">
                <td colspan="3">
                  <EmptyState icon="pulse" title="没有读到表信息" desc="接口可能返回异常，请点刷新重试" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { systemApi, statsApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import Icon from '../components/Icon.vue'
import Skeleton from '../components/Skeleton.vue'
import EmptyState from '../components/EmptyState.vue'

const toast = useToastStore()
const loading = ref(false)
const health = ref({ db_size_mb: 0, table_count: 0, table_counts: {}, last_backup: null })
const stats = ref({ total_db_size_mb: 0 })

// 备份记录的形状取决于后端 backup_history_list 的返回；这里按常见键兜底，未知形状原样展示
const lastBackup = computed(() => {
  const b = health.value.last_backup
  if (!b) return '—'
  if (typeof b === 'string') return b
  return b.created_at || b.time || b.ts || b.file || b.path || b.name || JSON.stringify(b)
})

const tableRows = computed(() => {
  const m = health.value.table_counts || {}
  const rows = Object.keys(m).map((name) => ({ name, count: Number(m[name]) || 0 }))
  rows.sort((a, b) => b.count - a.count)
  return rows.slice(0, 30)
})
const maxCount = computed(() => Math.max(1, ...tableRows.value.map((r) => r.count)))
function pct(c) { return Math.max(2, Math.round((c / maxCount.value) * 100)) }

async function load() {
  loading.value = true
  try {
    // 两个接口互不依赖，并行取；健康接口失败时仍尽量展示总体积
    const [h, s] = await Promise.allSettled([systemApi.health(), statsApi.overview()])
    if (h.status === 'fulfilled' && h.value) health.value = Object.assign(health.value, h.value)
    else toast.err('读取系统健康失败：' + (h.reason && h.reason.message ? h.reason.message : h.reason))
    if (s.status === 'fulfilled' && s.value && s.value.stats) stats.value = s.value.stats
  } catch (e) {
    toast.err('加载失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<style scoped>
.page-note {
  font-size: 13px; color: var(--text-2); background: var(--bg);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 9px 12px; margin-bottom: 16px;
}
.bar-track {
  display: inline-block; width: 120px; height: 8px; vertical-align: middle;
  background: var(--bg-muted); border-radius: 4px; overflow: hidden;
}
.bar-fill { display: block; height: 100%; background: var(--brand); border-radius: 4px; }
</style>
