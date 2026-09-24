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
            <tr>
              <SortTh label="邀请码" field="code" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>备注</th>
              <SortTh label="已用 / 上限" field="used_count" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <SortTh label="有效期" field="expires_at" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>状态</th><th>创建人</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in paged" :key="c.code || c.id">
              <td><code class="code-chip">{{ c.code }}</code></td>
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
      <Pager
        :total="codes.length"
        :page="page"
        :page-size="PAGE_SIZE"
        @update:page="page = $event"
      />
    </div>

    <Modal :show="modalShow" title="生成邀请码" @close="modalShow = false">
      <div class="field">
        <label for="ic-label">备注 / 渠道</label>
        <input id="ic-label" class="input" v-model="form.label" placeholder="如：2026秋季推广" />
      </div>
      <div class="form-row">
        <div class="field">
          <label for="ic-maxuses">使用上限</label>
          <input
            id="ic-maxuses"
            class="input"
            :class="{ error: errors.max_uses }"
            type="number"
            min="0"
            v-model.number="form.max_uses"
            placeholder="0 = 不限"
            :aria-describedby="errors.max_uses ? 'ic-maxuses-err' : undefined"
            @input="errors.max_uses = ''"
          />
          <div v-if="errors.max_uses" id="ic-maxuses-err" class="field-error" role="alert">{{ errors.max_uses }}</div>
        </div>
        <div class="field">
          <label for="ic-expires">有效期至</label>
          <input
            id="ic-expires"
            class="input"
            :class="{ error: errors.expires_at }"
            v-model="form.expires_at"
            placeholder="留空=永久（年-月-日，例如 2026-12-31）"
            :aria-describedby="errors.expires_at ? 'ic-expires-err' : undefined"
            @input="errors.expires_at = ''"
          />
          <div v-if="errors.expires_at" id="ic-expires-err" class="field-error" role="alert">{{ errors.expires_at }}</div>
        </div>
      </div>
      <div class="field">
        <label for="ic-code">指定码（可选）</label>
        <input id="ic-code" class="input" v-model="form.code" placeholder="留空自动生成" />
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
import { ref, computed, onMounted, watch } from 'vue'
import { inviteApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import Modal from '../components/Modal.vue'
import EmptyState from '../components/EmptyState.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Pager from '../components/Pager.vue'
import SortTh from '../components/SortTh.vue'
import { sortRows, pageSlice, PAGE_SIZE } from '../utils/table'

const toast = useToastStore()
const codes = ref([])
const loading = ref(false)
const modalShow = ref(false)
const saving = ref(false)
const confirmShow = ref(false)
const removing = ref(false)
const pendingRemove = ref(null)
const page = ref(1)
const sortKey = ref('')
const sortDir = ref('asc')
const errors = ref({})

const paged = computed(() =>
  pageSlice(sortRows(codes.value, sortKey.value, sortDir.value), page.value)
)
function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'asc' }
  page.value = 1
}
watch(codes, () => { page.value = 1 })
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
  errors.value = {}
  modalShow.value = true
}
async function create() {
  errors.value = {}
  const mu = Number(form.value.max_uses)
  if (Number.isNaN(mu) || mu < 0) {
    errors.value.max_uses = '使用上限不能为负数，填 0 表示不限'
    return
  }
  const exp = (form.value.expires_at || '').trim()
  if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
    errors.value.expires_at = '日期格式应为 年-月-日，例如 2026-12-31'
    return
  }
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
