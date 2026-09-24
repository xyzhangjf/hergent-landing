<template>
  <div>
    <div class="page-note">
      本页记录<strong>平台级跨租户高危操作</strong>（停用租户、改套餐、增删成员、生成/停用邀请码、一键开通客户等）。
      仅平台管理员可见，与租户自身的业务日志完全隔离。审计写入失败不影响业务，因此可放心追溯。
    </div>

    <div class="toolbar">
      <select class="input select-action" v-model="actionFilter" aria-label="按动作类型筛选">
        <option value="">全部动作</option>
        <option v-for="a in actions" :key="a" :value="a">{{ a }}</option>
      </select>
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
      <input
        class="input search-inline"
        v-model="keyword"
        aria-label="搜索操作人 / 对象 / 详情"
        placeholder="搜索操作人 / 对象 / 详情"
      />
      <span class="spacer"></span>
      <span class="muted text-xs">共 {{ total }} 条</span>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>操作审计</h3>
        <div class="card-actions">
          <button class="btn sm icon-only" :disabled="loading" aria-label="刷新" title="刷新" @click="load">
            <Icon name="refresh" :size="15" />
          </button>
          <button class="btn sm" :disabled="loading || entries.length === 0" @click="onExport">
            <Icon name="download" :size="14" /> 导出本页
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <SortTh label="时间" field="created_at" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <SortTh label="操作人" field="actor" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <SortTh label="动作" field="action" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <SortTh label="操作对象" field="target_name" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>变更内容</th>
              <SortTh label="来源 IP" field="client_ip" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in entries" :key="e.id || i">
              <td class="muted nowrap">{{ e.created_at || '—' }}</td>
              <td>{{ e.actor || '—' }}</td>
              <td><span class="tag" :class="actionClass(e.action)">{{ e.action || '—' }}</span></td>
              <td class="wrap">
                <span class="obj-type">{{ e.target_type || '—' }}</span>
                <router-link
                  v-if="e.target_type === 'tenant' && e.target_id"
                  :to="'/tenants/' + e.target_id"
                  class="obj-name obj-link"
                >{{ e.target_name || ('#' + e.target_id) }}</router-link>
                <span v-else-if="e.target_name" class="obj-name">{{ e.target_name }}</span>
                <span v-else-if="e.target_id" class="obj-name">#{{ e.target_id }}</span>
              </td>
              <td class="wrap">
                <template v-if="e.field">
                  <span class="field-name">{{ e.field }}</span>：
                  <span class="old">{{ e.old_value || '—' }}</span>
                  <span class="arrow">→</span>
                  <span class="new">{{ e.new_value || '—' }}</span>
                </template>
                <template v-else>{{ e.detail || '—' }}</template>
              </td>
              <td class="muted">{{ e.client_ip || '—' }}</td>
            </tr>
            <tr v-if="loading">
              <td colspan="6"><Skeleton :rows="6" :widths="['18%', '12%', '14%', '18%', '22%', '12%']" /></td>
            </tr>
            <tr v-else-if="entries.length === 0">
              <td colspan="6">
                <EmptyState
                  icon="history"
                  :title="total === 0 ? '暂无操作记录' : '没有符合条件的记录'"
                  desc="平台级高危操作（停用租户、改套餐、增删成员、生成/停用邀请码等）发生后会在这里留痕"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pager
        :total="total"
        :page="page"
        :page-size="PAGE_SIZE"
        @update:page="page = $event"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { auditApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import { exportCsv } from '../utils/csv'
import { PAGE_SIZE } from '../utils/table'
import Icon from '../components/Icon.vue'
import Skeleton from '../components/Skeleton.vue'
import EmptyState from '../components/EmptyState.vue'
import Pager from '../components/Pager.vue'
import SortTh from '../components/SortTh.vue'

const toast = useToastStore()
const entries = ref([])
const actions = ref([])
const total = ref(0)
const loading = ref(false)

// ---- 筛选：动作下拉 + 日期快捷区间 + 关键字（全部走服务端）----
const actionFilter = ref('')
const range = ref('all')
const from = ref('')
const to = ref('')
const keyword = ref('')
const debouncedKeyword = ref('')
let kwTimer = null
watch(keyword, (v) => {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(() => { debouncedKeyword.value = v.trim() }, 300)
})

const RANGES = [
  { k: 'all', label: '全部' },
  { k: 'today', label: '今天' },
  { k: '7d', label: '近 7 天' },
  { k: '30d', label: '近 30 天' },
  { k: 'custom', label: '自定义' },
]

// ---- 排序 + 分页（服务端）----
const page = ref(1)
const sortKey = ref('created_at')
const sortDir = ref('desc')
function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'asc' }
  page.value = 1
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function daysAgo(n) { const x = startOfDay(new Date()); x.setDate(x.getDate() - n); return x }
function dateRange() {
  if (range.value === 'today') return { from: fmtDate(startOfDay(new Date())), to: '' }
  if (range.value === '7d') return { from: fmtDate(daysAgo(6)), to: '' }
  if (range.value === '30d') return { from: fmtDate(daysAgo(29)), to: '' }
  if (range.value === 'custom') return { from: from.value, to: to.value }
  return { from: '', to: '' }
}

// 单一查询签名：任一参数变化即请求一次，避免 watch 多路重复触发
const sig = computed(() => JSON.stringify({
  a: actionFilter.value, r: range.value, f: from.value, t: to.value,
  k: debouncedKeyword.value, p: page.value, s: sortKey.value, d: sortDir.value,
}))

// 注意顺序：先注册「筛选变化回第一页」，再注册「签名变化即拉取」，
// 保证 page 先归 1，只发一次请求。
watch([actionFilter, range, from, to, debouncedKeyword], () => { page.value = 1 })
watch(sig, load)

function actionClass(a) {
  if (!a) return 'neutral'
  if (/创建|开通|生成|添加/.test(a)) return 'create'
  if (/修改|改|启用|停用/.test(a)) return 'modify'
  if (/移除|删除/.test(a)) return 'danger'
  return 'neutral'
}

function onExport() {
  exportCsv('操作审计', [
    { key: 'created_at', label: '时间' },
    { key: 'actor', label: '操作人' },
    { key: 'action', label: '动作' },
    { key: 'target_type', label: '对象类型' },
    { key: 'target_name', label: '对象' },
    { key: 'field', label: '字段' },
    { key: 'old_value', label: '改前' },
    { key: 'new_value', label: '改后' },
    { key: 'detail', label: '详情' },
    { key: 'client_ip', label: '来源 IP' },
  ], entries.value)
}

async function load() {
  loading.value = true
  try {
    const dr = dateRange()
    const data = await auditApi.list({
      limit: PAGE_SIZE,
      offset: (page.value - 1) * PAGE_SIZE,
      action: actionFilter.value,
      q: debouncedKeyword.value,
      date_from: dr.from,
      date_to: dr.to,
      order_by: sortKey.value,
      order_dir: sortDir.value,
    })
    entries.value = (data && data.entries) || []
    total.value = (data && data.total) || 0
    actions.value = (data && data.actions) || []
  } catch (e) {
    toast.err('加载失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    loading.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => clearTimeout(kwTimer))
</script>

<style scoped>
.page-note {
  font-size: 13px; color: var(--text-2); background: var(--bg);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 9px 12px; margin-bottom: 16px;
}
.nowrap { white-space: nowrap; }
.obj-type {
  display: inline-block; font-size: 11px; color: var(--text-2);
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 4px; padding: 1px 6px; margin-right: 6px;
}
.obj-name { font-weight: 600; }
.obj-link { color: var(--brand-dark); }
.obj-link:hover { text-decoration: underline; }
.field-name { color: var(--text-2); }
.arrow { color: var(--text-2); margin: 0 4px; }
.old { color: var(--badge-danger-fg); }
.new { color: var(--badge-success-fg); }
.tag {
  display: inline-block; font-size: 12px; line-height: 1; padding: 4px 8px;
  border-radius: 6px; white-space: nowrap;
}
.tag.create { color: var(--chip-green-fg); background: var(--chip-green-bg); }
.tag.modify { color: var(--chip-blue-fg); background: var(--chip-blue-bg); }
.tag.danger { color: var(--chip-red-fg); background: var(--chip-red-bg); }
.tag.neutral { color: var(--text-2); background: var(--bg); border: 1px solid var(--border); }
</style>
