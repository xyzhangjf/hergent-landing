<template>
  <div>
    <div class="toolbar">
      <div class="pill-group">
        <span class="pill" :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</span>
        <span class="pill" :class="{ on: filter === 'on' }" @click="filter = 'on'">启用</span>
        <span class="pill" :class="{ on: filter === 'off' }" @click="filter = 'off'">停用</span>
      </div>
      <input class="search" v-model="keyword" placeholder="搜索公司名 / 联系人 / 手机号" />
      <span class="spacer"></span>
      <button class="btn primary" @click="openCreate">+ 新增租户</button>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>ID</th><th>公司名</th><th>联系人</th><th>手机号</th>
              <th>套餐</th><th>最大用户</th><th>状态</th><th>创建时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in filtered" :key="t.id">
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
                  <router-link :to="'/tenants/' + t.id" class="btn sm">详情</router-link>
                  <button class="btn sm" @click="toggle(t)">{{ t.is_active ? '停用' : '启用' }}</button>
                  <button class="btn sm" @click="openEdit(t)">编辑</button>
                </div>
              </td>
            </tr>
            <tr v-if="filtered.length === 0">
              <td colspan="9"><div class="empty">没有匹配的租户</div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal :show="modalShow" :title="isEdit ? '编辑租户' : '新增租户'" @close="modalShow = false">
      <div class="field">
        <label>公司名<span class="req">*</span></label>
        <input class="input" v-model="form.name" :disabled="isEdit" placeholder="客户公司名称" />
        <div v-if="isEdit" class="muted" style="font-size:12px;margin-top:4px">公司名创建后不可修改</div>
      </div>
      <div class="form-row">
        <div class="field">
          <label>联系人</label>
          <input class="input" v-model="form.contact_name" placeholder="联系人姓名" />
        </div>
        <div class="field">
          <label>手机号</label>
          <input class="input" v-model="form.contact_phone" placeholder="联系电话" />
        </div>
      </div>
      <div class="form-row">
        <div class="field">
          <label>套餐</label>
          <select class="select" v-model="form.plan">
            <option value="free">免费版</option>
            <option value="pro">专业版</option>
            <option value="enterprise">企业版</option>
          </select>
        </div>
        <div class="field">
          <label>最大用户数</label>
          <input class="input" type="number" min="1" v-model.number="form.max_users" />
        </div>
      </div>
      <div class="field" v-if="isEdit">
        <label>状态</label>
        <div class="pill-group">
          <span class="pill" :class="{ on: form.is_active }" @click="form.is_active = 1">启用</span>
          <span class="pill" :class="{ on: !form.is_active }" @click="form.is_active = 0">停用</span>
        </div>
      </div>
      <template #footer>
        <button class="btn ghost" @click="modalShow = false">取消</button>
        <button class="btn primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { tenantApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import StatusBadge from '../components/StatusBadge.vue'
import Modal from '../components/Modal.vue'

const toast = useToastStore()
const list = ref([])
const keyword = ref('')
const filter = ref('all')
const modalShow = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const editingId = ref(null)
const form = ref(blankForm())

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

async function load() {
  try {
    const data = await tenantApi.list(false)
    list.value = Array.isArray(data) ? data : (data.data || [])
  } catch (e) {
    toast.err('加载租户列表失败：' + (e instanceof ApiError ? e.message : e.message))
  }
}

function openCreate() {
  isEdit.value = false
  editingId.value = null
  form.value = blankForm()
  modalShow.value = true
}
function openEdit(t) {
  isEdit.value = true
  editingId.value = t.id
  form.value = {
    name: t.name, contact_name: t.contact_name || '', contact_phone: t.contact_phone || '',
    plan: t.plan || 'free', max_users: t.max_users || 5, is_active: t.is_active ? 1 : 0,
  }
  modalShow.value = true
}
async function save() {
  if (!form.value.name.trim()) { toast.err('请填写公司名'); return }
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
async function toggle(t) {
  try {
    await tenantApi.update(t.id, { is_active: t.is_active ? 0 : 1 })
    toast.ok(t.is_active ? '已停用' : '已启用')
    await load()
  } catch (e) {
    toast.err('操作失败：' + (e instanceof ApiError ? e.message : e.message))
  }
}

onMounted(load)
</script>
