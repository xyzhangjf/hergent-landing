<template>
  <div>
    <div class="toolbar">
      <div class="pill-group" role="group" aria-label="按状态筛选租户">
        <button type="button" class="pill" :class="{ on: filter === 'all' }" :aria-pressed="filter === 'all'" @click="filter = 'all'">全部</button>
        <button type="button" class="pill" :class="{ on: filter === 'on' }" :aria-pressed="filter === 'on'" @click="filter = 'on'">启用</button>
        <button type="button" class="pill" :class="{ on: filter === 'off' }" :aria-pressed="filter === 'off'" @click="filter = 'off'">停用</button>
      </div>
      <input class="search" v-model="keyword" aria-label="搜索公司名 / 联系人 / 手机号" placeholder="搜索公司名 / 联系人 / 手机号" />
      <span class="spacer"></span>
      <button class="btn primary" @click="openCreate">+ 新增租户</button>
    </div>

    <div class="bulk-bar" v-if="selected.length > 0">
      <span>已选 <span class="bulk-count">{{ selected.length }}</span> 个租户（当前页）</span>
      <div class="btn-row">
        <button class="btn sm" :disabled="bulkBusy" @click="bulkSetActive(1)">批量启用</button>
        <button class="btn sm danger" :disabled="bulkBusy" @click="bulkConfirmShow = true">批量停用</button>
        <button class="link-btn" @click="selected = []">取消选择</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>租户列表</h3>
        <span class="muted text-xs">共 {{ total }} 家</span>
        <div class="card-actions">
          <button class="btn sm icon-only" :disabled="loading" aria-label="刷新" title="刷新" @click="load">
            <Icon name="refresh" :size="15" />
          </button>
          <button class="btn sm" :disabled="loading || total === 0" @click="onExport">
            <Icon name="download" :size="14" /> 导出
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th class="col-check">
                <input class="chk" type="checkbox" :checked="allSelected" :disabled="list.length === 0"
                       aria-label="全选本页租户" @change="toggleAll" />
              </th>
              <SortTh label="ID" field="id" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <SortTh label="公司名" field="name" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>联系人</th><th>手机号</th>
              <th>套餐</th>
              <SortTh label="最大用户" field="max_users" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>状态</th>
              <SortTh label="创建时间" field="created_at" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in list" :key="t.id">
              <td class="col-check">
                <input class="chk" type="checkbox" :checked="selected.includes(t.id)"
                       :aria-label="'选择租户 ' + t.name" @change="toggleOne($event, t)" />
              </td>
              <td>{{ t.id }}</td>
              <td>{{ t.name }}</td>
              <td>{{ t.contact_name || '—' }}</td>
              <td>{{ t.contact_phone || '—' }}</td>
              <td><Badge variant="neutral" :title="capsTitle(t.plan)">{{ planLabel(t.plan) }}</Badge></td>
              <td>{{ t.max_users }}</td>
              <td><StatusBadge :active="t.is_active" /></td>
              <td class="muted">{{ t.created_at || '—' }}</td>
              <td>
                <div class="btn-row">
                  <router-link :to="'/tenants/' + t.id" class="link-btn">详情</router-link>
                  <!-- 启停是破坏性操作，保留实心按钮；详情/编辑降级为文字链接 -->
                  <button class="btn sm" @click="askToggle(t)">{{ t.is_active ? '停用' : '启用' }}</button>
                  <button class="link-btn" @click="openEdit(t)">编辑</button>
                </div>
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="10"><Skeleton :rows="5" :widths="['4%', '8%', '22%', '14%', '14%', '12%', '10%']" /></td>
            </tr>
            <tr v-else-if="list.length === 0">
              <td colspan="10">
                <EmptyState
                  icon="building"
                  :title="keyword.trim() || filter !== 'all' ? '没有匹配的租户' : '还没有租户'"
                  :desc="keyword.trim() || filter !== 'all'
                    ? '换个关键词，或把筛选切回「全部」试试'
                    : '创建第一个租户后，就能在这里统一管理套餐、成员与启停状态'"
                  :action-label="keyword.trim() || filter !== 'all' ? '' : '+ 新增租户'"
                  @action="openCreate"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pager :total="total" :page="page" :page-size="PAGE_SIZE" @update:page="page = $event" />
    </div>

    <Modal :show="modalShow" :title="isEdit ? '编辑租户' : '新增租户'" @close="modalShow = false">
      <div class="field">
        <label for="tn-name">公司名<span class="req" aria-hidden="true">*</span></label>
        <input
          id="tn-name"
          class="input"
          :class="{ error: errors.name }"
          v-model="form.name"
          :disabled="isEdit"
          placeholder="客户公司名称"
          aria-required="true"
          :aria-describedby="errors.name ? 'tn-name-err' : undefined"
          @input="errors.name = ''"
        />
        <div v-if="errors.name" id="tn-name-err" class="field-error" role="alert">{{ errors.name }}</div>
        <div v-if="isEdit" class="muted field-hint">公司名创建后不可修改</div>
      </div>
      <div class="form-row">
        <div class="field">
          <label for="tn-contact">联系人</label>
          <input id="tn-contact" class="input" v-model="form.contact_name" placeholder="联系人姓名" />
        </div>
        <div class="field">
          <label for="tn-phone">手机号</label>
          <input id="tn-phone" class="input" v-model="form.contact_phone" placeholder="联系电话" />
        </div>
      </div>
      <div class="form-row">
        <div class="field">
          <label for="tn-plan">套餐</label>
          <select id="tn-plan" class="select" v-model="form.plan">
            <option v-for="p in PLAN_ORDER" :key="p" :value="p">
              {{ planLabel(p) }}{{ capsSummary(p) ? '（' + capsSummary(p) + '）' : '' }}
            </option>
          </select>
          <!-- v266：改套餐时直接告诉操作者「这个套餐含什么」——以前只有一个套餐名，
               改完之后谁也说不清给了客户什么能力。 -->
          <div v-if="capsTitle(form.plan)" class="field-hint">{{ capsTitle(form.plan) }}</div>
        </div>
        <div class="field">
          <label for="tn-maxusers">最大用户数</label>
          <input
            id="tn-maxusers"
            class="input"
            :class="{ error: errors.max_users }"
            type="number"
            min="1"
            v-model.number="form.max_users"
            aria-required="true"
            :aria-describedby="errors.max_users ? 'tn-maxusers-err' : undefined"
            @input="errors.max_users = ''"
          />
          <div v-if="errors.max_users" id="tn-maxusers-err" class="field-error" role="alert">{{ errors.max_users }}</div>
        </div>
      </div>
      <div class="field" v-if="isEdit">
        <label id="tn-status-label">状态</label>
        <div class="pill-group" role="group" aria-labelledby="tn-status-label">
          <button type="button" class="pill" :class="{ on: form.is_active }" :aria-pressed="!!form.is_active" @click="form.is_active = 1">启用</button>
          <button type="button" class="pill" :class="{ on: !form.is_active }" :aria-pressed="!form.is_active" @click="form.is_active = 0">停用</button>
        </div>
      </div>
      <template #footer>
        <button class="btn ghost" @click="modalShow = false">取消</button>
        <button class="btn primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>

    <ConfirmDialog
      :show="confirmShow"
      title="停用租户"
      :text="'确认停用「' + ((pendingToggle && pendingToggle.name) || '') + '」？'"
      consequence="停用后该租户下所有账号将立即无法登录，数据完整保留；可随时重新启用。"
      confirm-label="确认停用"
      :busy="toggling"
      @cancel="confirmShow = false"
      @confirm="doToggle()"
    />

    <ConfirmDialog
      :show="bulkConfirmShow"
      title="批量停用租户"
      :text="'确认停用本页选中的 ' + selected.length + ' 个租户？'"
      consequence="停用后这些租户下所有账号将立即无法登录，数据完整保留；可随时重新启用。"
      confirm-label="确认停用"
      :busy="bulkBusy"
      @cancel="bulkConfirmShow = false"
      @confirm="bulkSetActive(0)"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { tenantApi, planApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import { exportCsv } from '../utils/csv'
import { PAGE_SIZE } from '../utils/table'
import Icon from '../components/Icon.vue'
import Badge from '../components/Badge.vue'
import Skeleton from '../components/Skeleton.vue'
import StatusBadge from '../components/StatusBadge.vue'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Pager from '../components/Pager.vue'
import SortTh from '../components/SortTh.vue'

const route = useRoute()
const toast = useToastStore()

/* v266 套餐 → 能力对照（来自 `/api/platform/plans`，权威源 = 后端 `core._PLAN_CAPS`）。
   🔴 前端**不硬编码任何能力名**：改套餐时显示的「含哪些能力」必须与后端真实裁决逐字一致，
      否则就是把一个实际没有的能力卖给客户（或反过来不敢卖）。 */
const plans = ref({})
const PLAN_ORDER = ['free', 'pro', 'enterprise']
async function loadPlans() {
  try {
    const d = await planApi.list()
    plans.value = (d && d.plans) || {}
  } catch (e) {
    plans.value = {}      // 拉不到就只显示套餐名，不显示能力说明（宁可少说，不说错）
  }
}
/** 下拉项里的一句摘要（只讲**差异点**，不罗列布尔值）。 */
function capsSummary(p) {
  const c = plans.value[p]
  if (!c) return ''
  const bits = [c.max_users ? `${c.max_users} 人` : '不限人数']
  if (c.bulk_export) bits.push('批量导出')
  if (c.api) bits.push('API 拉取')
  return bits.join(' · ')
}
/** 悬停说明：该套餐**含**哪些能力（比罗列 false 更有用）。 */
function capsTitle(p) {
  const c = plans.value[p]
  if (!c) return planLabel(p)
  const yes = []
  if (c.view) yes.push('查看与分析')
  if (c.export) yes.push('手动导出')
  if (c.bulk_export) yes.push('批量导出')
  if (c.api) yes.push('API 拉取')
  return `${planLabel(p)}：${yes.join(' / ') || '—'}；成员上限 ${c.max_users || '不限'}`
}

const list = ref([])
const total = ref(0)
const loading = ref(false)
const keyword = ref('')
const debouncedKeyword = ref('')
let kwTimer = null
watch(keyword, (v) => {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(() => { debouncedKeyword.value = v.trim() }, 300)
})

// 支持从总览 KPI 卡下钻：/tenants?status=off
const initStatus = String(route.query.status || '')
const filter = ref(['on', 'off'].includes(initStatus) ? initStatus : 'all')
const page = ref(1)
const sortKey = ref('')
const sortDir = ref('asc')
const errors = ref({})
const modalShow = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const editingId = ref(null)
const form = ref(blankForm())
const confirmShow = ref(false)
const toggling = ref(false)
const pendingToggle = ref(null)
const selected = ref([])
const bulkBusy = ref(false)
const bulkConfirmShow = ref(false)

function blankForm() {
  return { name: '', contact_name: '', contact_phone: '', plan: 'free', max_users: 5, is_active: 1 }
}
function planLabel(p) {
  return { free: '免费版', pro: '专业版', enterprise: '企业版', '': '未设置' }[p] || p
}

// 查询签名：任一参数变化即请求一次（服务端分页/搜索/排序）
const sig = computed(() => JSON.stringify({
  k: debouncedKeyword.value, f: filter.value, p: page.value,
  s: sortKey.value, d: sortDir.value,
}))
// 顺序：先「筛选变化回第一页」，再「签名变化即拉取」，保证只发一次请求
watch([debouncedKeyword, filter], () => { page.value = 1 })
watch(sig, load)

function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'asc' }
  page.value = 1
}

// ---- 多选（当前页）----
const allSelected = computed(
  () => list.value.length > 0 && selected.value.length === list.value.length
)
function toggleAll(e) { selected.value = e.target.checked ? list.value.map((t) => t.id) : [] }
function toggleOne(e, t) {
  if (e.target.checked) {
    if (!selected.value.includes(t.id)) selected.value = [...selected.value, t.id]
  } else {
    selected.value = selected.value.filter((x) => x !== t.id)
  }
}

const EXPORT_COLS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: '公司名' },
  { key: 'contact_name', label: '联系人' },
  { key: 'contact_phone', label: '手机号' },
  { key: 'plan', label: '套餐' },
  { key: 'max_users', label: '最大用户数' },
  { key: 'is_active', label: '状态' },
  { key: 'created_at', label: '创建时间' },
]

// 导出**当前筛选下的全部**（不是当前页）：limit=0 让后端不分页
async function onExport() {
  try {
    const data = await tenantApi.list({
      q: debouncedKeyword.value, status: filter.value === 'all' ? '' : filter.value,
      order_by: sortKey.value, order_dir: sortDir.value, limit: 0,
    })
    const rows = ((data && data.data) || []).map((t) => ({
      ...t, plan: planLabel(t.plan), is_active: t.is_active ? '启用' : '停用',
    }))
    exportCsv('租户列表', EXPORT_COLS, rows)
    toast.ok('已导出 ' + rows.length + ' 条')
  } catch (e) {
    toast.err('导出失败：' + (e instanceof ApiError ? e.message : e.message))
  }
}

async function load() {
  loading.value = true
  try {
    const data = await tenantApi.list({
      q: debouncedKeyword.value,
      status: filter.value === 'all' ? '' : filter.value,
      order_by: sortKey.value,
      order_dir: sortDir.value,
      limit: PAGE_SIZE,
      offset: (page.value - 1) * PAGE_SIZE,
    })
    list.value = (data && data.data) || []
    total.value = (data && data.total) || 0
    // 翻页后剔除本页已不存在的选择
    const ids = new Set(list.value.map((t) => t.id))
    selected.value = selected.value.filter((id) => ids.has(id))
  } catch (e) {
    toast.err('加载租户列表失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  isEdit.value = false
  editingId.value = null
  form.value = blankForm()
  errors.value = {}
  modalShow.value = true
}
function openEdit(t) {
  isEdit.value = true
  editingId.value = t.id
  errors.value = {}
  form.value = {
    name: t.name, contact_name: t.contact_name || '', contact_phone: t.contact_phone || '',
    plan: t.plan || 'free', max_users: t.max_users || 5, is_active: t.is_active ? 1 : 0,
  }
  modalShow.value = true
}
async function save() {
  // 字段级校验：错误定位到具体输入框，不依赖会自动消失的 toast
  errors.value = {}
  if (!form.value.name.trim()) { errors.value.name = '请填写公司名'; return }
  const mu = Number(form.value.max_users)
  if (!mu || mu < 1) { errors.value.max_users = '最大用户数至少为 1'; return }
  saving.value = true
  try {
    if (isEdit.value) {
      await tenantApi.update(editingId.value, {
        name: form.value.name, contact_name: form.value.contact_name,
        contact_phone: form.value.contact_phone, plan: form.value.plan,
        max_users: form.value.max_users, is_active: form.value.is_active,
      })
      toast.ok('已保存')
    } else {
      await tenantApi.create({
        name: form.value.name, contact_name: form.value.contact_name,
        contact_phone: form.value.contact_phone, plan: form.value.plan,
        max_users: form.value.max_users,
      })
      toast.ok('租户已创建')
    }
    modalShow.value = false
    await load()
  } catch (e) {
    toast.err('保存失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    saving.value = false
  }
}

// 停用（破坏性）先确认；启用（恢复性、安全）直接执行
function askToggle(t) {
  if (t.is_active) {
    pendingToggle.value = t
    confirmShow.value = true
  } else {
    doToggle(t)
  }
}
async function doToggle(t) {
  const target = t || pendingToggle.value
  if (!target) return
  toggling.value = true
  const wasActive = target.is_active
  try {
    await tenantApi.update(target.id, { is_active: wasActive ? 0 : 1 })
    confirmShow.value = false
    pendingToggle.value = null
    await load()
    // P2-5：启停可逆 ⇒ 用「撤销」代替二次确认（确认只留给不可逆操作）
    toast.ok(wasActive ? '已停用' : '已启用', {
      label: '撤销',
      run: async () => {
        try {
          await tenantApi.update(target.id, { is_active: wasActive ? 1 : 0 })
          toast.ok('已撤销')
          await load()
        } catch (e) {
          toast.err('撤销失败：' + (e instanceof ApiError ? e.message : e.message))
        }
      },
    })
  } catch (e) {
    toast.err('操作失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    toggling.value = false
  }
}

// ---- 批量启停：逐个串行调用（后端无批量端点）----
async function bulkSetActive(active) {
  bulkBusy.value = true
  const targets = list.value.filter((t) => selected.value.includes(t.id))
  const done = []
  let ok = 0
  let fail = 0
  for (const t of targets) {
    if (!!t.is_active === !!active) continue
    try {
      await tenantApi.update(t.id, { is_active: active })
      ok++
      done.push(t)   // 记下改前的值，供撤销还原
    } catch (e) {
      fail++
    }
  }
  selected.value = []
  bulkConfirmShow.value = false
  bulkBusy.value = false
  await load()
  toast.ok('已' + (active ? '启用' : '停用') + ' ' + ok + ' 个' + (fail ? '，失败 ' + fail + ' 个' : ''), {
    label: '撤销',
    run: async () => {
      let undoFail = 0
      for (const t of done) {
        try {
          await tenantApi.update(t.id, { is_active: t.is_active ? 1 : 0 })
        } catch (e) {
          undoFail++
        }
      }
      toast.ok('已撤销 ' + (done.length - undoFail) + ' 个' + (undoFail ? '，失败 ' + undoFail + ' 个' : ''))
      await load()
    },
  })
}

onMounted(() => {
  // 命令面板「新增租户」入口：/tenants?new=1
  if (String(route.query.new || '') === '1') openCreate()
  loadPlans()   // 套餐能力对照先拉一次（下拉与提示都据此渲染，不硬编码能力名）
  load()
})
</script>
