<template>
  <div>
    <div class="card" style="margin-bottom:20px">
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

    <div class="card">
      <div class="card-head"><h3>注册流水</h3></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr><th>账号</th><th>邀请码</th><th>租户</th><th>时间</th><th>IP</th><th>来源</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in regs" :key="i">
              <td>{{ r.username || '—' }}</td>
              <td><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">{{ r.code || '—' }}</code></td>
              <td>{{ r.tenant_name || ('租户#' + (r.tenant_id ?? '—')) }}</td>
              <td class="muted">{{ r.created_at || '—' }}</td>
              <td class="muted">{{ r.ip_address || '—' }}</td>
              <td class="muted wrap">{{ (r.user_agent || '').slice(0, 40) || '—' }}</td>
            </tr>
            <tr v-if="regs.length === 0">
              <td colspan="6"><div class="empty">暂无注册记录</div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { regApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'

const toast = useToastStore()
const regs = ref([])
const admins = ref([])

async function load() {
  try {
    const data = await regApi.list()
    regs.value = (data && data.registrations) || []
    admins.value = (data && data.platform_admins) || []
  } catch (e) {
    toast.err('加载失败：' + (e instanceof ApiError ? e.message : e.message))
  }
}
onMounted(load)
</script>
