<template>
  <div>
    <div class="card">
      <div class="card-head">
        <h3>平台用户名册</h3>
        <span class="muted text-xs">共 {{ users.length }} 个账号</span>
        <div class="card-actions">
          <button class="btn sm icon-only" :disabled="loading" aria-label="刷新" title="刷新" @click="load">
            <Icon name="refresh" :size="15" />
          </button>
          <button class="btn sm" :disabled="loading || users.length === 0" @click="onExport">
            <Icon name="download" :size="14" /> 导出
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <SortTh label="ID" field="id" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <SortTh label="账号" field="username" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <SortTh label="姓名" field="display_name" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>角色</th><th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in paged" :key="u.id">
              <td>{{ u.id }}</td>
              <td>{{ u.username }}</td>
              <td>{{ u.display_name || '—' }}</td>
              <td><Badge variant="neutral">{{ u.role }}</Badge></td>
              <td><StatusBadge :active="u.is_active" /></td>
            </tr>
            <tr v-if="loading">
              <td colspan="5"><Skeleton :rows="4" :widths="['10%', '26%', '20%', '16%', '14%']" /></td>
            </tr>
            <tr v-else-if="users.length === 0">
              <td colspan="5">
                <EmptyState
                  icon="users"
                  title="暂无数据"
                  desc="没有读到平台用户名册；该接口需要平台管理员权限，请确认当前账号已加入 platform_admins"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pager
        :total="users.length"
        :page="page"
        :page-size="PAGE_SIZE"
        @update:page="page = $event"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { userApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import { exportCsv } from '../utils/csv'
import Icon from '../components/Icon.vue'
import Badge from '../components/Badge.vue'
import Skeleton from '../components/Skeleton.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import Pager from '../components/Pager.vue'
import SortTh from '../components/SortTh.vue'
import { sortRows, pageSlice, PAGE_SIZE } from '../utils/table'

const toast = useToastStore()
const users = ref([])
const loading = ref(false)

const page = ref(1)
const sortKey = ref('')
const sortDir = ref('asc')
const paged = computed(() =>
  pageSlice(sortRows(users.value, sortKey.value, sortDir.value), page.value)
)
function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'asc' }
  page.value = 1
}
watch(users, () => { page.value = 1 })

// 导出当前排序后的全量（非当前页），避免用户以为导出了整表却只拿到一页
function onExport() {
  exportCsv('平台用户', [
    { key: 'id', label: 'ID' },
    { key: 'username', label: '账号' },
    { key: 'display_name', label: '姓名' },
    { key: 'role', label: '角色' },
    { key: 'is_active', label: '状态' },
  ], sortRows(users.value, sortKey.value, sortDir.value).map((u) => ({
    ...u, is_active: u.is_active ? '启用' : '停用',
  })))
}

async function load() {
  loading.value = true
  try {
    const data = await userApi.list()
    // 该接口直接返回数组
    users.value = Array.isArray(data) ? data : (data.data || [])
  } catch (e) {
    toast.err('加载失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
