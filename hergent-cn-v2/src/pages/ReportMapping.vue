<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>报单配置</h2>
        <span class="page-sub">把"系统全称 ↔ 报单简称(列头) ↔ 单型"一次性配好，员工小程序报单不再碰列名</span>
      </div>
    </div>

    <!-- v160 模板参数：生成舟谱导入模板时写进「业务员 / 部门 / 仓库」列的值（租户级）。
         原先这些值硬编码在后端代码里，且是**一家客户的值** —— 换一家客户就全错。 -->
    <!-- v242 报单自动化：到点自动建表 / 关单（原在品牌目标弹窗，现归「报单这件事的设置」） -->
    <AutoPeriodBlock />

    <div class="card tp-card">
      <div class="tp-hd" @click="tpOpen = !tpOpen">
        <b>模板参数</b>
        <span class="tp-sub">生成舟谱导入模板时，「业务员 / 部门 / 仓库」列写什么</span>
        <span v-if="profileMissing" class="tp-warn">未设置 · 模板对应列为空</span>
        <span class="tp-toggle">{{ tpOpen ? '收起' : '展开' }}</span>
      </div>
      <div v-if="tpOpen" class="tp-body">
        <div class="tp-grid">
          <div class="field">
            <label>公司名称</label>
            <input v-model="tp.company_name" placeholder="如：××商贸有限公司" />
          </div>
          <div class="field">
            <label>默认业务员</label>
            <input v-model="tp.salesman" placeholder="如：张三" />
          </div>
          <div class="field">
            <label>默认仓</label>
            <input v-model="tp.warehouse" placeholder="如：总仓" />
          </div>
          <div class="field">
            <label>自提单号起始序号</label>
            <input v-model.number="tp.zt_seq_start" type="number" min="1" max="99" />
          </div>
          <div class="field tp-wide">
            <label>下单主体</label>
            <input v-model="tpEntities" placeholder="逗号分隔，如：甲户,乙户" />
            <span class="tp-hint">商品名里写「（×××下单）」时，系统据此识别下单主体。只有一个户头可留空。</span>
          </div>
          <!-- v163：每个下单主体对应一个舟谱「部门」。同一商品可被两个户头下单 ⇒ 同一客户
               会拆出两张单（不合并），每张单的「部门」列按该单的户头取；留空则该单回落用
               上面的「公司名称」，并在生成模板时给出提示。 -->
          <div v-if="tpEntityList.length" class="field tp-wide">
            <label>下单主体对应的舟谱「部门」</label>
            <div class="tp-depts">
              <div v-for="e in tpEntityList" :key="e" class="tp-dept-row">
                <span class="tp-dept-name">{{ e }}</span>
                <input v-model="tpDepts[e]" :placeholder="tp.company_name || '如：××商贸有限公司'" />
              </div>
            </div>
            <span class="tp-hint">同一商品用两个户头下单时，会<u>分别生成两张单</u>，各写各的部门。留空则该单回落用「公司名称」，并在生成时提示核对。</span>
          </div>
        </div>
        <div class="tp-actions">
          <button class="btn btn-primary btn-sm" :disabled="tpSaving" @click="saveProfile">
            {{ tpSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 配置体检红标 -->
    <div v-if="health" class="health-bar" :class="{ ok: !hasProblem }" @click="healthOpen = !healthOpen">
      <span class="hb-dot"></span>
      <template v-if="hasProblem">
        配置体检：<b>{{ health.unmapped_count }}</b> 个门店未配置 · <b>{{ health.alias_conflicts.length }}</b> 个别名冲突 · <b>{{ health.unassigned_count }}</b> 名员工未分配
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
        <b class="hd-t">尚未配置报单的门店（前 50）</b>
        <div class="chip-row"><span v-for="o in health.unmapped_objects" :key="o.id" class="chip">{{ o.name }}</span></div>
      </div>
      <div v-if="health.unassigned_employees.length" class="hd-sec">
        <b class="hd-t">尚未配置报单的员工</b>
        <div class="chip-row"><span v-for="e in health.unassigned_employees" :key="e.id" class="chip">{{ e.name }}</span></div>
      </div>
    </div>

    <!-- 历史门店授权（2026-09-19 收敛）：在旧「员工档案 → 分配门店」里配过、但尚未纳入
         本页报单配置的门店。员工档案侧入口已移除 ⇒ 写端只剩本页；不把它们列出来，
         这些门店就是「小程序看得到、后台没处改」。补一条「门店」映射即收敛
         （之后由映射派生，可停用、可收回）。 -->
    <div v-if="legacyStores.length" class="legacy-bar" @click="legacyOpen = !legacyOpen">
      <span class="lb-dot"></span>
      历史门店授权：<b>{{ legacyStores.length }}</b> 条门店来自旧「员工档案 → 分配门店」，尚未纳入报单配置
      <span class="lb-toggle">{{ legacyOpen ? '收起' : '展开' }}</span>
    </div>
    <div v-if="legacyOpen && legacyStores.length" class="card legacy-detail">
      <b class="hd-t">这些门店现在只有本页能改</b>
      <p class="lb-tip">
        <b>还要用</b> —— 点工具栏「新建配置」，给该员工建一条「门店」映射；此后由映射派生，
        可停用、可启用。<br>
        <b>不要了</b> —— 点「收回」，该员工在小程序里就不再能选这家门店报单；
        <b>不影响</b>已经报过的单与应收。
      </p>
      <ul>
        <li v-for="l in legacyStores" :key="l.employee_id + '-' + l.store_id">
          <span class="lb-row">
            <b>{{ l.employee_name || ('员工 #' + l.employee_id + '（已不在员工档案里）') }}</b>
            <span class="lb-arrow">→</span>
            <span>{{ l.store_name }}</span>
            <span v-if="l.store_active === 0" class="tag danger">门店已停用</span>
            <button class="btn btn-ghost btn-sm danger lb-revoke" @click="askLegacyRevoke(l)">收回</button>
          </span>
        </li>
      </ul>
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
            <th>单型</th><th>取价渠道</th><th>仓库(调拨)</th><th>状态</th><th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in list" :key="m.id" :class="{ stopped: m.is_active === 0 }">
            <td>{{ m.employee_name || '—' }}</td>
            <td><span class="tag" :class="typeClass(m.counterparty_type)">{{ typeLabel(m.counterparty_type) }}</span></td>
            <td>{{ m.counterparty_name || m.system_name || '—' }}</td>
            <td><b>{{ m.report_alias }}</b></td>
            <td>{{ m.order_template || '—' }}</td>
            <td>{{ channelShow(m) }}</td>
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
          <tr v-if="!list.length"><td colspan="9" class="empty">暂无报单配置，点「新建配置」或「Excel 批量导入」开始</td></tr>
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
            <div v-if="form.counterparty_type !== 'self_warehouse'" class="field">
              <label>取价渠道</label>
              <select v-model="form.channel_id">
                <option :value="0">自动（按客户档案／默认渠道）</option>
                <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.name }}{{ c.is_default ? '（默认）' : '' }}</option>
              </select>
              <span class="hint">
                默认「自动」＝先看该客户档案上绑的渠道，没绑就落到默认渠道。这里选了就一直用它，覆盖客户档案。
                调拨不走渠道取价，故不显示。
              </span>
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

    <!-- 收回历史门店授权（v216）：与「停用配置」不同 —— 这里删的是 employee_stores
         那一行（旧入口留下的授权），不是 report_mapping 的映射行。 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="revokeOpen" class="df-overlay" @click="revokeOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="revokeOpen" class="df-modal">
          <div class="df-modal-hd"><b>收回门店</b><button class="df-x" @click="revokeOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="warn-text">
              确认收回「{{ revokeTarget.employee_name || ('员工 #' + revokeTarget.employee_id) }}」
              对「{{ revokeTarget.store_name }}」的报单资格？
            </p>
            <p class="hint">收回后，该员工在小程序里不再能选这家门店报单。<b>不影响</b>已落库的历史报单与应收。</p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="revokeOpen = false">取消</button>
            <button class="btn btn-danger" :disabled="revoking" @click="confirmLegacyRevoke">{{ revoking ? '收回中…' : '确认收回' }}</button>
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
            <p class="hint">模板表头（7 列）：员工 / 对象类型 / 对象全称 / 简称(列头) / 单型 / 源仓 / 目标仓。对象类型填 store（门店）或 self_warehouse（本人仓）。</p>
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
// v242：报单自动化（原在「目标与返利 → 创建品牌目标」弹窗的 ③ 区）迁到本页
import AutoPeriodBlock from '../components/forecast/AutoPeriodBlock.vue'
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { reportMappingApi, priceChannelApi, businessProfileApi } from '../api/modules'
import { api } from '../api/client'
import { toast } from '../store'

const list = ref([])
const refs = reactive({ employees: [], contacts: [], warehouses: [] })
const health = ref(null)
const healthOpen = ref(false)
// 历史门店授权（旧「员工档案 → 分配门店」留下的、尚未纳入报单配置的门店）。
// 员工档案侧入口 2026-09-19 已移除 ⇒ 写端只剩本页；不把它们列出来，
// 这些门店就变成「小程序看得到、后台没处改」（读端有来源、写端无入口）。
const legacyStores = ref([])
const legacyOpen = ref(false)
const editOpen = ref(false)
const editId = ref(0)
const saving = ref(false)
const disableOpen = ref(false)
const disableTarget = ref(0)
// v216（2026-09-20）：**收回**历史门店授权（删 `employee_stores` 单行）。
// ⚠️ 与上面的「停用配置」不是同一件事：那条改的是 `report_mapping` 的**映射行**
// （停用后可再启用），这条删的是旧「员工档案 → 分配门店」留下的**授权行**
// （删了就没了，要恢复得重新建一条映射）。两者都只影响"还能不能报单"。
const revokeOpen = ref(false)
const revokeTarget = ref({})
const revoking = ref(false)
const importOpen = ref(false)
const importResult = ref(null)

// 🔴 v203（2026-09-19）：对象类型收敛为 —— 门店 / 本人仓。
// 依据：`/api/report-mappings/refs` 返回的对象池是 `contacts.type IN ('customer','both')`，
// 「门店」与「客户」两个入口点开选的是**同一批对象**，这个类型只是个分类标签。
// 用户定调「门店和客户是一个意思」⇒ 去掉「客户」入口。
// ⚠️ `customer` 作为**历史兼容别名**仍被后端读端认识（存量行 / 旧 Excel 不会消失），
//    本页把它按「门店」显示、保存即写成 store —— 口径与后端 REPORT_CP_ALIASES 同源。
const types = [
  { v: 'store', label: '门店' },
  { v: 'self_warehouse', label: '本人仓' },
]

// 历史 `customer` → `store`。只做**词汇归一**（与后端 normalize_report_cp_type 同义），
// 不在这里做任何权限/合法性判断。
function normalizeCpType(t) { return t === 'customer' ? 'store' : t }

const form = reactive({
  employee_id: 0, counterparty_type: 'store', counterparty_id: 0,
  system_name: '', report_alias: '', order_template: '', src_wh: 0, dst_wh: 0,
  channel_id: 0,
})

// v160（2026-09-14）：模板参数 —— 舟谱模板的「业务员 / 部门 / 仓库」列、自提单号起始序号、
// 下单主体清单。原先硬编码在后端代码里且是**一家客户的值**，现改为租户自配。
const tpOpen = ref(false)
const tpSaving = ref(false)
const tp = reactive({ company_name: '', salesman: '', warehouse: '总仓', zt_seq_start: 21 })
const tpEntities = ref('')
// v163：户头 → 舟谱「部门」列值。键是下单主体名（与 tpEntities 同源）。
const tpDepts = ref({})
const tpEntityList = computed(() => (tpEntities.value || '').split(/[,，、\s]+/).filter(Boolean))
const profileMissing = computed(() => !tp.company_name || !tp.salesman)

async function loadProfile() {
  try {
    const r = await businessProfileApi.get()
    const p = r.profile || {}
    tp.company_name = p.company_name || ''
    tp.salesman = p.salesman || ''
    tp.warehouse = p.warehouse || '总仓'
    tp.zt_seq_start = p.zt_seq_start || 21
    tpEntities.value = (p.order_entities || []).join(',')
    tpDepts.value = { ...(p.entity_departments || {}) }
    if (profileMissing.value) tpOpen.value = true   // 未配置 → 自动展开引导填写
  } catch { /* 读不到不影响报单配置主流程 */ }
}

async function saveProfile() {
  tpSaving.value = true
  try {
    await businessProfileApi.save({
      company_name: tp.company_name,
      salesman: tp.salesman,
      warehouse: tp.warehouse,
      zt_seq_start: Number(tp.zt_seq_start) || 21,
      order_entities: (tpEntities.value || '').split(/[,，、\s]+/).filter(Boolean),
      // v163：只提交**当前户头清单里**且**非空**的部门名 —— 户头被删掉后它的旧部门名一并清掉，
      // 不留孤儿配置（否则以后重新加回同名户头会悄悄套用一条早已不想要的部门名）。
      entity_departments: Object.fromEntries(
        tpEntityList.value
          .map(e => [e, String(tpDepts.value[e] || '').trim()])
          .filter(([, d]) => d)
      ),
    })
    toast('模板参数已保存')
    await loadProfile()
  } catch (e) {
    toast(e.message || '保存失败', 'err')
  } finally {
    tpSaving.value = false
  }
}

// v159（2026-09-14）：取价渠道。渠道是租户自配的数据，这里只做“覆盖位”；
// 0 = 不覆盖，按客户档案→默认渠道的顺序自动判。
const channels = ref([])
const chMap = computed(() => {
  const m = {}
  for (const c of channels.value) m[c.id] = c
  return m
})
function channelShow(m) {
  if (!m.channel_id) return '自动'
  const c = chMap.value[m.channel_id]
  return c ? c.name : `#${m.channel_id}（已删除）`
}

const hasProblem = computed(() => health.value && (
  health.value.unmapped_count > 0 || health.value.alias_conflicts.length > 0 || health.value.unassigned_count > 0
))

const objOptions = computed(() => {
  if (form.counterparty_type === 'self_warehouse') return refs.warehouses
  return refs.contacts
})

// 对象下拉：可模糊查找的 combobox（门店数量大，原生 select 难翻）
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

// 历史 `customer` 行按「门店」显示、用与门店**同一色板** —— 两者本就是同一批对象，
// 让它们看起来不同只会制造「这里有两种东西」的错觉（v203）。
function typeLabel(t) { return ({ store: '门店', customer: '门店', self_warehouse: '本人仓' })[t] || t }
function typeClass(t) { return ({ store: 'info', customer: 'info', self_warehouse: 'teal' })[t] || 'info' }
function whShow(m) {
  if (m.counterparty_type !== 'self_warehouse') return '—'
  const s = whMap.value[m.src_wh] || '?'
  const d = whMap.value[m.dst_wh] || '?'
  return `${s} → ${d}`
}

async function loadAll() {
  try { list.value = await reportMappingApi.list({ include_inactive: 1 }) } catch (e) { toast(e.message || '加载失败', 'err') }
  try { const r = await reportMappingApi.health(); health.value = r } catch {}
  // 历史门店授权：接口或表缺失时静默降级为空（不能因为一条提示把整页带崩）
  try { const r = await reportMappingApi.legacyStores(); legacyStores.value = r.items || [] } catch { legacyStores.value = [] }
}
async function loadChannels() {
  // 渠道字典只用于下拉与列头显示；失败不影响报单配置本身（不弹错、静默降级成「自动」）
  try { const r = await priceChannelApi.list(); channels.value = r.channels || [] } catch {}
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
  form.channel_id = 0
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
  // v203：历史 `customer` 行归一成 `store` 再进表单 —— ① 类型分段控件里已无「客户」项，
  // 不归一则**没有任何按钮处于选中态**（用户第一反应是「这页坏了」）；
  // ② 保存时自然写回 store，存量数据在用户编辑时零迁移脚本收敛。
  form.counterparty_type = normalizeCpType(m.counterparty_type)
  form.counterparty_id = m.counterparty_id
  form.system_name = m.system_name || ''
  form.report_alias = m.report_alias || ''
  form.order_template = m.order_template || ''
  form.src_wh = m.src_wh || 0
  form.dst_wh = m.dst_wh || 0
  form.channel_id = m.channel_id || 0
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
      // ⚠️ 0 是有效值（＝自动/继承），必须原样传，不能被“空值不传”的写法挡掉
      channel_id: Number(form.channel_id) || 0,
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
// v216：收回历史门店授权。`l` 是 `legacy-stores` 返回的一行（employee_id/store_id/store_name/…），
// 整行存下来是为了确认弹窗能显示「谁 → 哪家店」，而不是只显示一个 id。
function askLegacyRevoke(l) { revokeTarget.value = { ...l }; revokeOpen.value = true }
async function confirmLegacyRevoke() {
  const t = revokeTarget.value || {}
  revoking.value = true
  try {
    const r = await reportMappingApi.revokeLegacyStore(t.employee_id, t.store_id)
    // `removed=0` = 该行本来就不存在（幂等，不是失败）。如实说出来，
    // 否则用户以为"点了没生效"；但仍然刷新页面，因为目标状态已经达成。
    toast(r && r.removed ? '已收回该门店的报单资格' : '该授权本就不存在，已按最新状态刷新', 'ok')
    revokeOpen.value = false
    await loadAll()
  } catch (e) {
    toast(e.message || '收回失败', 'err')
  } finally {
    revoking.value = false
  }
}
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

onMounted(() => { loadRefs(); loadAll(); loadChannels(); loadProfile() })
</script>

<style scoped>
/* v160 模板参数卡片 */
.tp-card{margin-bottom:12px;padding:0;overflow:hidden}
.tp-hd{display:flex;align-items:center;gap:10px;padding:11px 16px;cursor:pointer}
.tp-hd b{font-size:13px;color:var(--t1)}
.tp-sub{font-size:12px;color:var(--t3)}
.tp-warn{font-size:12px;color:var(--war);background:rgba(var(--war-rgb),.12);border:1px solid rgba(var(--war-rgb),.35);padding:1px 8px;border-radius:10px}
.tp-toggle{margin-left:auto;color:var(--p);font-size:12px}
.tp-body{padding:0 16px 14px;border-top:1px solid var(--border-subtle)}
.tp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;padding:14px 0}
.tp-wide{grid-column:1/-1}
.tp-body .field{display:flex;flex-direction:column;gap:5px}
.tp-body .field label{font-size:12px;color:var(--t2)}
.tp-body .field input{padding:7px 10px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg2);color:var(--t1);font-size:13px;outline:none}
.tp-body .field input:focus{border-color:var(--p)}
.tp-hint{font-size:11px;color:var(--t3)}
/* v163：户头 → 部门名行（每行一个户头） */
.tp-depts{display:flex;flex-direction:column;gap:6px}
.tp-dept-row{display:flex;align-items:center;gap:8px}
.tp-dept-name{min-width:76px;font-size:12px;color:var(--t2);flex:0 0 auto}
.tp-dept-row input{flex:1;min-width:0}
.tp-actions{display:flex;gap:8px}
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
/* 历史门店授权提示条：与「配置体检」同构但用中性色 —— 它是「待收敛」不是「有错」。 */
.legacy-bar{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);background:var(--bg2);border:1px solid var(--border-subtle);padding:9px 14px;border-radius:var(--radius-md);margin-bottom:12px;cursor:pointer}
.lb-dot{width:8px;height:8px;border-radius:50%;background:var(--t3);flex-shrink:0}
.lb-toggle{margin-left:auto;color:var(--p);font-size:12px}
.legacy-detail{margin-bottom:12px;padding:14px 16px}
.lb-tip{font-size:12.5px;color:var(--t2);line-height:1.8;margin:8px 0 0}
.legacy-detail ul{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--t2);line-height:1.9}
/* 每行：员工 → 门店 [已停用] [收回] —— 用 inline-flex + wrap，窄屏时按钮换行不挤压文字 */
.lb-row{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.lb-arrow{color:var(--t3)}
.lb-revoke{margin-left:4px}
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
