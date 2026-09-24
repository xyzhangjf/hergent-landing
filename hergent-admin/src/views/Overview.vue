<template>
  <div>
    <div v-if="loading" class="card"><Skeleton :rows="4" :widths="['22%', '30%', '24%', '20%']" /></div>
    <template v-else>
      <div class="stat-grid">
        <component
          :is="c.to ? RouterLink : 'div'"
          v-for="c in cards"
          :key="c.label"
          :to="c.to || undefined"
          class="stat-card"
          :class="{ link: !!c.to }"
        >
          <div class="label" :title="c.tip">{{ c.label }}</div>
          <div class="value" :class="c.cls">{{ c.value }}<span v-if="c.unit" class="metric-unit"> {{ c.unit }}</span></div>
          <div v-if="c.delta" class="delta" :class="c.delta.cls">{{ c.delta.text }}</div>
          <div class="foot">{{ c.foot }}</div>
        </component>
      </div>

      <div class="card mb-20">
        <div class="card-head">
          <h3>近 30 天新增租户</h3>
          <div class="card-actions">
            <router-link to="/registrations?range=30d" class="link-btn">查看流水 →</router-link>
          </div>
        </div>
        <div class="card-body">
          <TrendChart v-if="trend.length" :data="trend" caption="每日新注册租户数" />
          <div v-else class="empty">暂无趋势数据</div>
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
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { statsApi } from '../api/client'
import { ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import Skeleton from '../components/Skeleton.vue'
import TrendChart from '../components/TrendChart.vue'

const toast = useToastStore()
const loading = ref(false)
const s = ref({
  total_tenants: 0, active_tenants: 0, inactive_tenants: 0,
  new_today: 0, new_this_week: 0, total_users: 0, total_db_size_mb: 0,
  plan_distribution: {}, daily_registrations: [],
})

const planEntries = computed(() => Object.entries(s.value.plan_distribution || {}))
const maxCount = computed(() => Math.max(1, ...planEntries.value.map(([, c]) => c)))
const trend = computed(() => s.value.daily_registrations || [])

function pct(c) { return Math.round((c / maxCount.value) * 100) }
function planLabel(p) {
  const m = { free: '免费版', pro: '专业版', enterprise: '企业版', '': '未设置' }
  return m[p] || p
}

// 环比：后端提供上一周期字段时显示（缺失则返回 null，卡片退回只显示静态脚注，不假装有数据）
function deltaOf(cur, prev, prefix) {
  if (cur == null || prev == null) return null
  const d = Number(cur) - Number(prev)
  if (!Number.isFinite(d)) return null
  if (d === 0) return { text: prefix + '持平', cls: 'muted' }
  return { text: prefix + (d > 0 ? ' +' : ' ') + d, cls: d > 0 ? 'success' : 'danger' }
}

// KPI 卡可下钻到对应筛选列表（对标 Stripe Dashboard：看数与查数连通）
const cards = computed(() => [
  { label: '租户总数', value: s.value.total_tenants, cls: 'brand', foot: '累计开通的客户数', tip: '截至当前累计开通的租户总数，含已停用', to: '/tenants' },
  { label: '启用中', value: s.value.active_tenants, cls: 'success', foot: '正常使用的租户', tip: '状态为启用的租户，可正常登录使用系统', to: '/tenants?status=on' },
  { label: '已停用', value: s.value.inactive_tenants, cls: 'danger', foot: '被停用的租户', tip: '状态为停用的租户，已停止服务但数据完整保留', to: '/tenants?status=off' },
  {
    label: '今日新增', value: s.value.new_today, cls: '', foot: '今日注册的租户数',
    tip: '今天 0 点到现在新注册的租户数量', to: '/registrations?range=today',
    delta: deltaOf(s.value.new_today, s.value.new_yesterday, '较昨日'),
  },
  {
    label: '近 7 天新增', value: s.value.new_this_week, cls: '', foot: '滚动一周注册',
    tip: '滚动 7 天内新注册的租户数量，含今天', to: '/registrations?range=7d',
    delta: deltaOf(s.value.new_this_week, s.value.new_prev_week, '较前 7 天'),
  },
  { label: '平台总用户', value: s.value.total_users, cls: '', foot: '全部注册账号数', tip: '全部租户下的注册账号总数', to: '/users' },
  { label: '数据总体积', value: s.value.total_db_size_mb, unit: '兆', cls: '', foot: '主库 + 全部租户库', tip: '主库与全部租户库文件占用之和', to: '' },
])

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
.plan-track { flex: 1; height: 10px; background: var(--bg-muted); border-radius: 5px; overflow: hidden; }
.plan-fill { height: 100%; background: linear-gradient(90deg, var(--brand), var(--brand-2)); border-radius: 5px; }
.plan-count { width: 40px; text-align: right; font-size: 13px; font-weight: 600; }
</style>
