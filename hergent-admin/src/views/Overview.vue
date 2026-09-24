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

      <div class="card mb-20">
        <div class="card-head">
          <h3>指标口径</h3>
          <span class="muted text-xs">每个数字怎么算的，写在这里 —— 避免"这数怎么不对"的扯皮</span>
          <div class="card-actions">
            <button class="btn sm" @click="glossaryOpen = !glossaryOpen">
              {{ glossaryOpen ? '收起' : '展开' }}
            </button>
          </div>
        </div>
        <div class="card-body" v-show="glossaryOpen">
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr><th>指标</th><th>含义</th><th>口径（分子 / 分母 / 时间窗）</th></tr>
              </thead>
              <tbody>
                <tr v-for="g in GLOSSARY" :key="g.name">
                  <td>{{ g.name }}</td>
                  <td>{{ g.meaning }}</td>
                  <td class="wrap muted">{{ g.caliber }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="glossary-note">
            通用约定：「人数」一律按<b>去重账号数</b>（不是人次）；「今日 / 近 7 天」按<b>服务器本地时区</b>的日期前缀判定；
            停用租户<b>仍计入</b>「租户总数」与「平台总用户」，<b>不计入</b>「启用中」。
          </div>
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
// 口径字典默认收起：它在下钻卡之后，展开不影响 KPI 首屏扫描
const glossaryOpen = ref(false)
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

// 指标口径字典（对标微信「指标解释」：把口径前置写进产品，而不是留给口头约定）。
// 🔴 每一条都必须与后端 erp_db.platform_stats() 的实现**逐字对应**，改实现时必须同改这里。
const GLOSSARY = [
  { name: '租户总数', meaning: '累计开通的客户数', caliber: '分子 = tenants 表全部行数（含已停用）；分母 = 无；时间窗 = 打开页面时实时统计' },
  { name: '启用中', meaning: '正常使用的租户', caliber: '分子 = tenants.is_active = 1 的行数；分母 = 无' },
  { name: '已停用', meaning: '已停服务、数据完整保留', caliber: '分子 = tenants.is_active = 0 的行数；分母 = 无（与「启用中」互补，二者之和 = 租户总数）' },
  { name: '今日新增', meaning: '今天注册的租户数', caliber: '分子 = created_at 的日期前缀 == 服务器当天；分母 = 无；时间窗 = 服务器本地时区今天 00:00 起。环比基准 = 昨天（同样只算一天）' },
  { name: '近 7 天新增', meaning: '滚动 7 天注册数（含今天）', caliber: '分子 = created_at 日期 ≥ 今天−6 天；时间窗 = 今天−6 … 今天，共 7 天。环比基准 = 今天−13 … 今天−7（同样 7 天、与本期不重叠）' },
  { name: '平台总用户', meaning: '全部注册账号数', caliber: '分子 = users 表全部行数（跨全部租户，含未绑定任何租户的账号）；分母 = 无' },
  { name: '数据总体积', meaning: '主库 + 全部租户库占用', caliber: '分子 = erp.db 与全部 tenant_*.db（含 -wal / -shm 临时文件）字节数之和 ÷ 1048576，保留 2 位；分母 = 无' },
  { name: '套餐分布', meaning: '各套餐的租户数', caliber: '分子 = 按 tenants.plan 分组计数；plan 为空的行归入「未设置」；分母 = 租户总数' },
]

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
.glossary-note {
  margin-top: 12px; padding: 10px 12px; font-size: 12px; line-height: 1.7;
  color: var(--text-2); background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
</style>
