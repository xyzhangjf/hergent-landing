<template>
  <div>
    <div class="page-note">邀请码注册即生效，本页仅供追溯核对，无需人工审核。</div>

    <div class="card mb-20">
      <div class="card-head"><h3>平台管理员</h3></div>
      <div class="card-body">
        <div v-if="admins.length === 0" class="empty">无</div>
        <div v-else class="btn-row">
          <span v-for="a in admins" :key="a.username || a" class="badge on">
            <span class="dot"></span>{{ a.username || a }}
          </span>
        </div>
      </div>
    </div>

    <div class="toolbar">
      <div class="pill-group" role="group" aria-label="按时间范围筛选">
        <button
          v-for="r in RANGES"
          :key="r.k"
          type="button"
          class="pill"
          :class="{ on: range === r.k }"
          :aria-pressed="range === r.k"
          @click="range = r.k"
        >{{ r.label }}</button>
      </div>
      <template v-if="range === 'custom'">
        <input class="input date-input" type="date" v-model="from" aria-label="起始日期" />
        <span class="muted">至</span>
        <input class="input date-input" type="date" v-model="to" aria-label="结束日期" />
      </template>
      <span class="spacer"></span>
      <span class="muted text-xs">
        筛选后 {{ filtered.length }} 条 / 共 {{ regs.length }} 条
      </span>
    </div>

    <div class="card">
      <div class="card-head"><h3>注册流水</h3></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <SortTh label="账号" field="username" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>邀请码</th><th>租户</th>
              <SortTh label="时间" field="created_at" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>IP</th><th>来源</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in paged" :key="i">
              <td>{{ r.username || '—' }}</td>
              <td><code class="code-chip">{{ r.code || '—' }}</code></td>
              <td>{{ r.tenant_name || ('租户#' + (r.tenant_id ?? '—')) }}</td>
              <td class="muted">{{ r.created_at || '—' }}</td>
              <td class="muted">{{ r.ip_address || '—' }}</td>
              <td class="muted wrap">{{ (r.user_agent || '').slice(0, 40) || '—' }}</td>
            </tr>
            <tr v-if="loading">
              <td colspan="6"><div class="loading-box">加载中…</div></td>
            </tr>
            <tr v-else-if="filtered.length === 0">
              <td colspan="6">
                <EmptyState
                  icon="clipboard"
                  :title="range === 'all' ? '暂无注册记录' : '该时间段内没有注册记录'"
                  desc="还没有客户通过邀请码注册；注册成功后会在这里留下账号、邀请码与时间"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pager
        :total="filtered.length"
        :page="page"
        :page-size="PAGE_SIZE"
        @update:page="page = $event"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { regApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import EmptyState from '../components/EmptyState.vue'
import Pager from '../components/Pager.vue'
import SortTh from '../components/SortTh.vue'
import { sortRows, pageSlice, PAGE_SIZE } from '../utils/table'

const toast = useToastStore()
const regs = ref([])
const admins = ref([])
const loading = ref(false)

// ---- 日期筛选：快捷区间 + 自定义起止 ----
const range = ref('all')
const from = ref('')
const to = ref('')
const RANGES = [
  { k: 'all', label: '全部' },
  { k: 'today', label: '今天' },
  { k: '7d', label: '近 7 天' },
  { k: '30d', label: '近 30 天' },
  { k: 'custom', label: '自定义' },
]
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function daysAgo(n) { const x = startOfDay(new Date()); x.setDate(x.getDate() - n); return x }
function parseTime(v) {
  if (!v) return null
  const t = new Date(String(v).replace(' ', 'T'))
  return isNaN(t.getTime()) ? null : t
}

const filtered = computed(() => {
  if (range.value === 'all') return regs.value
  let start = null
  let end = null
  if (range.value === 'today') { start = startOfDay(new Date()) }
  else if (range.value === '7d') { start = daysAgo(6) }
  else if (range.value === '30d') { start = daysAgo(29) }
  else if (range.value === 'custom') {
    start = from.value ? new Date(from.value + 'T00:00:00') : null
    end = to.value ? new Date(to.value + 'T23:59:59') : null
    if (!start && !end) return regs.value
  }
  return regs.value.filter((r) => {
    const t = parseTime(r.created_at)
    if (!t) return false
    if (start && t < start) return false
    if (end && t > end) return false
    return true
  })
})

// ---- 排序 + 分页 ----
const page = ref(1)
const sortKey = ref('created_at')
const sortDir = ref('desc')
const paged = computed(() =>
  pageSlice(sortRows(filtered.value, sortKey.value, sortDir.value), page.value)
)
function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'asc' }
  page.value = 1
}
watch([range, from, to], () => { page.value = 1 })

async function load() {
  loading.value = true
  try {
    const data = await regApi.list()
    regs.value = (data && data.registrations) || []
    admins.value = (data && data.platform_admins) || []
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
</style>
