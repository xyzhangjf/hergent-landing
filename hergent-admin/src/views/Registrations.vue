<template>
  <div>
    <div class="page-note">邀请码注册即生效，本页仅供追溯核对，无需人工审核。</div>

    <div class="card mb-20">
      <div class="card-head"><h3>平台管理员</h3></div>
      <div class="card-body">
        <div v-if="admins.length === 0" class="empty">无</div>
        <div v-else class="btn-row">
          <Badge v-for="a in admins" :key="a.username || a" variant="success">{{ a.username || a }}</Badge>
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
      <div class="card-head">
        <h3>注册流水</h3>
        <div class="card-actions">
          <button class="btn sm icon-only" :disabled="loading" aria-label="刷新" title="刷新" @click="load">
            <Icon name="refresh" :size="15" />
          </button>
          <button class="btn sm" :disabled="loading || filtered.length === 0" @click="onExport">
            <Icon name="download" :size="14" /> 导出
          </button>
        </div>
      </div>
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
              <td>
                <router-link v-if="r.tenant_id" :to="'/tenants/' + r.tenant_id" class="link-btn">
                  {{ r.tenant_name || ('租户#' + r.tenant_id) }}
                </router-link>
                <span v-else class="muted">—</span>
              </td>
              <td class="muted">{{ r.created_at || '—' }}</td>
              <td class="muted">{{ r.ip_address || '—' }}</td>
              <td class="muted wrap">{{ (r.user_agent || '').slice(0, 40) || '—' }}</td>
            </tr>
            <tr v-if="loading">
              <td colspan="6"><Skeleton :rows="5" :widths="['18%', '16%', '20%', '16%', '14%', '16%']" /></td>
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
import { useRoute } from 'vue-router'
import { regApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import { exportCsv } from '../utils/csv'
import Icon from '../components/Icon.vue'
import Badge from '../components/Badge.vue'
import Skeleton from '../components/Skeleton.vue'
import EmptyState from '../components/EmptyState.vue'
import Pager from '../components/Pager.vue'
import SortTh from '../components/SortTh.vue'
import { sortRows, pageSlice, PAGE_SIZE } from '../utils/table'

const route = useRoute()
const toast = useToastStore()
const regs = ref([])
const admins = ref([])
const loading = ref(false)

// ---- 日期筛选：快捷区间 + 自定义起止 ----
const RANGES = [
  { k: 'all', label: '全部' },
  { k: 'today', label: '今天' },
  { k: '7d', label: '近 7 天' },
  { k: '30d', label: '近 30 天' },
  { k: 'custom', label: '自定义' },
]
// 支持从总览 KPI 卡下钻：/registrations?range=today
const initRange = String(route.query.range || '')
const range = ref(RANGES.some((r) => r.k === initRange) ? initRange : 'all')
const from = ref('')
const to = ref('')
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
const sorted = computed(() => sortRows(filtered.value, sortKey.value, sortDir.value))
const paged = computed(() => pageSlice(sorted.value, page.value))
function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'asc' }
  page.value = 1
}
watch([range, from, to], () => { page.value = 1 })

function onExport() {
  exportCsv('注册流水', [
    { key: 'username', label: '账号' },
    { key: 'code', label: '邀请码' },
    { key: 'tenant_name', label: '租户' },
    { key: 'created_at', label: '时间' },
    { key: 'ip_address', label: 'IP' },
    { key: 'user_agent', label: '来源' },
  ], sorted.value)
}

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
