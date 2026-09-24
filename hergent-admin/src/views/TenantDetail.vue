<template>
  <div>
    <Breadcrumb :items="[{ label: '租户管理', to: '/tenants' }, { label: tenant.name || '租户详情' }]" />

    <div v-if="loading" class="card">
      <Skeleton :rows="5" :widths="['18%', '36%', '26%', '20%']" />
    </div>

    <template v-else>
      <div class="card mb-20">
        <div class="card-head">
          <h3>{{ tenant.name }}</h3>
          <StatusBadge :active="tenant.is_active" />
        </div>
      </div>

      <div class="tabs" role="tablist">
        <button
          v-for="t in TABS" :key="t.k" type="button" role="tab"
          class="tab" :class="{ on: tab === t.k }"
          :aria-selected="tab === t.k" @click="tab = t.k"
        >{{ t.label }}<template v-if="t.k === 'members' && members.length">（{{ members.length }}）</template></button>
      </div>

      <!-- 概览 -->
      <div v-show="tab === 'overview'" class="card">
        <div class="card-body">
          <div class="kv">
            <span class="k">租户 ID</span><span class="v">{{ tenant.id }}</span>
            <span class="k">公司名</span><span class="v">{{ tenant.name }}</span>
            <span class="k">联系人</span><span class="v">{{ tenant.contact_name || '—' }}</span>
            <span class="k">手机号</span><span class="v">{{ tenant.contact_phone || '—' }}</span>
            <span class="k">套餐</span><span class="v">{{ planLabel(tenant.plan) }}</span>
            <span class="k">最大用户数</span><span class="v">{{ tenant.max_users }}</span>
            <span class="k">创建时间</span><span class="v">{{ tenant.created_at || '—' }}</span>
          </div>
        </div>
      </div>

      <!-- 用量 -->
      <div v-show="tab === 'usage'" class="card">
        <div class="card-body">
          <div class="usage-grid mb-20">
            <div class="stat-card">
              <div class="label">成员数 / 上限</div>
              <div class="value">{{ usage.member_count }} <span class="metric-unit">/ {{ usage.max_users }}</span></div>
            </div>
            <div class="stat-card">
              <div class="label">租户库体积</div>
              <div class="value">{{ usage.db_exists ? usage.db_size_mb + ' 兆' : '—' }}</div>
            </div>
            <div class="stat-card">
              <div class="label">数据库状态</div>
              <div class="value" :class="usage.db_exists ? 'success' : 'danger'">{{ usage.db_exists ? '正常' : '缺失' }}</div>
            </div>
          </div>
          <div class="section-title">核心业务表行数</div>
          <div v-if="!usage.db_exists" class="muted">租户库文件不存在，无法统计业务数据。</div>
          <div v-else class="table-wrap">
            <table class="tbl">
              <thead><tr><th>表</th><th>记录数</th></tr></thead>
              <tbody>
                <tr v-for="(v, k) in usage.data_stats" :key="k">
                  <td>{{ tableLabel(k) }}</td><td>{{ v }}</td>
                </tr>
                <tr v-if="Object.keys(usage.data_stats || {}).length === 0">
                  <td colspan="2">
                    <EmptyState
                      icon="dashboard"
                      title="暂无业务数据"
                      desc="该租户还没有商品、订单等业务记录，导入或开单后这里会自动统计"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 成员 -->
      <div v-show="tab === 'members'" class="card">
        <div class="card-head">
          <h3>成员列表</h3>
          <span class="spacer"></span>
          <div class="btn-row">
            <input class="input member-input" v-model="newMember" placeholder="输入已有账号名" aria-label="输入要加入该租户的账号名" />
            <button class="btn primary sm" :disabled="adding" @click="addMember">{{ adding ? '添加中…' : '添加成员' }}</button>
          </div>
        </div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>ID</th><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="m in members" :key="m.id">
                  <td>{{ m.id }}</td>
                  <td>{{ m.username }}</td>
                  <td>{{ m.display_name || '—' }}</td>
                  <td><Badge variant="neutral">{{ m.role }}</Badge></td>
                  <td><StatusBadge :active="m.is_active" /></td>
                  <td><button class="btn sm danger" @click="askRemoveMember(m)">移除</button></td>
                </tr>
                <tr v-if="members.length === 0">
                  <td colspan="6">
                    <EmptyState
                      icon="users"
                      title="暂无成员"
                      desc="在上方输入已有的平台账号名，即可把该账号加入这个租户"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <ConfirmDialog
      :show="confirmShow"
      title="移除成员"
      :text="'确认将「' + ((pendingMember && pendingMember.username) || '') + '」移出该租户？'"
      consequence="移除后该成员将立即失去这个租户的数据访问权限；其账号本身不会被删除，可随时重新添加。"
      :require-text="(pendingMember && pendingMember.username) || ''"
      confirm-label="确认移除"
      :busy="removing"
      @cancel="confirmShow = false"
      @confirm="doRemoveMember"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { tenantApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import Breadcrumb from '../components/Breadcrumb.vue'
import Badge from '../components/Badge.vue'
import Skeleton from '../components/Skeleton.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const toast = useToastStore()
const route = useRoute()
const id = route.params.id

const TABS = [
  { k: 'overview', label: '概览' },
  { k: 'usage', label: '用量' },
  { k: 'members', label: '成员' },
]
const tab = ref('overview')

const loading = ref(true)
const tenant = ref({})
const members = ref([])
const usage = ref({ member_count: 0, max_users: 0, db_exists: false, db_size_mb: 0, data_stats: {} })
const newMember = ref('')
const adding = ref(false)
const confirmShow = ref(false)
const removing = ref(false)
const pendingMember = ref(null)

function planLabel(p) { return { free: '免费版', pro: '专业版', enterprise: '企业版', '': '未设置' }[p] || p }
function tableLabel(k) {
  return {
    products: '商品主档', sale_orders: '销售订单', purchase_orders: '采购订单',
    inventory: '库存', forecast_orders: '预报订单',
  }[k] || k
}

async function load() {
  loading.value = true
  try {
    const [t, m, u] = await Promise.all([
      tenantApi.get(id), tenantApi.members(id), tenantApi.usage(id),
    ])
    tenant.value = t || {}
    members.value = (m && m.data) || []
    usage.value = (u && u.data) || usage.value
  } catch (e) {
    toast.err('加载失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    loading.value = false
  }
}
async function addMember() {
  const name = newMember.value.trim()
  if (!name) { toast.err('请输入账号名'); return }
  adding.value = true
  try {
    await tenantApi.addMember(id, { username: name, role: 'user' })
    toast.ok('已添加成员 ' + name)
    newMember.value = ''
    await load()
  } catch (e) {
    toast.err('添加失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    adding.value = false
  }
}
function askRemoveMember(m) {
  pendingMember.value = m
  confirmShow.value = true
}
async function doRemoveMember() {
  const m = pendingMember.value
  if (!m) return
  removing.value = true
  try {
    await tenantApi.removeMember(id, m.id)
    toast.ok('已移除')
    confirmShow.value = false
    pendingMember.value = null
    await load()
  } catch (e) {
    toast.err('移除失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    removing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.usage-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
</style>
