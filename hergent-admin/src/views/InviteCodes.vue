<template>
  <div>
    <div class="toolbar">
      <span class="spacer"></span>
      <button class="btn primary" @click="openCreate">+ 生成邀请码</button>
    </div>

    <div class="bulk-bar" v-if="selected.length > 0">
      <span>已选 <span class="bulk-count">{{ selected.length }}</span> 个邀请码</span>
      <div class="btn-row">
        <button class="btn sm" :disabled="bulkBusy" @click="bulkSetStatus(true)">批量启用</button>
        <button class="btn sm" :disabled="bulkBusy" @click="bulkSetStatus(false)">批量停用</button>
        <button class="btn sm danger" :disabled="bulkBusy" @click="bulkConfirmShow = true">批量删除</button>
        <button class="link-btn" @click="selected = []">取消选择</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>邀请码</h3>
        <span class="muted text-xs">共 {{ codes.length }} 个</span>
        <div class="card-actions">
          <button class="btn sm icon-only" :disabled="loading" aria-label="刷新" title="刷新" @click="load">
            <Icon name="refresh" :size="15" />
          </button>
          <button class="btn sm" :disabled="loading || codes.length === 0" @click="onExport">
            <Icon name="download" :size="14" /> 导出
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th class="col-check">
                <input class="chk" type="checkbox" :checked="allSelected" :disabled="codes.length === 0"
                       aria-label="全选邀请码" @change="toggleAll" />
              </th>
              <SortTh label="邀请码" field="code" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>备注</th>
              <SortTh label="已用 / 上限" field="used_count" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <SortTh label="有效期" field="expires_at" :sort-key="sortKey" :sort-dir="sortDir" @toggle="toggleSort" />
              <th>状态</th><th>创建人</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in paged" :key="keyOf(c)">
              <td class="col-check">
                <input class="chk" type="checkbox" :checked="selected.includes(keyOf(c))"
                       :aria-label="'选择邀请码 ' + c.code" @change="toggleOne($event, c)" />
              </td>
              <td><code class="code-chip">{{ c.code }}</code></td>
              <td class="wrap">{{ c.label || c.note || '—' }}</td>
              <td>{{ c.used_count != null ? c.used_count : '—' }} / {{ c.max_uses == 0 ? '不限' : (c.max_uses ?? '—') }}</td>
              <td class="muted">{{ c.expires_at || '永久' }}</td>
              <td>
                <Badge :variant="c.is_active ? 'success' : 'danger'">{{ c.is_active ? '有效' : '已停用' }}</Badge>
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
              <td colspan="8"><Skeleton :rows="4" :widths="['4%', '20%', '22%', '14%', '14%', '12%', '12%']" /></td>
            </tr>
            <tr v-else-if="codes.length === 0">
              <td colspan="8">
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
      :require-text="(pendingRemove && pendingRemove.code) || ''"
      confirm-label="确认删除"
      :busy="removing"
      @cancel="confirmShow = false"
      @confirm="doRemove"
    />

    <ConfirmDialog
      :show="bulkConfirmShow"
      title="批量删除邀请码"
      :text="'确认删除选中的 ' + selected.length + ' 个邀请码？'"
      consequence="删除后这些码立即失效，尚未注册的人将无法再使用；已核销的注册流水会保留，不受影响。"
      confirm-label="确认删除"
      :busy="bulkBusy"
      @cancel="bulkConfirmShow = false"
      @confirm="bulkRemove"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { inviteApi, ApiError } from '../api/client'
import { useToastStore } from '../store/toast'
import { exportCsv } from '../utils/csv'
import Icon from '../components/Icon.vue'
import Badge from '../components/Badge.vue'
import Skeleton from '../components/Skeleton.vue'
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
const selected = ref([])
const bulkBusy = ref(false)
const bulkConfirmShow = ref(false)

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

// ---- 多选 ----
function keyOf(c) { return c.code || c.id }
const allSelected = computed(
  () => codes.value.length > 0 && selected.value.length === codes.value.length
)
function toggleAll(e) {
  selected.value = e.target.checked ? codes.value.map(keyOf) : []
}
function toggleOne(e, c) {
  const k = keyOf(c)
  if (e.target.checked) {
    if (!selected.value.includes(k)) selected.value = [...selected.value, k]
  } else {
    selected.value = selected.value.filter((x) => x !== k)
  }
}
const selectedCodes = computed(() => codes.value.filter((c) => selected.value.includes(keyOf(c))))

function onExport() {
  exportCsv('邀请码', [
    { key: 'code', label: '邀请码' },
    { key: 'label', label: '备注' },
    { key: 'used_count', label: '已用' },
    { key: 'max_uses', label: '上限' },
    { key: 'expires_at', label: '有效期至' },
    { key: 'is_active', label: '状态' },
    { key: 'created_by', label: '创建人' },
  ], sortRows(codes.value, sortKey.value, sortDir.value).map((c) => ({
    ...c, is_active: c.is_active ? '有效' : '已停用',
  })))
}

async function load() {
  loading.value = true
  try {
    const data = await inviteApi.list()
    codes.value = (data && data.codes) || []
    // 列表刷新后剔除已不存在的选择，避免批量操作打到幽灵条目
    const keys = new Set(codes.value.map(keyOf))
    selected.value = selected.value.filter((k) => keys.has(k))
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
    await inviteApi.setStatus({ code_or_id: keyOf(c), active: !c.is_active })
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
    await inviteApi.remove(keyOf(c))
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

// ---- 批量操作：逐个串行调用，统计成功/失败（后端无批量端点）----
async function bulkSetStatus(active) {
  bulkBusy.value = true
  let ok = 0
  let fail = 0
  for (const c of selectedCodes.value) {
    if (!!c.is_active === active) continue
    try { await inviteApi.setStatus({ code_or_id: keyOf(c), active }); ok++ } catch (e) { fail++ }
  }
  toast.ok('已' + (active ? '启用' : '停用') + ' ' + ok + ' 个' + (fail ? '，失败 ' + fail + ' 个' : ''))
  selected.value = []
  bulkBusy.value = false
  await load()
}
async function bulkRemove() {
  bulkBusy.value = true
  let ok = 0
  let fail = 0
  for (const c of selectedCodes.value) {
    try { await inviteApi.remove(keyOf(c)); ok++ } catch (e) { fail++ }
  }
  toast.ok('已删除 ' + ok + ' 个' + (fail ? '，失败 ' + fail + ' 个' : ''))
  selected.value = []
  bulkConfirmShow.value = false
  bulkBusy.value = false
  await load()
}

onMounted(load)
</script>
