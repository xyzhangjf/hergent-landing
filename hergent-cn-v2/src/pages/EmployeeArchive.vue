<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>员工档案</h2>
        <span class="page-sub">维护员工底薪与小程序权限 · 支持手动录入与 Excel 批量导入</span>
      </div>
      <div class="sync-wrap">
        <span class="sync-state" :class="connState">{{ connLabel }}</span>
        <button class="btn btn-ghost btn-sm" :disabled="syncBusy" @click="onSync">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          {{ syncBusy ? '同步中…' : '同步' }}
        </button>
      </div>
    </div>

    <div class="card df-panel">
      <div class="panel-hd df-ph">
        <b>在职员工</b>
        <div class="df-ph-right">
          <span class="tag info">工资按档案底薪算，没填的用配方兜底</span>
          <button class="btn btn-primary btn-sm" @click="openCreate">＋ 添加员工</button>
        </div>
      </div>

      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="employees.length" class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>员工</th><th>岗位</th><th class="num">底薪/月</th>
            <th>小程序账号</th><th>门店</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="e in employees" :key="e.id" :class="{ stopped: e.is_active === 0 }">
              <td>
                {{ e.name }}
                <span v-if="e.employee_no" class="df-no">{{ e.employee_no }}</span>
                <span v-if="e.is_active === 0" class="df-no stopped-tag">已停用</span>
              </td>
              <td>{{ e.position || '—' }}</td>
              <td class="num">¥{{ fmt(salaryOf(e)) }}</td>
              <td>
                <span v-if="e.has_account" class="df-acc" :class="{ on: e.is_active !== 0 }" :title="'账号：' + e.account_username">已开通 {{ e.account_username }}</span>
                <span v-else class="df-acc">未开通</span>
                <span v-if="e.account_role" class="df-role" :class="['r-' + e.account_role, { stopped: e.is_active === 0 }]">{{ roleName(e.account_role) }}</span>
              </td>
              <td class="num">{{ (e.store_ids || []).length }} 家</td>
              <td class="df-ops">
                <button class="btn btn-ghost btn-sm" @click="openEdit(e)">编辑</button>
                <button class="btn btn-ghost btn-sm" @click="openStores(e)">门店</button>
                <button v-if="e.is_active !== 0" class="btn btn-ghost btn-sm danger" @click="askDisable(e)">停用</button>
                <button v-else class="btn btn-ghost btn-sm" @click="employeeToggle(e.id, 1)">启用</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="state-empty">还没有员工档案，先添加或从 Excel 导入</div>
    </div>

    <!-- 开账号已整合进「编辑员工」弹窗（见下方 edit-modal 的"小程序账号"区） -->

    <!-- 绑门店弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="storeOpen" class="df-overlay" @click="storeOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="storeOpen" class="df-modal">
          <div class="df-modal-hd"><b>分配门店 · {{ storeEmp?.name }}</b><button class="df-x" @click="storeOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="df-tip">员工登录后只能看到并填报这些门店。</p>
            <div class="df-store-list">
              <label v-for="s in allStores" :key="s.id" class="df-store-item">
                <input type="checkbox" :value="s.id" v-model="storeForm.ids">
                <span>{{ s.name }}</span>
              </label>
              <div v-if="!allStores.length" class="df-tip">还没有客户/门店，先在 ERP 里录入客户</div>
            </div>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="storeOpen = false">取消</button>
            <button class="btn btn-primary" @click="saveStores">保存分配</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Excel 批量导入 -->
    <div class="card df-panel">
      <div class="panel-hd"><b>Excel 批量导入员工</b><span class="tag info">按模板整理后上传</span></div>
      <p class="df-tip">下载模板，按 <code>姓名* | 工号 | 岗位 | 底薪/月 | 社保基数 | 银行账号</code> 填写，用 Excel 打开后<b>另存为 .xlsx</b> 再上传。</p>
      <div class="df-import-row">
        <button class="btn btn-ghost" @click="downloadEmpTemplate">下载模板</button>
        <label class="btn btn-ghost df-file-btn">
          选择文件
          <input type="file" accept=".xlsx,.xls" style="display:none" @change="onInvFile">
        </label>
        <span v-if="invFileName" class="df-fname">{{ invFileName }}</span>
        <button class="btn btn-primary" :disabled="!invFile || importing" @click="importEmployees">
          {{ importing ? '导入中…' : '开始导入' }}
        </button>
      </div>
      <div v-if="invResult" class="df-result" :class="invResult.results?.errors?.length ? 'warn' : 'ok'">
        成功 {{ invResult.results?.success }} 条 · 跳过 {{ invResult.results?.skipped }} 条 · 失败 {{ invResult.results?.errors?.length || 0 }} 条
        <span v-if="invResult.results?.errors?.length" class="df-errs">
          <span v-for="(er, i) in invResult.results.errors.slice(0, 4)" :key="i" class="df-err">第{{ er.row }}行: {{ er.msg }}</span>
        </span>
      </div>
      <p v-if="connState === 'unlinked'" class="df-tip df-warn">未连接 ERP：连接畅捷通/金蝶后，可点上方「同步」拉取外部档案。员工 API 同步将于 P1 上线，当前同步客户与商品。</p>
    </div>

    <!-- 编辑员工弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="editOpen" class="df-overlay" @click="editOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="editOpen" class="df-modal edit-modal">
          <div class="df-modal-hd"><b>{{ isCreate ? '新建员工' : ('编辑员工 · ' + (editTarget?.name || '')) }}</b><button class="df-x" @click="editOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body df-edit-body">

            <!-- 基本信息 -->
            <section class="df-sec">
              <div class="df-sec-title">基本信息</div>
              <div class="df-edit-grid">
                <label class="df-field"><span>姓名 <i class="req">*</i></span><input v-model="editForm.name" class="input"></label>
                <label class="df-field"><span>工号</span><input v-model="editForm.employee_no" class="input"></label>
                <label class="df-field"><span>岗位</span><input v-model="editForm.position" class="input"></label>
                <label class="df-field"><span>入职日期</span><input v-model="editForm.hire_date" class="input" placeholder="2026-03-01"></label>
              </div>
            </section>

            <!-- 薪酬与账户 -->
            <section class="df-sec">
              <div class="df-sec-title">薪酬与账户</div>
              <div class="df-edit-grid">
                <label class="df-field"><span>底薪/月</span><input v-model.number="editForm.base_salary" class="input" type="number"></label>
                <label class="df-field"><span>社保基数</span><input v-model.number="editForm.social_insurance_base" class="input" type="number"></label>
                <label class="df-field"><span>公积金基数</span><input v-model.number="editForm.housing_fund_base" class="input" type="number"></label>
                <label class="df-field"><span>社保缴纳城市</span><input v-model="editForm.social_insurance_city" class="input"></label>
                <label class="df-field"><span>身份证号</span><input v-model="editForm.id_card" class="input"></label>
                <label class="df-field"><span>开户银行</span><input v-model="editForm.bank_name" class="input"></label>
                <label class="df-field"><span>银行账号</span><input v-model="editForm.bank_account" class="input"></label>
              </div>
            </section>

            <!-- 小程序账号（整合原"开账号"入口：员工的人事档案与登录账号在同一处管理） -->
            <section class="df-sec">
              <div class="df-sec-title">小程序账号</div>
              <div v-if="isCreate" class="df-acc-hint">
                <p class="df-tip">保存员工后，可在此为其开通小程序账号。</p>
              </div>
              <div v-else-if="!editTarget || !editTarget.has_account" class="df-acc-create">
                <p class="df-tip">该员工暂无登录账号。开通后可用此手机号 + 密码登录预报小程序。</p>
                <label class="df-field"><span>手机号 / 账号</span><input v-model="accForm2.username" class="input" placeholder="如 13800000001"></label>
                <label class="df-field"><span>初始密码</span><input v-model="accForm2.password" class="input" type="text" placeholder="至少 4 位"></label>
                <label class="df-field"><span>角色 / 权限</span>
                  <select v-model="accForm2.role" class="input acc-role">
                    <option v-for="o in ROLE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </label>
                <button class="btn btn-primary btn-block" :disabled="accBusy || !accForm2.username || accForm2.password.length < 4" @click="createAccountInEdit">开通账号</button>
              </div>
              <div v-else class="df-acc-manage">
                <p class="df-acc-sum">登录账号：<b>{{ editTarget.account_username }}</b> · {{ roleName(editTarget.account_role) }} · <span :class="editTarget.account_active ? 'on' : 'off'">{{ editTarget.account_active ? '启用中' : '已禁用' }}</span></p>
                <div class="df-acc-row">
                  <select v-model="accRoleEdit" class="input acc-role">
                    <option v-for="o in ROLE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                  <button class="btn btn-ghost btn-sm" :disabled="accBusy || accRoleEdit === editTarget.account_role" @click="saveAccRole">修改角色</button>
                </div>
                <div v-if="showReset" class="df-acc-row">
                  <input v-model="accPwdEdit" class="input" type="text" placeholder="新密码（至少 4 位）">
                  <button class="btn btn-ghost btn-sm" :disabled="accBusy || accPwdEdit.length < 4" @click="resetAccPwd">保存密码</button>
                </div>
                <div class="df-acc-row">
                  <button class="btn btn-ghost btn-sm" @click="showReset = !showReset">{{ showReset ? '取消重置' : '重置密码' }}</button>
                  <button class="btn btn-ghost btn-sm danger" :disabled="accBusy" @click="toggleAccStatus">{{ editTarget.account_active ? '禁用账号' : '启用账号' }}</button>
                </div>
              </div>
            </section>

          </div>

          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="editOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="!editForm.name.trim()" @click="saveEmployee">保存</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 停用确认弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="disableOpen" class="df-overlay" @click="disableOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="disableOpen" class="df-modal">
          <div class="df-modal-hd"><b>停用员工</b><button class="df-x" @click="disableOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="df-tip warn-text">确认停用「{{ disableTarget?.name }}」？<br>停用后该员工不再计入工资核算，其小程序登录账号也会被禁用（可随时「启用」恢复）。</p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="disableOpen = false">取消</button>
            <button class="btn btn-danger" @click="confirmDisable">确认停用</button>
          </div>
        </div>
      </Transition>

      <!-- 离职交接：报单配置转交 -->
      <Transition name="fade"><div v-if="transferOpen" class="df-overlay" @click="transferOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="transferOpen" class="df-modal">
          <div class="df-modal-hd"><b>交接报单配置</b><button class="df-x" @click="transferOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="df-tip warn-text">
              「{{ transferEmp?.name }}」名下还有 <b>{{ transferCount }}</b> 个报单配置（门店 / 客户）。<br>
              这些配置<b>不能随离职作废</b> —— 否则对应门店将无人报单，业务会中断。请转交给接任者。
            </p>
            <label class="df-field">
              <span>转交给 <b class="req">*</b></span>
              <select v-model="transferToId" class="input">
                <option :value="null">— 请选择在职员工 —</option>
                <option v-for="ae in activeEmployees" :key="ae.id" :value="ae.id">
                  {{ ae.name }}<template v-if="ae.employee_no">（{{ ae.employee_no }}）</template>
                </option>
              </select>
            </label>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="transferOpen = false">稍后处理</button>
            <button class="btn btn-primary" :disabled="transferring || !transferToId" @click="confirmTransfer">
              {{ transferring ? '转交中…' : '确认转交' }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 未连接提醒弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="remindOpen" class="df-overlay" @click="remindOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="remindOpen" class="df-modal">
          <div class="df-modal-hd"><b>尚未连接 ERP</b><button class="df-x" @click="remindOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="df-tip">「同步」需要先把你的 ERP（畅捷通 / 金蝶）接入 Hergent。</p>
            <p class="df-tip">请前往 <b>能力中心</b> 完成授权连接后，再来点「同步」。</p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="remindOpen = false">知道了</button>
            <button class="btn btn-primary" @click="goConnect">去能力中心</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { toast } from '../store'
import { employeeApi, importApi, staffAccountApi } from '../api/modules'

const router = useRouter()
const loading = ref(false)
const importing = ref(false)
const employees = ref([])
const empStats = ref(null)

/* ---- 员工 ---- */
const isCreate = ref(false)

/* ---- 完整编辑 ---- */
const editOpen = ref(false)
const editTarget = ref(null)
const editForm = reactive({
  name: '', employee_no: '', position: '', hire_date: '', id_card: '',
  bank_name: '', bank_account: '', social_insurance_city: '',
  social_insurance_base: null, housing_fund_base: null, base_salary: null,
})

/* ---- 小程序账号（整合进"编辑员工"弹窗）与门店 ---- */
const ROLE_OPTIONS = [
  { value: 'staff', label: '小程序员工（仅报单 / AI 对话 / 库存）' },
  { value: 'sales', label: '业务员（销售 + 采购 + 客户 + 数据）' },
  { value: 'guide', label: '导购（销售 + 采购 + 客户）' },
  { value: 'driver', label: '司机（仅库存看板）' },
  { value: 'accountant', label: '会计（账务 / 报表 / 营销）' },
  { value: 'boss', label: '老板（几乎全开）' },
  { value: 'admin', label: '管理员（全开）' },
]
const accForm2 = reactive({ username: '', password: '', role: 'staff' })
const accRoleEdit = ref('staff')
const accPwdEdit = ref('')
const accBusy = ref(false)
const showReset = ref(false)
const storeOpen = ref(false)
const storeEmp = ref(null)
const storeForm = reactive({ ids: [] })
const allStores = ref([])

/* ---- 连接器状态 + 同步 ---- */
const chanjetLinked = ref(false)
const kingdeeLinked = ref(false)
const syncBusy = ref(false)
const remindOpen = ref(false)

const connState = computed(() => (chanjetLinked.value || kingdeeLinked.value) ? 'linked' : 'unlinked')
const connLabel = computed(() => {
  if (chanjetLinked.value && kingdeeLinked.value) return '畅捷通 + 金蝶 已连接'
  if (chanjetLinked.value) return '畅捷通 已连接'
  if (kingdeeLinked.value) return '金蝶 已连接'
  return '未连接 ERP'
})

async function probeConnectors() {
  try { const s = await api('/api/datasources/v2/chanjet/status'); chanjetLinked.value = !!s.connected } catch { chanjetLinked.value = false }
  try { const s = await api('/api/datasources/v2/kingdee/status'); kingdeeLinked.value = !!s.connected } catch { kingdeeLinked.value = false }
}

async function onSync() {
  if (!chanjetLinked.value && !kingdeeLinked.value) { remindOpen.value = true; return }
  syncBusy.value = true
  try {
    const jobs = []
    if (chanjetLinked.value) jobs.push(api('/api/datasources/v2/chanjet/sync', { method: 'POST', body: { objects: ['products', 'customers', 'suppliers'] } }))
    if (kingdeeLinked.value) jobs.push(api('/api/datasources/v2/kingdee/sync', { method: 'POST', body: { objects: ['products', 'customers', 'suppliers', 'inventory', 'sales_orders', 'purchase_orders'] } }))
    await Promise.all(jobs)
    const who = chanjetLinked.value && kingdeeLinked.value ? '（畅捷通 + 金蝶）' : chanjetLinked.value ? '（畅捷通）' : '（金蝶）'
    toast('已同步外部档案数据' + who, 'ok')
  } catch (e) {
    toast(e.message || '同步失败', 'err')
  } finally {
    syncBusy.value = false
  }
}

function goConnect() { remindOpen.value = false; router.push('/connect') }

/* ---- 员工 CRUD ---- */
function salaryOf(e) {
  try { return (JSON.parse(e.salary_structure || '{}')).base_salary || 0 } catch { return 0 }
}
function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }

async function loadEmployees() {
  loading.value = true
  try {
    employees.value = await employeeApi.list({ include_inactive: 1 }) || []
    const missing = employees.value.filter(e => !salaryOf(e)).length
    empStats.value = { total: employees.value.length, missing }
  } catch (e) { toast(e.message || '加载员工失败', 'err') }
  finally { loading.value = false }
}

/* ---- 完整编辑弹窗（新增 / 编辑共用同一弹窗） ---- */
function resetEditForm(e) {
  const src = e || {}
  editForm.name = src.name || ''
  editForm.employee_no = src.employee_no || ''
  editForm.position = src.position || ''
  editForm.hire_date = src.hire_date || ''
  editForm.id_card = src.id_card || ''
  editForm.bank_name = src.bank_name || ''
  editForm.bank_account = src.bank_account || ''
  editForm.social_insurance_city = src.social_insurance_city || ''
  editForm.social_insurance_base = src.social_insurance_base != null ? src.social_insurance_base : null
  editForm.housing_fund_base = src.housing_fund_base != null ? src.housing_fund_base : null
  editForm.base_salary = e ? (salaryOf(e) || null) : null
  // 账号区状态复位
  accForm2.username = ''
  accForm2.password = ''
  accForm2.role = 'staff'
  accRoleEdit.value = src.account_role || 'staff'
  accPwdEdit.value = ''
  showReset.value = false
}

function openCreate() {
  isCreate.value = true
  editTarget.value = null
  resetEditForm(null)
  editOpen.value = true
}

function openEdit(e) {
  isCreate.value = false
  editTarget.value = e
  resetEditForm(e)
  editOpen.value = true
}

async function saveEmployee() {
  if (!editForm.name.trim()) { toast('请输入员工姓名', 'err'); return }
  const f = editForm
  const body = {
    name: f.name.trim(),
    employee_no: f.employee_no || undefined,
    position: f.position || undefined,
    hire_date: f.hire_date || undefined,
    id_card: f.id_card || undefined,
    bank_name: f.bank_name || undefined,
    bank_account: f.bank_account || undefined,
    social_insurance_city: f.social_insurance_city || undefined,
    social_insurance_base: f.social_insurance_base != null ? f.social_insurance_base : undefined,
    housing_fund_base: f.housing_fund_base != null ? f.housing_fund_base : undefined,
  }
  if (f.base_salary != null) body.salary_structure = JSON.stringify({ base_salary: f.base_salary })
  try {
    if (isCreate.value) {
      const created = await employeeApi.create(body)
      toast('已创建员工', 'ok')
      isCreate.value = false
      // 用新档案继续填充弹窗，便于立即开通小程序账号
      openEdit(created)
      loadEmployees()
    } else {
      await employeeApi.update(editTarget.value.id, body)
      toast('已保存', 'ok')
      editOpen.value = false
      loadEmployees()
    }
  } catch (e2) { toast(e2.message || '保存失败', 'err') }
}

/* ---- 停用 / 启用 ---- */
const disableOpen = ref(false)
const disableTarget = ref(null)
function askDisable(e) { disableTarget.value = e; disableOpen.value = true }
async function confirmDisable() {
  const e = disableTarget.value
  disableOpen.value = false
  const r = await employeeToggle(e.id, 0)
  // 停用后：若该员工名下还有报单配置，必须引导转交 ——
  // 直接作废会导致这些门店/客户无人报单，业务中断。权限可回收，报单要交接。
  if (r && r.report_mapping_count > 0) {
    transferEmp.value = e
    transferCount.value = r.report_mapping_count
    transferToId.value = null
    await loadActiveEmployees()
    transferOpen.value = true
  }
}
async function employeeToggle(eid, val) {
  try {
    const r = await employeeApi.toggle(eid, val)
    const n = r && r.accounts_affected ? r.accounts_affected : 0
    if (val) {
      toast(n ? `已启用员工，并恢复 ${n} 个登录账号` : '已启用员工', 'ok')
    } else {
      toast(n ? `已停用员工，并禁用 ${n} 个登录账号` : '已停用员工（该员工无关联账号）', 'ok')
    }
    loadEmployees()
    return r
  } catch (e2) { toast(e2.message || '操作失败', 'err'); return null }
}

/* ---- 离职交接：报单配置转交（不能直接停用，否则门店无人报单） ---- */
const transferOpen = ref(false)
const transferEmp = ref(null)
const transferCount = ref(0)
const transferToId = ref(null)
const activeEmployees = ref([])
const transferring = ref(false)

async function loadActiveEmployees() {
  try {
    const d = await api('/api/employees/active')
    activeEmployees.value = d.employees || []
  } catch (e) { activeEmployees.value = [] }
}

async function confirmTransfer() {
  if (!transferToId.value) { toast('请选择接任者', 'err'); return }
  transferring.value = true
  try {
    const r = await api(`/api/employees/${transferEmp.value.id}/transfer-mappings`, {
      method: 'POST',
      body: { to_employee_id: Number(transferToId.value) },
    })
    toast(`已转交 ${r.moved || 0} 个报单配置`, 'ok')
    transferOpen.value = false
    loadEmployees()
  } catch (e) {
    toast(e.message || '转交失败', 'err')
  } finally {
    transferring.value = false
  }
}

/* ---- 小程序账号 / 门店 ---- */
const ROLE_NAMES = { admin: '管理员', boss: '老板', accountant: '会计', sales: '业务员', guide: '导购', driver: '司机', staff: '员工' }
function roleName(r) { return ROLE_NAMES[r] || r || '员工' }

// 在"编辑员工"弹窗内开通账号（仅当该员工尚无账号时显示）
async function createAccountInEdit() {
  if (accBusy.value || !editTarget.value) return
  accBusy.value = true
  try {
    await staffAccountApi.createAccount({
      employee_id: editTarget.value.id,
      username: accForm2.username.trim(),
      password: accForm2.password,
      display_name: editTarget.value.name,
      role: accForm2.role,
    })
    toast('账号已开通', 'ok')
    editOpen.value = false
    loadEmployees()
  } catch (e) { toast(e.message || '开通失败', 'err') }
  finally { accBusy.value = false }
}

// 修改已有账号的角色
async function saveAccRole() {
  if (accBusy.value || !editTarget.value || !editTarget.value.account_user_id) return
  accBusy.value = true
  try {
    await api(`/api/users/${editTarget.value.account_user_id}/role`, { method: 'PUT', body: { role: accRoleEdit.value } })
    toast('角色已更新', 'ok')
    editOpen.value = false
    loadEmployees()
  } catch (e) { toast(e.message || '更新失败', 'err') }
  finally { accBusy.value = false }
}

// 重置已有账号的密码
async function resetAccPwd() {
  if (accBusy.value || !editTarget.value || !editTarget.value.account_user_id) return
  accBusy.value = true
  try {
    await api(`/api/users/${editTarget.value.account_user_id}/password`, { method: 'POST', body: { password: accPwdEdit.value } })
    toast('密码已重置', 'ok')
    showReset.value = false
    accPwdEdit.value = ''
  } catch (e) { toast(e.message || '重置失败', 'err') }
  finally { accBusy.value = false }
}

// 启用 / 禁用已有账号
async function toggleAccStatus() {
  if (accBusy.value || !editTarget.value || !editTarget.value.account_user_id) return
  const next = editTarget.value.account_active ? 0 : 1
  accBusy.value = true
  try {
    await api(`/api/users/${editTarget.value.account_user_id}/status`, { method: 'PUT', body: { is_active: next } })
    toast(next ? '账号已启用' : '账号已禁用', 'ok')
    editOpen.value = false
    loadEmployees()
  } catch (e) { toast(e.message || '操作失败', 'err') }
  finally { accBusy.value = false }
}
async function openStores(e) {
  storeEmp.value = e
  storeForm.ids = [...(e.store_ids || [])]
  storeOpen.value = true
  try { const d = await staffAccountApi.allStores(); allStores.value = d.stores || [] } catch (e2) { toast(e2.message || '门店加载失败', 'err') }
}
async function saveStores() {
  try {
    await staffAccountApi.setStores(storeEmp.value.id, storeForm.ids)
    toast('门店分配已保存', 'ok')
    storeOpen.value = false
    loadEmployees()
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

/* ---- Excel 导入 ---- */
const invFile = ref(null)
const invFileName = ref('')
const invResult = ref(null)

function onInvFile(ev) {
  const f = ev.target.files[0] || null
  if (f && !/\.(xlsx|xls)$/i.test(f.name)) {
    toast('仅支持 Excel 文件（.xlsx / .xls），请用 Excel 另存后再上传', 'err')
    ev.target.value = ''
    return
  }
  invFile.value = f
  invFileName.value = f?.name || ''
  invResult.value = null
}
async function downloadEmpTemplate() {
  try {
    const t = await importApi.template('employees')
    const csv = '﻿' + t.columns.join(',') + '\n'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '员工导入模板.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}
async function importEmployees() {
  if (!invFile.value) return
  importing.value = true
  try {
    const prev = await importApi.preview(invFile.value, 'employees')
    const mapping = {}
    for (const s of prev.suggestions) if (s.suggested_field) mapping[s.index] = s.suggested_field
    const r = await importApi.execute(invFile.value, 'employees', mapping)
    invResult.value = r
    toast(`导入完成：成功 ${r.results?.success || 0} 条`, r.results?.errors?.length ? 'warn' : 'ok')
    loadEmployees()
  } catch (e) { toast(e.message || '导入失败', 'err') }
  finally { importing.value = false }
}

onMounted(() => {
  loadEmployees()
  probeConnectors()
})
</script>

<style scoped>
.page-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.sync-wrap{display:flex;align-items:center;gap:8px;flex-shrink:0}
.sync-state{font-size:11.5px;padding:3px 10px;border-radius:10px;background:var(--bg2);color:var(--t3);white-space:nowrap}
.sync-state.linked{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.sync-state.unlinked{background:rgba(var(--war-rgb),.12);color:var(--war)}

.df-panel{padding:18px;margin-bottom:14px}
.df-tip{font-size:12.5px;color:var(--t2);margin:4px 0 14px;line-height:1.7}
.df-tip code{background:var(--bg2);padding:1px 6px;border-radius:5px;font-size:12px}
.df-warn{color:var(--war);background:rgba(var(--war-rgb),.08);padding:8px 12px;border-radius:8px;font-size:12px}

.df-ph{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.df-ph-right{display:flex;align-items:center;gap:10px}
.df-no{display:inline-block;margin-left:6px;font-size:11px;color:var(--t3)}
.df-edit-in{width:110px;height:30px;font-size:12.5px}
.df-ops{white-space:nowrap}
.df-ops .btn{margin-left:6px}

.df-import-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.df-file-btn{position:relative;overflow:hidden}
.df-fname{font-size:12.5px;color:var(--t2)}
.df-result{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px;background:rgba(var(--suc-rgb),.1);color:var(--suc)}
.df-result.warn{background:rgba(var(--war-rgb),.12);color:var(--war)}
.df-errs{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.df-err{font-size:12px;color:var(--t2)}

/* 账号/门店 */
.df-acc{font-size:12px;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t3);white-space:nowrap}
.df-acc.on{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.df-role{display:inline-block;font-size:11px;padding:1px 7px;border-radius:6px;margin-left:6px;background:rgba(var(--teal-rgb,14,165,164),.14);color:var(--teal,#0ea5a4);white-space:nowrap}
.df-role.r-admin{background:rgba(239,68,68,.14);color:#ef4444}
.df-role.r-boss{background:rgba(234,88,12,.14);color:#ea580c}
.df-role.r-accountant{background:rgba(59,130,246,.14);color:#3b82f6}
.df-role.r-sales{background:rgba(16,185,129,.14);color:#10b981}
.df-role.r-guide{background:rgba(168,85,247,.14);color:#a855f7}
.df-role.r-driver{background:rgba(245,158,11,.14);color:#f59e0b}
.df-role.r-staff{background:rgba(var(--teal-rgb,14,165,164),.14);color:var(--teal,#0ea5a4)}
.df-role.stopped{background:#e5e7eb !important;color:#9aa0a6 !important}
.df-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:980}
.df-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(420px,92vw);max-height:88vh;display:flex;flex-direction:column;background:var(--bg);border-radius:16px;z-index:990;box-shadow:0 16px 48px rgba(0,0,0,.18)}
.df-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.df-modal-hd b{font-size:15px;color:var(--t1)}
.df-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.df-modal-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px;flex:1 1 auto;min-height:0;overflow-y:auto}
.df-field{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--t2)}
.req{color:var(--dan)}
.df-store-list{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;max-height:320px;overflow-y:auto}
.df-store-item{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);padding:8px 10px;border:1px solid var(--bd);border-radius:10px;cursor:pointer}
.df-store-item input{accent-color:var(--p)}
.df-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle);flex-shrink:0}

/* 停用视觉 */
.tbl tbody tr.stopped td{color:var(--t3);background:var(--bg2)}
.stopped-tag{display:inline-block;margin-left:6px;font-size:11px;padding:1px 7px;border-radius:8px;background:#e5e7eb;color:#6b7280}
.btn.danger{color:var(--dan)}
.btn-danger{background:var(--dan);color:#fff;border:none}
.btn-danger:hover{filter:brightness(.95)}

/* 编辑弹窗布局 */
.edit-modal{width:min(600px,94vw)}
.df-edit-body{display:flex;flex-direction:column;gap:20px}
.df-sec{display:flex;flex-direction:column;gap:13px}
.df-sec-title{font-size:13px;font-weight:600;color:var(--t1);padding-left:11px;border-left:3px solid var(--p);line-height:1.2}
.df-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px}
.df-field{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--t2)}
.df-field .input, .df-field select{width:100%;box-sizing:border-box;height:36px}
.df-field span{font-size:12.5px;color:var(--t2)}
.df-field .req{color:var(--dan);font-style:normal;font-weight:600}

/* 小程序账号区 */
.df-acc-hint{margin-top:-2px}
.df-acc-sum{font-size:12.5px;color:var(--t2);margin:0 0 2px;line-height:1.6}
.df-acc-sum .on{color:var(--suc);font-weight:600}
.df-acc-sum .off{color:var(--t3)}
.df-acc-create{display:flex;flex-direction:column;gap:12px}
.df-acc-manage{display:flex;flex-direction:column;gap:12px}
.df-acc-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.df-acc-row .input, .df-acc-row select{flex:1;min-width:0}
.btn-block{width:100%}
.warn-text{color:var(--dan);font-weight:500}
.acc-role{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--border-subtle);border-radius:9px;padding:0 11px;font-size:13px;background:var(--bg);color:var(--t1);appearance:none;cursor:pointer}
</style>
