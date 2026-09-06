<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>报单配置</h2>
        <span class="page-sub">把"系统全称 ↔ 报单简称(列头) ↔ 单型"一次性配好，员工小程序报单不再碰列名</span>
      </div>
    </div>

    <!-- 配置体检红标 -->
    <div v-if="health" class="health-bar" :class="{ ok: !hasProblem }" @click="healthOpen = !healthOpen">
      <span class="hb-dot"></span>
      <template v-if="hasProblem">
        配置体检：<b>{{ health.unmapped_count }}</b> 个门店/客户未配置 · <b>{{ health.alias_conflicts.length }}</b> 个别名冲突 · <b>{{ health.unassigned_count }}</b> 名员工未分配
        <span class="hb-toggle">{{ healthOpen ? '收起' : '展开' }}</span>
      </template>
      <template v-else>配置体检：全部正常</template>
    </div>

    <!-- 体检详情 -->
    <div v-if="healthOpen && hasProblem" class="card health-detail">
      <div v-if="health.alias_conflicts.length" class="hd-sec">
        <b class="hd-t war">别名冲突（活跃配置中简称重复，需在编辑时修改）</b>
        <ul><li v-for="c in health.alias_conflicts" :key="c.report_alias">简称「{{ c.report_alias }}」重复 {{ c.c }} 次</li></ul>
      </div>
      <div v-if="health.unmapped_objects.length" class="hd-sec">
        <b class="hd-t">尚未配置报单的门店/客户（前 50）</b>
        <div class="chip-row"><span v-for="o in health.unmapped_objects" :key="o.id" class="chip">{{ o.name }}</span></div>
      </div>
      <div v-if="health.unassigned_employees.length" class="hd-sec">
        <b class="hd-t">尚未配置报单的员工</b>
        <div class="chip-row"><span v-for="e in health.unassigned_employees" :key="e.id" class="chip">{{ e.name }}</span></div>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <button class="btn btn-primary btn-sm" @click="openCreate">+ 新建配置</button>
      <button class="btn btn-ghost btn-sm" @click="importOpen = true">Excel 批量导入</button>
    </div>

    <!-- 列表 -->
    <div class="card table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>员工</th><th>对象类型</th><th>对象全称</th><th>简称(列头)</th>
            <th>单型</th><th>仓库(调拨)</th><th>状态</th><th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in list" :key="m.id" :class="{ stopped: m.is_active === 0 }">
            <td>{{ m.employee_name || '—' }}</td>
            <td><span class="tag" :class="typeClass(m.counterparty_type)">{{ typeLabel(m.counterparty_type) }}</span></td>
            <td>{{ m.counterparty_name || m.system_name || '—' }}</td>
            <td><b>{{ m.report_alias }}</b></td>
            <td>{{ m.order_template || '—' }}</td>
            <td class="num">{{ whShow(m) }}</td>
            <td>
              <span v-if="m.is_active === 0" class="tag danger">已停用</span>
              <span v-else class="tag suc">启用中</span>
            </td>
            <td class="ops">
              <button class="btn btn-ghost btn-sm" @click="openEdit(m)">编辑</button>
              <button v-if="m.is_active !== 0" class="btn btn-ghost btn-sm danger" @click="askDisable(m)">停用</button>
              <button v-else class="btn btn-ghost btn-sm" @click="toggle(m.id, 1)">启用</button>
            </td>
          </tr>
          <tr v-if="!list.length"><td colspan="8" class="empty">暂无报单配置，点「新建配置」或「Excel 批量导入」开始</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 新建/编辑抽屉 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="editOpen" class="df-overlay" @click="editOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="editOpen" class="df-modal edit-modal">
          <div class="df-modal-hd">
            <b>{{ editId ? '编辑配置' : '新建配置' }}</b>
            <button class="df-x" @click="editOpen = false"><Icon name="close"/></button>
          </div>
          <div class="df-modal-body">
            <div class="field">
              <label>员工 <span class="req">*</span></label>
              <select v-model="form.employee_id" :disabled="!!editId" @change="onEmpChange">
                <option value="0">请选择</option>
                <option v-for="e in refs.employees" :key="e.id" :value="e.id">{{ e.name }}</option>
              </select>
            </div>
            <div class="field">
              <label>对象类型 <span class="req">*</span></label>
              <div class="seg">
                <button v-for="t in types" :key="t.v" class="seg-btn" :class="{ on: form.counterparty_type === t.v }" @click="onType(t.v)">{{ t.label }}</button>
              </div>
            </div>
            <div class="field">
              <label>{{ typeLabel(form.counterparty_type) }}全称 <span class="req">*</span></label>
              <div v-if="form.counterparty_type !== 'self_warehouse'" class="combo" ref="objCombo">
                <input
                  class="combo-input"
                  v-model="objKeyword"
                  :placeholder="objPlaceholder"
                  @focus="objOpen = true"
                  @input="onObjInput"
                  @keydown.down.prevent="objMove(1)"
                  @keydown.up.prevent="objMove(-1)"
                  @keydown.enter.prevent="objEnter"
                  @keydown.esc="objOpen = false"
                />
                <span v-if="!objKeyword" class="combo-caret"><Icon name="chevron-down"/></span>
                <div v-show="objOpen" class="combo-panel">
                  <div
                    v-for="(c, i) in objFiltered"
                    :key="c.id"
                    class="combo-item"
                    :class="{ on: i === objHi, sel: c.id === Number(form.counterparty_id) }"
                    @mousedown.prevent="pickObj(c)"
                    @mouseenter="objHi = i"
                  >{{ c.name }}<span v-if="c.id === Number(form.counterparty_id)" class="combo-sel"><Icon name="check"/></span></div>
                  <div v-if="!objFiltered.length" class="combo-empty">无匹配结果</div>
                </div>
              </div>
              <div v-else class="ro-box">
                <template v-if="selectedEmpWh">
                  <span class="ro-name">{{ selectedEmpWh.name }}</span>
                  <span class="ro-tag">本人仓（按员工自动带出）</span>
                </template>
                <span v-else class="ro-warn">该员工未配置本人仓，请先在员工档案设置其个人仓</span>
              </div>
            </div>
            <div class="field">
              <label>报单简称(列头) <span class="req">*</span></label>
              <input v-model="form.report_alias" placeholder="如：东津（将作为汇总表列头，租户内唯一）" />
              <span class="hint">简称即报单汇总表的列头文字，落列按它匹配，与全称解耦。</span>
            </div>
            <div class="field">
              <label>单型 <span class="req">*</span></label>
              <input v-model="form.order_template" placeholder="如：调拨单 / 自提订单 / 访销单（可自定义）" />
            </div>
            <template v-if="form.counterparty_type === 'self_warehouse'">
              <div class="field">
                <label>源仓</label>
                <select v-model="form.src_wh"><option value="0">请选择</option><option v-for="w in refs.warehouses" :key="w.id" :value="w.id">{{ w.name }}</option></select>
              </div>
              <div class="field">
                <label>目标仓</label>
                <select v-model="form.dst_wh"><option value="0">请选择</option><option v-for="w in refs.warehouses" :key="w.id" :value="w.id">{{ w.name }}</option></select>
              </div>
            </template>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="editOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 停用确认 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="disableOpen" class="df-overlay" @click="disableOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="disableOpen" class="df-modal">
          <div class="df-modal-hd"><b>停用配置</b><button class="df-x" @click="disableOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="warn-text">停用后该对象不再出现在员工报单下拉中，且不计入报单汇总。已落库的历史报单不受影响。</p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="disableOpen = false">取消</button>
            <button class="btn btn-danger" @click="confirmDisable">确认停用</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Excel 导入 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="importOpen" class="df-overlay" @click="importOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="importOpen" class="df-modal">
          <div class="df-modal-hd"><b>Excel 批量导入配置</b><button class="df-x" @click="importOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="hint">模板表头（7 列）：员工 / 对象类型 / 对象全称 / 简称(列头) / 单型 / 源仓 / 目标仓。对象类型填 store / customer / self_warehouse。</p>
            <label class="upload-btn">选择 Excel 文件
              <input type="file" accept=".xlsx,.xls" @change="onFile" hidden />
            </label>
            <div v-if="importResult" class="imp-result">
              <p>成功 <b class="suc">{{ importResult.imported }}</b> 行 · 失败 <b class="dan">{{ importResult.failed }}</b> 行</p>
              <ul v-if="importResult.failures.length"><li v-for="(f, i) in importResult.failures" :key="i">第 {{ f.row }} 行：{{ f.reason }}</li></ul>
            </div>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="importOpen = false">关闭</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { reportMappingApi } from '../api/modules'
import { api } from '../api/client'
import { toast } from '../store'

const list = ref([])
const refs = reactive({ employees: [], contacts: [], warehouses: [] })
const health = ref(null)
const healthOpen = ref(false)
const editOpen = ref(false)
const editId = ref(0)
const saving = ref(false)
const disableOpen = ref(false)
const disableTarget = ref(0)
const importOpen = ref(false)
const importResult = ref(null)

const types = [
  { v: 'store', label: '门店' },
  { v: 'customer', label: '客户' },
  { v: 'self_warehouse', label: '本人仓' },
]

const form = reactive({
  employee_id: 0, counterparty_type: 'store', counterparty_id: 0,
  system_name: '', report_alias: '', order_template: '', src_wh: 0, dst_wh: 0,
})

const hasProblem = computed(() => health.value && (
  health.value.unmapped_count > 0 || health.value.alias_conflicts.length > 0 || health.value.unassigned_count > 0
))

const objOptions = computed(() => {
  if (form.counterparty_type === 'self_warehouse') return refs.warehouses
  return refs.contacts
})

// 对象下拉：可模糊查找的 combobox（门店/客户数量大，原生 select 难翻）
const objKeyword = ref('')
const objOpen = ref(false)
const objHi = ref(0)
const objCombo = ref(null)
const objPlaceholder = computed(() => `搜索${typeLabel(form.counterparty_type)}名称…`)
const objFiltered = computed(() => {
  const k = (objKeyword.value || '').trim().toLowerCase()
  const list = objOptions.value || []
  if (!k) return list
  return list.filter(c => (c.name || '').toLowerCase().includes(k))
})
function onObjInput() {
  // 重新输入即视为重新选择
  form.counterparty_id = 0
  form.system_name = ''
  objOpen.value = true
  objHi.value = 0
}
function pickObj(c) {
  form.counterparty_id = c.id
  form.system_name = c.name
  objKeyword.value = c.name
  objOpen.value = false
}
function objMove(d) {
  if (!objOpen.value) { objOpen.value = true; return }
  const n = objFiltered.value.length
  if (!n) return
  objHi.value = (objHi.value + d + n) % n
}
function objEnter() {
  if (!objOpen.value) return
  const c = objFiltered.value[objHi.value]
  if (c) pickObj(c)
}
function onDocClick(e) {
  if (objCombo.value && !objCombo.value.contains(e.target)) objOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

const whMap = computed(() => {
  const m = {}
  refs.warehouses.forEach(w => { m[w.id] = w.name })
  return m
})

// 本人仓强绑定：选中的员工是否已配置个人仓，则自动带出其本人仓
const selectedEmpWh = computed(() => {
  const e = refs.employees.find(x => x.id === Number(form.employee_id))
  if (!e || !e.warehouse_id) return null
  return { id: e.warehouse_id, name: whMap.value[e.warehouse_id] || '本人仓' }
})

function typeLabel(t) { return ({ store: '门店', customer: '客户', self_warehouse: '本人仓' })[t] || t }
function typeClass(t) { return ({ store: 'info', customer: 'purple', self_warehouse: 'teal' })[t] || 'info' }
function whShow(m) {
  if (m.counterparty_type !== 'self_warehouse') return '—'
  const s = whMap.value[m.src_wh] || '?'
  const d = whMap.value[m.dst_wh] || '?'
  return `${s} → ${d}`
}

async function loadAll() {
  try { list.value = await reportMappingApi.list({ include_inactive: 1 }) } catch (e) { toast(e.message || '加载失败', 'err') }
  try { const r = await reportMappingApi.health(); health.value = r } catch {}
}
async function loadRefs() {
  try {
    const r = await api('/api/report-mappings/refs')
    refs.employees = r.employees || []
    refs.contacts = r.contacts || []
    refs.warehouses = r.warehouses || []
  } catch (e) { toast(e.message || '加载选项失败', 'err') }
}

function resetForm() {
  form.employee_id = 0; form.counterparty_type = 'store'; form.counterparty_id = 0
  form.system_name = ''; form.report_alias = ''; form.order_template = ''
  form.src_wh = 0; form.dst_wh = 0
  objKeyword.value = ''; objOpen.value = false
}
function onType(t) {
  form.counterparty_type = t
  form.counterparty_id = 0
  form.system_name = ''
  objKeyword.value = ''
  // 本人仓：对象自动带出该员工的个人仓
  if (t === 'self_warehouse' && selectedEmpWh.value) {
    form.counterparty_id = selectedEmpWh.value.id
    form.system_name = selectedEmpWh.value.name
  }
}
function onEmpChange() {
  // 切换员工时，若当前为本人仓类型则重新解析其个人仓
  if (form.counterparty_type === 'self_warehouse') {
    if (selectedEmpWh.value) {
      form.counterparty_id = selectedEmpWh.value.id
      form.system_name = selectedEmpWh.value.name
    } else {
      form.counterparty_id = 0
      form.system_name = ''
    }
  }
}

function openCreate() { editId.value = 0; resetForm(); editOpen.value = true }
function openEdit(m) {
  editId.value = m.id
  form.employee_id = m.employee_id
  form.counterparty_type = m.counterparty_type
  form.counterparty_id = m.counterparty_id
  form.system_name = m.system_name || ''
  form.report_alias = m.report_alias || ''
  form.order_template = m.order_template || ''
  form.src_wh = m.src_wh || 0
  form.dst_wh = m.dst_wh || 0
  // 回填对象下拉显示名（本人仓走只读框，无需回填）
  objKeyword.value = ''
  if (m.counterparty_type !== 'self_warehouse') {
    const f = objOptions.value.find(c => c.id === m.counterparty_id)
    if (f) objKeyword.value = f.name
  }
  editOpen.value = true
}

async function save() {
  if (!form.employee_id || !form.counterparty_id || !form.report_alias || !form.order_template) {
    toast('员工 / 对象 / 简称 / 单型 均为必填', 'err'); return
  }
  saving.value = true
  try {
    const body = {
      employee_id: Number(form.employee_id), counterparty_type: form.counterparty_type,
      counterparty_id: Number(form.counterparty_id), system_name: form.system_name,
      report_alias: form.report_alias, order_template: form.order_template,
      src_wh: Number(form.src_wh), dst_wh: Number(form.dst_wh),
    }
    const res = editId.value
      ? await reportMappingApi.update(editId.value, body)
      : await reportMappingApi.create(body)
    if (res && res.error) { toast(res.error, 'err'); return }
    toast(editId.value ? '已更新' : '已创建', 'ok')
    editOpen.value = false
    await loadAll()
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { saving.value = false }
}

function askDisable(m) { disableTarget.value = m.id; disableOpen.value = true }
async function confirmDisable() {
  await toggle(disableTarget.value, 0)
  disableOpen.value = false
}
async function toggle(id, target) {
  try {
    await reportMappingApi.toggle(id, target)
    toast(target ? '已启用' : '已停用', 'ok')
    await loadAll()
  } catch (e) { toast(e.message || '操作失败', 'err') }
}

async function onFile(e) {
  const file = e.target.files[0]
  if (!file) return
  try {
    const res = await reportMappingApi.importFile(file)
    importResult.value = res
    if (res && res.failed > 0) toast('部分行导入失败，请查看详情', 'err')
    else toast(`成功导入 ${res.imported} 行`, 'ok')
    await loadAll()
  } catch (err) { toast(err.message || '导入失败', 'err') }
  finally { e.target.value = '' }
}

onMounted(() => { loadRefs(); loadAll() })
</script>

<style scoped>
.page-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}

.health-bar{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);background:rgba(var(--war-rgb),.10);border:1px solid rgba(var(--war-rgb),.35);padding:9px 14px;border-radius:var(--radius-md);margin-bottom:12px;cursor:pointer}
.health-bar.ok{background:rgba(var(--suc-rgb),.10);border-color:rgba(var(--suc-rgb),.35)}
.hb-dot{width:8px;height:8px;border-radius:50%;background:var(--war);flex-shrink:0}
.health-bar.ok .hb-dot{background:var(--suc)}
.hb-toggle{margin-left:auto;color:var(--p);font-size:12px}
.health-detail{margin-bottom:12px;padding:14px 16px}
.hd-sec{margin-bottom:12px}
.hd-sec:last-child{margin-bottom:0}
.hd-t{font-size:13px;color:var(--t1)}
.hd-t.war{color:var(--war)}
.chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{font-size:12px;padding:3px 9px;background:var(--bg2);border-radius:8px;color:var(--t2)}

.toolbar{display:flex;gap:10px;margin-bottom:12px}

.card{background:var(--bg);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm)}
.table-wrap{padding:6px 4px;overflow-x:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;padding:10px 12px;color:var(--t3);font-weight:500;border-bottom:1px solid var(--border-subtle)}
.tbl td{padding:10px 12px;border-bottom:1px solid var(--border-subtle);color:var(--t1)}
.tbl tbody tr.stopped td{color:var(--t3);background:var(--bg2)}
.tbl .ops{text-align:right;white-space:nowrap}
.empty{text-align:center;color:var(--t3);padding:28px}

.tag{font-size:11.5px;padding:2px 9px;border-radius:9px;background:var(--bg2);color:var(--t2)}
.tag.info{background:var(--p-bg);color:var(--p-dark)}
.tag.purple{background:rgba(var(--purple-rgb),.14);color:var(--purple)}
.tag.teal{background:rgba(var(--teal-rgb),.14);color:var(--teal)}
.tag.suc{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.tag.danger{background:rgba(var(--dan-rgb),.12);color:var(--dan)}
.num{font-variant-numeric:tabular-nums}

/* C2：按钮对齐全局令牌（.btn/.btn-sm/.btn-primary/.btn-ghost/.btn-danger 为 scoped 复刻，尺寸/圆角与 variables.css 保持一致） */
.btn{border:1px solid var(--border-subtle);background:var(--bg);border-radius:var(--radius-md);padding:7px 13px;font-size:13px;color:var(--t1);cursor:pointer}
.btn-sm{height:32px;padding:0 12px;font-size:13px;border-radius:var(--radius-sm)}
.btn-primary{background:var(--p-dark);border-color:var(--p-dark);color:#fff}
.btn-ghost{background:transparent}
.btn-danger{background:var(--dan);border-color:var(--dan);color:#fff}
.btn.danger{color:var(--dan)}
.btn:disabled{opacity:.55;cursor:not-allowed}

.df-overlay{position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:980}
.df-modal{position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);width:min(460px,92vw);background:var(--bg);border-radius:var(--radius-lg);z-index:990;box-shadow:var(--shadow-lg)}
.edit-modal{width:min(520px,94vw)}
.df-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border-subtle)}
.df-modal-hd b{font-size:15px;color:var(--t1)}
.df-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.df-modal-body{padding:16px 18px;display:flex;flex-direction:column;gap:14px;max-height:64vh;overflow:auto}
.df-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:13px 18px;border-top:1px solid var(--border-subtle)}

.field{display:flex;flex-direction:column;gap:6px;margin-bottom:2px}
.field label{font-size:12.5px;color:var(--t2)}
.field .req{color:var(--dan)}
.field input, .field select{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0 11px;font-size:13px;background:var(--bg);color:var(--t1)}
.field .hint{font-size:11.5px;color:var(--t3);line-height:1.5}
.seg{display:flex;gap:6px}
.seg-btn{flex:1;height:34px;border:1px solid var(--border-subtle);background:var(--bg);border-radius:var(--radius-sm);font-size:13px;color:var(--t2);cursor:pointer}
.seg-btn.on{background:var(--p);border-color:var(--p);color:#fff}

.warn-text{font-size:13px;color:var(--war);line-height:1.7}
.ro-box{display:flex;align-items:center;gap:8px;height:36px;padding:0 11px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:var(--bg2);font-size:13px}
.ro-name{font-weight:600;color:var(--t1)}
.ro-tag{font-size:11px;color:var(--teal);background:rgba(var(--teal-rgb),.12);padding:2px 8px;border-radius:6px}
.ro-warn{color:var(--war);font-size:12px}
.combo{position:relative;width:100%}
.combo-input{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0 28px 0 11px;font-size:13px;background:var(--bg);color:var(--t1)}
.combo-input:focus{outline:none;border-color:var(--p)}
.combo-caret{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--t3);font-size:11px;pointer-events:none}
.combo-panel{position:absolute;z-index:30;left:0;right:0;top:calc(100% + 4px);max-height:260px;overflow:auto;background:var(--bg);border:1px solid var(--border-subtle);border-radius:var(--radius-md);box-shadow:var(--shadow-md);padding:4px}
.combo-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:7px;font-size:13px;color:var(--t1);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.combo-item.on{background:var(--bg2)}
.combo-item.sel{color:var(--p);font-weight:600}
.combo-sel{color:var(--p);font-size:12px;flex:none}
.combo-empty{padding:10px;text-align:center;font-size:12px;color:var(--t3)}
.upload-btn{display:inline-block;border:1px dashed var(--border-subtle);border-radius:var(--radius-md);padding:14px 18px;font-size:13px;color:var(--p);cursor:pointer;text-align:center}
.imp-result{font-size:13px;color:var(--t1);margin-top:6px}
.imp-result .suc{color:var(--suc)} .imp-result .dan{color:var(--dan)}
.imp-result ul{margin:8px 0 0;padding-left:18px;color:var(--t2);font-size:12px;line-height:1.7}

.fade-enter-active,.fade-leave-active{transition:opacity .18s}
.fade-enter-from,.fade-leave-to{opacity:0}
.pop-enter-active,.pop-leave-active{transition:transform .2s,opacity .2s}
.pop-enter-from,.pop-leave-to{transform:translate(-50%,-46%) scale(.97);opacity:0}
</style>
