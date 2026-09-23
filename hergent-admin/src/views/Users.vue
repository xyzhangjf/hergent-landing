<template>
  <div>
    <div class="card">
      <div class="card-head"><h3>平台用户名册</h3><span class="muted" style="font-size:12px">共 {{ users.length }} 个账号</span></div>
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
              <td><span class="badge neutral">{{ u.role }}</span></td>
              <td><StatusBadge :active="u.is_active" /></td>
            </tr>
            <tr v-if="loading">
              <td colspan="5"><div class="loading-box">加载中…</div></td>
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
