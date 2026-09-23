<template>
  <div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">租户总数</div>
        <div class="value brand">{{ s.total_tenants }}</div>
        <div class="foot">累计开通的客户数</div>
      </div>
      <div class="stat-card">
        <div class="label">启用中</div>
        <div class="value success">{{ s.active_tenants }}</div>
        <div class="foot">正常使用的租户</div>
      </div>
      <div class="stat-card">
        <div class="label">已停用</div>
        <div class="value danger">{{ s.inactive_tenants }}</div>
        <div class="foot">被停用的租户</div>
      </div>
      <div class="stat-card">
        <div class="label">今日新增</div>
        <div class="value">{{ s.new_today }}</div>
        <div class="foot">较昨日注册量</div>
      </div>
      <div class="stat-card">
        <div class="label">近 7 天新增</div>
        <div class="value">{{ s.new_this_week }}</div>
        <div class="foot">滚动一周注册</div>
      </div>
      <div class="stat-card">
        <div class="label">平台总用户</div>
        <div class="value">{{ s.total_users }}</div>
        <div class="foot">全部注册账号数</div>
      </div>
      <div class="stat-card">
        <div class="label">数据总体积</div>
        <div class="value">{{ s.total_db_size_mb }} <span style="font-size:14px;color:var(--text-3)">兆</span></div>
        <div class="foot">主库 + 全部租户库</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>套餐分布</h3></div>
      <div class="card-body">
        <div v-if="planEntries.length === 0" class="empty">暂无数据</div>
        <div v-else class="plan-bars">
          <div v-for="[plan, count] in planEntries" :key="plan" class="plan-row">
            <span class="plan-name">{{ planLabel(plan) }}</span>
            <div class="plan-track"><div class="plan-fill" :style="{ width: pct(count) + '%' }"></div></div>
            <span class="plan-count">{{ count }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { statsApi } from '../api/client'
import { ApiError } from '../api/client'
import { useToastStore } from '../store/toast'

const toast = useToastStore()
const loading = ref(false)
const s = ref({
  total_tenants: 0, active_tenants: 0, inactive_tenants: 0,
  new_today: 0, new_this_week: 0, total_users: 0, total_db_size_mb: 0,
  plan_distribution: {},
})

const planEntries = computed(() => Object.entries(s.value.plan_distribution || {}))
const maxCount = computed(() => Math.max(1, ...planEntries.value.map(([, c]) => c)))

function pct(c) { return Math.round((c / maxCount.value) * 100) }
function planLabel(p) {
  const m = { free: '免费版', pro: '专业版', enterprise: '企业版', '': '未设置' }
  return m[p] || p
}

onMounted(async () => {
  loading.value = true
  try {
    const data = await statsApi.overview()
    s.value = Object.assign(s.value, data.stats || {})
  } catch (e) {
    toast.err('加载统计失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.plan-bars { display: flex; flex-direction: column; gap: 14px; }
.plan-row { display: flex; align-items: center; gap: 14px; }
.plan-name { width: 80px; font-size: 13px; color: var(--text-2); }
.plan-track { flex: 1; height: 10px; background: #eef0f3; border-radius: 5px; overflow: hidden; }
.plan-fill { height: 100%; background: linear-gradient(90deg, #06b6d4, #22d3ee); border-radius: 5px; }
.plan-count { width: 40px; text-align: right; font-size: 13px; font-weight: 600; }
</style>
