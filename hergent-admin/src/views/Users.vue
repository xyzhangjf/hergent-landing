<template>
  <div>
    <div class="card">
      <div class="card-head"><h3>平台用户名册</h3><span class="muted" style="font-size:12px">共 {{ users.length }} 个账号</span></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>ID</th><th>账号</th><th>姓名</th><th>角色</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>{{ u.id }}</td>
              <td>{{ u.username }}</td>
              <td>{{ u.display_name || '—' }}</td>
              <td><span class="badge neutral">{{ u.role }}</span></td>
              <td><StatusBadge :active="u.is_active" /></td>
            </tr>
            <tr v-if="users.length === 0">
              <td colspan="5"><div class="empty">暂无数据（该接口需平台管理员权限）</div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { userApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import StatusBadge from '../components/StatusBadge.vue'

const toast = useToastStore()
const users = ref([])

async function load() {
  try {
    const data = await userApi.list()
    // 该接口直接返回数组
    users.value = Array.isArray(data) ? data : (data.data || [])
  } catch (e) {
    toast.err('加载失败：' + (e instanceof ApiError ? e.message : e.message))
  }
}
onMounted(load)
</script>
