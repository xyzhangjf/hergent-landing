<template>
  <div>
    <div class="toolbar">
      <span class="spacer"></span>
      <button class="btn primary" @click="openCreate">+ 生成邀请码</button>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr><th>邀请码</th><th>备注</th><th>已用 / 上限</th><th>有效期</th><th>状态</th><th>创建人</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in codes" :key="c.code || c.id">
              <td><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">{{ c.code }}</code></td>
              <td class="wrap">{{ c.label || c.note || '—' }}</td>
              <td>{{ c.used_count != null ? c.used_count : '—' }} / {{ c.max_uses == 0 ? '不限' : (c.max_uses ?? '—') }}</td>
              <td class="muted">{{ c.expires_at || '永久' }}</td>
              <td>
                <span class="badge" :class="c.is_active ? 'on' : 'off'">
                  <span class="dot"></span>{{ c.is_active ? '有效' : '已停用' }}
                </span>
              </td>
              <td class="muted">{{ c.created_by || '—' }}</td>
              <td>
                <div class="btn-row">
                  <button class="btn sm" @click="toggle(c)">{{ c.is_active ? '停用' : '启用' }}</button>
                  <button class="btn sm danger" @click="askRemove(c)">删除</button>
                </div>
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="7"><div class="loading-box">加载中…</div></td>
            </tr>
            <tr v-else-if="codes.length === 0">
              <td colspan="7">
                <EmptyState
                  icon="ticket"
                  title="还没有邀请码"
                  desc="生成邀请码后发给客户，客户凭码自助注册并自动归属到对应租户"
                  action-label="+ 生成邀请码"
                  @action="openCreate"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal :show="modalShow" title="生成邀请码" @close="modalShow = false">
      <div class="field">
        <label>备注 / 渠道</label>
        <input class="input" v-model="form.label" placeholder="如：2026秋季推广" />
      </div>
      <div class="form-row">
        <div class="field">
          <label>使用上限</label>
          <input class="input" type="number" min="0" v-model.number="form.max_uses" placeholder="0 = 不限" />
        </div>
        <div class="field">
          <label>有效期至</label>
          <input class="input" v-model="form.expires_at" placeholder="留空=永久 (YYYY-MM-DD)" />
        </div>
      </div>
      <div class="field">
        <label>指定码（可选）</label>
        <input class="input" v-model="form.code" placeholder="留空自动生成" />
      </div>
      <template #footer>
        <button class="btn ghost" @click="modalShow = false">取消</button>
        <button class="btn primary" :disabled="saving" @click="create">{{ saving ? '生成中…' : '生成' }}</button>
      </template>
    </Modal>

    <ConfirmDialog
      :show="confirmShow"
      title="删除邀请码"
      :text="'确认删除邀请码「' + ((pendingRemove && pendingRemove.code) || '') + '」？'"
      consequence="删除后该码立即失效，尚未注册的人将无法再使用；已核销的注册流水会保留，不受影响。"
      confirm-label="确认删除"
      :busy="removing"
      @cancel="confirmShow = false"
      @confirm="doRemove"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { inviteApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const toast = useToastStore()
const codes = ref([])
const loading = ref(false)
const modalShow = ref(false)
const saving = ref(false)
const confirmShow = ref(false)
const removing = ref(false)
const pendingRemove = ref(null)
const form = ref({ label: '', max_uses: 1, expires_at: '', code: '' })

async function load() {
  loading.value = true
  try {
    const data = await inviteApi.list()
    codes.value = (data && data.codes) || []
  } catch (e) {
    toast.err('加载失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    loading.value = false
  }
}
function openCreate() {
  form.value = { label: '', max_uses: 1, expires_at: '', code: '' }
  modalShow.value = true
}
async function create() {
  saving.value = true
  try {
    await inviteApi.create({
      label: form.value.label, max_uses: form.value.max_uses || 0,
      expires_at: form.value.expires_at, code: form.value.code,
    })
    toast.ok('邀请码已生成')
    modalShow.value = false
    await load()
  } catch (e) {
    toast.err('生成失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    saving.value = false
  }
}
async function toggle(c) {
  try {
    await inviteApi.setStatus({ code_or_id: c.code || c.id, active: !c.is_active })
    toast.ok('已更新状态')
    await load()
  } catch (e) {
    toast.err('操作失败：' + (e instanceof ApiError ? e.message : e.message))
  }
}
function askRemove(c) {
  pendingRemove.value = c
  confirmShow.value = true
}
async function doRemove() {
  const c = pendingRemove.value
  if (!c) return
  removing.value = true
  try {
    await inviteApi.remove(c.code || c.id)
    toast.ok('已删除')
    confirmShow.value = false
    pendingRemove.value = null
    await load()
  } catch (e) {
    toast.err('删除失败：' + (e instanceof ApiError ? e.message : e.message))
  } finally {
    removing.value = false
  }
}

onMounted(load)
</script>
