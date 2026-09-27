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
      <!-- v287：仅新增时填写 —— 租户建完必须有账号才能登录，这两项与公司名同等必需 -->
      <template v-if="!isEdit">
        <div class="cred-sep">客户登录凭据</div>
        <p class="cred-hint">
          客户用这组账号密码登录。密码保存后<b>只显示这一次</b>，请当场复制发给客户。
        </p>
        <div class="field">
          <label for="tn-account">登录账号<span class="req" aria-hidden="true">*</span></label>
          <input
            id="tn-account"
            class="input"
            :class="{ error: errors.admin_account }"
            v-model="form.admin_account"
            placeholder="建议直接用客户手机号"
            aria-required="true"
            @input="accountTouched = true; errors.admin_account = ''"
          />
          <div v-if="errors.admin_account" class="field-error" role="alert">{{ errors.admin_account }}</div>
        </div>
        <div class="field">
          <label for="tn-pwd">初始密码<span class="req" aria-hidden="true">*</span></label>
          <div class="pwd-row">
            <input
              id="tn-pwd"
              class="input"
              :class="{ error: errors.admin_password }"
              v-model="form.admin_password"
              placeholder="至少 8 位，须含字母和数字"
              aria-required="true"
              @input="errors.admin_password = ''"
            />
            <button type="button" class="btn" @click="form.admin_password = genPassword()">换一个</button>
          </div>
          <div v-if="errors.admin_password" class="field-error" role="alert">{{ errors.admin_password }}</div>
          <div class="muted field-hint">已自动生成合规密码，可直接用；也可改成客户熟悉的</div>
        </div>
      </template>
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

    <!-- v287：开通成功后展示凭据 —— 密码只回传这一次，必须让操作者当场复制 -->
    <Modal :show="credShow" title="客户账号已创建" @close="credShow = false">
      <p class="cred-warn">
        密码<b>只显示这一次</b>，关闭后无法再查看。请先点「复制全部」再关闭。
      </p>
      <div class="cred-box">
        <div class="cred-line"><span>登录地址</span><b>{{ cred.url }}</b></div>
        <div class="cred-line"><span>公司</span><b>{{ cred.company }}</b></div>
        <div class="cred-line"><span>登录账号</span><b>{{ cred.account }}</b></div>
        <div class="cred-line"><span>初始密码</span><b>{{ cred.password }}</b></div>
      </div>
      <p class="cred-hint">把复制到的内容发给客户，并提醒首次登录后尽快修改密码。</p>
      <template #footer>
        <button class="btn ghost" @click="credShow = false">关闭（密码不再显示）</button>
        <button class="btn primary" @click="copyCred">复制全部</button>
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
  return {
    name: '', contact_name: '', contact_phone: '', plan: 'free', max_users: 5, is_active: 1,
    // v287：**仅新增时使用**。开通一个客户必须同时给出登录账号与初始密码，否则租户建完
    //   没有任何人能登录。后端 `POST /api/platform/onboard` 早已支持，此前前端调的却是
    //   只建租户的 `POST /api/tenants` ⇒ 账号永远缺失。
    admin_account: '', admin_password: '',
  }
}
function planLabel(p) {
  return { free: '免费版', pro: '专业版', enterprise: '企业版', '': '未设置' }[p] || p
}

// ---- v287：客户登录凭据（仅「新增」时使用）----
/** 初始密码：8 位，大写 / 小写 / 数字各至少一个；剔除易混淆的 0 O 1 l I。 */
function genPassword() {
  const up = 'ABCDEFGHJKMNPQRSTUVWXYZ'
  const lo = 'abcdefghjkmnpqrstuvwxyz'
  const di = '23456789'
  const all = up + lo + di
  const pick = (s) => s[Math.floor(Math.random() * s.length)]
  const out = [pick(up), pick(lo), pick(di)]
  while (out.length < 8) out.push(pick(all))
  return out.sort(() => Math.random() - 0.5).join('')
}
/** 账号建议值：优先用联系人手机号（客户自己记得住、唯一性好）；没填就留空由用户自己写。 */
function suggestAccount() {
  const phone = (form.value.contact_phone || '').replace(/\D/g, '')
  return phone.length >= 6 ? phone : ''
}
const credShow = ref(false)
const cred = ref({ url: '', company: '', account: '', password: '' })
// 账号一旦被手动改过就不再自动覆盖（避免"我改好了又被手机号顶掉"）
const accountTouched = ref(false)
watch(() => form.value.contact_phone, () => {
  if (isEdit.value || accountTouched.value) return
  const s = suggestAccount()
  if (s) form.value.admin_account = s
})
/** 把凭据拼成一段可直接转发给客户的文字（含首次登录须改密的提示）。 */
async function copyCred() {
  const c = cred.value
  const text = [
    '【Hergent AI 经营副驾】账号已开通',
    '登录地址：' + c.url,
    '登录账号：' + c.account,
    '初始密码：' + c.password,
    '首次登录后请立即修改密码。',
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    toast.ok('已复制，可直接发给客户')
  } catch (e) {
    toast.err('复制失败，请手动选中上面的内容复制')
  }
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
  form.value.admin_password = genPassword()   // v287：预生成合规初始密码，省一步手填
  accountTouched.value = false
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
      const acc = (form.value.admin_account || '').trim()
      const pwd = form.value.admin_password || ''
      // 本地只做**快速反馈**；真正的判据在后端（core.validate_username / _validate_password）
      if (!acc) { errors.value.admin_account = '请填写客户登录账号'; return }
      if (acc.toLowerCase() === 'admin') { errors.value.admin_account = '「admin」是系统内置账号，不能使用'; return }
      if (acc.length < 2 || acc.length > 32) { errors.value.admin_account = '账号需 2~32 个字符'; return }
      if (!pwd || pwd.length < 8) { errors.value.admin_password = '密码至少 8 位'; return }
      if (!(/\d/.test(pwd) && /[a-zA-Z]/.test(pwd))) { errors.value.admin_password = '密码需同时包含数字和字母'; return }
      // v287：改调 onboard —— 一次完成「建租户 + 建管理员账号 + 关联成员」并回传账号密码
      const res = await tenantApi.onboard({
        company_name: form.value.name,
        contact_name: form.value.contact_name,
        contact_phone: form.value.contact_phone,
        admin_account: acc,
        admin_password: pwd,
        plan: form.value.plan,
        max_users: form.value.max_users,
      })
      cred.value = {
        url: location.origin + '/',
        company: form.value.name,
        account: (res && res.username) || acc,
        password: (res && res.password) || pwd,
      }
      credShow.value = true
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
