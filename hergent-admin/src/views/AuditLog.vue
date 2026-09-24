<template>
  <div>
    <div class="page-note">
      本页记录<strong>平台级跨租户高危操作</strong>（停用租户、改套餐、增删成员、生成/停用邀请码、一键开通客户等）。
      仅平台管理员可见，与租户自身的业务日志完全隔离。审计写入失败不影响业务，因此可放心追溯。
    </div>

    <div class="toolbar">
      <select class="input" style="width:160px" v-model="actionFilter">
        <option value="">全部动作</option>
        <option v-for="a in actions" :key="a" :value="a">{{ a }}</option>
      </select>
      <div class="pill-group">
        <span
          v-for="r in RANGES"
          :key="r.k"
          class="pill"
          :class="{ on: range === r.k }"
          @click="range = r.k"
        >{{ r.label }}</span>
      </div>
      <template v-if="range === 'custom'">
        <input class="input" style="width:150px" type="date" v-model="from" />
        <span class="muted">至</span>
        <input class="input" style="width:150px" type="date" v-model="to" />
      </template>
      <input
        class="input"
        style="width:200px"
        v-model="keyword"
        placeholder="搜索操作人 / 对象 / 详情"
      />
      <span class="spacer"></span>
      <span class="muted" style="font-size:12px">
        筛选后 {{ filtered.length }} 条 · 共加载 {{ entries.length }} 条
      </span>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <SortTh label="时间" field="created_at" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>操作人</th>
              <th>动作</th>
              <th>操作对象</th>
              <th>变更内容</th>
              <th>来源 IP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in paged" :key="i">
              <td class="muted nowrap">{{ e.created_at || '—' }}</td>
              <td>{{ e.actor || '—' }}</td>
              <td><span class="tag" :class="actionClass(e.action)">{{ e.action || '—' }}</span></td>
              <td class="wrap">
                <span class="obj-type">{{ e.target_type || '—' }}</span>
                <span v-if="e.target_name" class="obj-name">{{ e.target_name }}</span>
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
              <td colspan="6"><div class="loading-box">加载中…</div></td>
            </tr>
            <tr v-else-if="filtered.length === 0">
              <td colspan="6">
                <EmptyState
                  icon="history"
                  :title="entries.length === 0 ? '暂无操作记录' : '没有符合条件的记录'"
                  desc="平台级高危操作（停用租户、改套餐、增删成员、生成/停用邀请码等）发生后会在这里留痕"
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
import { auditApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import EmptyState from '../components/EmptyState.vue'
import Pager from '../components/Pager.vue'
import SortTh from '../components/SortTh.vue'
import { sortRows, pageSlice, PAGE_SIZE } from '../utils/table'

const toast = useToastStore()
const entries = ref([])
const actions = ref([])
const loading = ref(false)

// ---- 筛选：动作下拉 + 日期快捷区间 + 关键字 ----
const actionFilter = ref('')
const range = ref('all')
const from = ref('')
const to = ref('')
const keyword = ref('')
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
  let rows = entries.value
  // 日期区间
  if (range.value !== 'all') {
    let start = null, end = null
    if (range.value === 'today') start = startOfDay(new Date())
    else if (range.value === '7d') start = daysAgo(6)
    else if (range.value === '30d') start = daysAgo(29)
    else if (range.value === 'custom') {
      start = from.value ? new Date(from.value + 'T00:00:00') : null
      end = to.value ? new Date(to.value + 'T23:59:59') : null
    }
    rows = rows.filter((e) => {
      const t = parseTime(e.created_at)
      if (!t) return false
      if (start && t < start) return false
      if (end && t > end) return false
      return true
    })
  }
  // 动作下拉
  if (actionFilter.value) rows = rows.filter((e) => e.action === actionFilter.value)
  // 关键字（操作人 / 对象名 / 详情 / 动作）
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    rows = rows.filter((e) =>
      (e.actor && e.actor.toLowerCase().includes(kw)) ||
      (e.target_name && e.target_name.toLowerCase().includes(kw)) ||
      (e.detail && e.detail.toLowerCase().includes(kw)) ||
      (e.action && e.action.toLowerCase().includes(kw)))
  }
  return rows
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
watch([range, from, to, actionFilter, keyword], () => { page.value = 1 })

// ---- 动作色彩分类（让「创建/修改/移除」一眼可辨）----
function actionClass(a) {
  if (!a) return 'neutral'
  if (/创建|开通|生成|添加/.test(a)) return 'create'
  if (/修改|改|启用|停用/.test(a)) return 'modify'
  if (/移除|删除/.test(a)) return 'danger'
  return 'neutral'
}

async function load() {
  loading.value = true
  try {
    const data = await auditApi.list()
    entries.value = (data && data.entries) || []
    actions.value = (data && data.actions) || []
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
.nowrap { white-space: nowrap; }
.obj-type {
  display: inline-block; font-size: 11px; color: var(--text-2);
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 4px; padding: 1px 6px; margin-right: 6px;
}
.obj-name { font-weight: 600; }
.field-name { color: var(--text-2); }
.arrow { color: var(--text-2); margin: 0 4px; }
.old { color: var(--danger); }
.new { color: var(--success); }
.tag {
  display: inline-block; font-size: 12px; line-height: 1; padding: 4px 8px;
  border-radius: 6px; white-space: nowrap;
}
.tag.create { color: #047857; background: #d1fae5; }
.tag.modify { color: #1d4ed8; background: #dbeafe; }
.tag.danger { color: #b91c1c; background: #fee2e2; }
.tag.neutral { color: var(--text-2); background: var(--bg); border: 1px solid var(--border); }
</style>
