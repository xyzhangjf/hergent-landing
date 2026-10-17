<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>审批链配置</h2>
        <span class="page-sub">设置每类单据要过哪几关（仅管理员可改）</span>
      </div>
    </div>

    <Skeleton v-if="loading" />
    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load">重试</button>
    </div>

    <template v-else>
      <!-- 单据类型切换 -->
      <div class="fc-tabs">
        <button v-for="t in TYPES" :key="t.value" class="fc-tab" :class="{ on: active === t.value }" @click="active = t.value">
          {{ t.label }}
        </button>
      </div>

      <div class="card">
        <div class="fc-hd">
          <b>{{ activeLabel }}的审批流程</b>
          <span class="fc-sub">按从上到下的顺序，逐关审批；最后一关通过后单据进入「已审待执行」。</span>
        </div>

        <div class="fc-nodes">
          <div v-for="(nd, i) in editor" :key="i" class="fc-node">
            <span class="fc-idx">第 {{ i + 1 }} 关</span>
            <select v-model="nd.role" class="input" @change="onRoleChange(nd)">
              <option v-for="o in ROLE_OPTS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <input v-model="nd.name" class="input" placeholder="节点名称（如：主管审）" />
            <button class="btn btn-ghost btn-sm" :disabled="editor.length <= 1" @click="removeNode(i)">删除</button>
          </div>
          <div v-if="!editor.length" class="fc-empty">至少需要一个审批节点。</div>
        </div>

        <div class="fc-actions">
          <button class="btn btn-ghost btn-sm" @click="addNode">+ 添加审批关</button>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="save">
            {{ busy ? '保存中…' : '保存该单据类型的审批链' }}
          </button>
        </div>

        <p class="fc-note">
          改动只影响<b>之后新提交</b>的单据；已经在审批中的单按提交时快照的链条走，不会中途变关。
        </p>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 审批链配置（管理员） —— 数据源：`GET /api/approvals/flows` + `PUT /api/approvals/flows/{doc_type}`。
   🔴 后端 `_admin` 只放 admin/boss；前端本页靠 `pages.js` 的窄名单（`ADMIN_ROLES`）隐藏入口，
      双保险。越权直接调接口也会被 403。
   🔴 节点 role 必须落在系统角色里（与 `_can_approve` 的 `chain[node].role == 当前用户 role` 对齐）：
      给某一关选了「主管」，就只有 role=supervisor 的人能在那一关点「通过」。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { approvalApi } from '../../api/approvals'
import { toast } from '../../store'

const TYPES = [
  { value: 'purchase', label: '采购单' },
  { value: 'sale', label: '销售单' },
  { value: 'transfer', label: '调拨单' },
  { value: 'return', label: '退货单' },
]
const ROLE_OPTS = [
  { value: 'boss', label: '老板' },
  { value: 'admin', label: '管理员' },
  { value: 'supervisor', label: '主管' },
  { value: 'accountant', label: '会计' },
  { value: 'sales', label: '销售员' },
]
function roleLabel (v) { const o = ROLE_OPTS.find(x => x.value === v); return o ? o.label : v }

const loading = ref(true)
const err = ref('')
const busy = ref(false)
const active = ref('purchase')
const flows = ref({ purchase: [], sale: [], transfer: [], return: [] })

const activeLabel = computed(() => (TYPES.find(t => t.value === active.value) || {}).label || active.value)
const editor = computed({
  get: () => flows.value[active.value] || [],
  set: (v) => { flows.value[active.value] = v },
})

function onRoleChange (nd) {
  /* 节点名没手动改过时，跟随 role 自动建议一个名字（如「主管审」） */
  if (!nd.name || ROLE_OPTS.some(o => nd.name === (o.label + '审'))) {
    nd.name = roleLabel(nd.role) + '审'
  }
}
function addNode () {
  const last = (flows.value[active.value] || [])[0]
  const role = last ? 'boss' : 'supervisor'
  flows.value[active.value] = [...(flows.value[active.value] || []), { role, name: roleLabel(role) + '审' }]
}
function removeNode (i) {
  if (flows.value[active.value].length <= 1) return
  flows.value[active.value] = flows.value[active.value].filter((_, k) => k !== i)
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await approvalApi.flows()
    const out = { purchase: [], sale: [], transfer: [], return: [] }
    for (const k of Object.keys(out)) {
      const arr = Array.isArray(d[k]) ? d[k] : []
      out[k] = arr.length ? arr.map(n => ({ role: n.role, name: n.name || roleLabel(n.role) + '审' })) : [{ role: 'boss', name: '老板审批' }]
    }
    flows.value = out
  } catch (e) {
    err.value = e.message || '审批链读取失败'
  } finally {
    loading.value = false
  }
}

async function save () {
  const nodes = (flows.value[active.value] || []).filter(n => n && n.role)
  if (!nodes.length) { toast('至少需要一个审批节点', 'warn'); return }
  busy.value = true
  try {
    const r = await approvalApi.setFlow(active.value, nodes)
    if (r && r.error) throw new Error(r.error)
    toast(`${activeLabel.value}审批链已保存`, 'success')
  } catch (e) {
    toast(e.message || '保存失败', 'error')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.inv-page { display: block }
.page-hd { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 12px }
.page-sub { font-size: 12px; color: var(--t3) }
.fc-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px }
.fc-tab { padding: 7px 14px; border: 1px solid var(--bd); background: var(--bg); border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--t1) }
.fc-tab.on { border-color: var(--p); color: var(--p-ink); background: var(--p-bg, #eef2ff) }
.card { padding: 16px }
.fc-hd { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px }
.fc-sub { font-size: 12px; color: var(--t3) }
.fc-nodes { display: flex; flex-direction: column; gap: 10px }
.fc-node { display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
.fc-idx { width: 64px; font-size: 13px; color: var(--t2) }
.fc-node .input { flex: 1; min-width: 140px }
.fc-empty { font-size: 13px; color: var(--t3) }
.fc-actions { display: flex; gap: 10px; margin-top: 16px }
.fc-note { margin: 14px 0 0; font-size: 12px; color: var(--t3); line-height: 1.6 }
</style>
