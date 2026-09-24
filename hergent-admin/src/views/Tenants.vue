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

    <div class="card">
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
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
            <tr v-for="t in paged" :key="t.id">
              <td>{{ t.id }}</td>
              <td>{{ t.name }}</td>
              <td>{{ t.contact_name || '—' }}</td>
              <td>{{ t.contact_phone || '—' }}</td>
              <td><span class="badge neutral">{{ planLabel(t.plan) }}</span></td>
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
              <td colspan="9"><div class="loading-box">加载中…</div></td>
            </tr>
            <tr v-else-if="filtered.length === 0">
              <td colspan="9">
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
      <Pager
        :total="filtered.length"
        :page="page"
        :page-size="PAGE_SIZE"
        @update:page="page = $event"
      />
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
            <option value="free">免费版</option>
            <option value="pro">专业版</option>
            <option value="enterprise">企业版</option>
          </select>
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { tenantApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import StatusBadge from '../components/StatusBadge.vue'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Pager from '../components/Pager.vue'
import SortTh from '../components/SortTh.vue'
import { sortRows, pageSlice, PAGE_SIZE } from '../utils/table'

const toast = useToastStore()
const list = ref([])
const loading = ref(false)
const keyword = ref('')
const filter = ref('all')
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

function blankForm() {
  return { name: '', contact_name: '', contact_phone: '', plan: 'free', max_users: 5, is_active: 1 }
}
function planLabel(p) {
  return { free: '免费版', pro: '专业版', enterprise: '企业版', '': '未设置' }[p] || p
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return list.value.filter((t) => {
    if (filter.value === 'on' && !t.is_active) return false
    if (filter.value === 'off' && t.is_active) return false
    if (!kw) return true
    return (
      (t.name || '').toLowerCase().includes(kw) ||
      (t.contact_name || '').toLowerCase().includes(kw) ||
      (t.contact_phone || '').toLowerCase().includes(kw)
    )
  })
})

// 排序 + 分页：当前在本地完成，数据量上千后改为后端 order_by / limit
const paged = computed(() =>
  pageSlice(sortRows(filtered.value, sortKey.value, sortDir.value), page.value)
)
function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'asc' }
  page.value = 1
}
// 筛选条件变化后回到第一页，避免停在一个已不存在的页码
watch([keyword, filter], () => { page.value = 1 })

async function load() {
  loading.value = true
  try {
    const data = await tenantApi.list(false)
    list.value = Array.isArray(data) ? data : (data.data || [])
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
  try {
    await tenantApi.update(target.id, { is_active: target.is_active ? 0 : 1 })
    toast.ok(target.is_active ? '已停用' : '已启用')
    confirmShow.value = false
    pendingToggle.value = null
    await load()
  } catch (e) {
    toast.err('操作失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    toggling.value = false
  }
}

onMounted(load)
</script>
