<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>客户档案</h2>
        <span class="page-sub">管理客户 / 门店主档 —— 支持<b>逐笔新建</b>、<b>Excel 批量导入</b>与外部 ERP 同步</span>
      </div>
      <div class="cas-actions">
        <span class="cas-stat" v-if="total !== null"><b>{{ total }}</b>&nbsp;个客户</span>
        <span class="sync-state" :class="connState">{{ connLabel }}</span>
        <!-- v335 按钮级门禁：本页三个写入口的接口都归后端模块 **data**
             （`/api/datasources`、`/api/contacts`、`/api/import` —— 注意**不是**本页的 `crm`，
               `pages.js` 的 `module` 只管入口显不显示，与接口归属是两回事）：
               同步=POST /api/datasources/v2/*/sync ⇒ create
               新增客户=POST /api/contacts ⇒ create
               导入=POST /api/import/execute ⇒ create -->
        <button v-if="canDo('data', 'create')" class="btn btn-ghost btn-sm" :disabled="syncBusy" @click="onSync">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          {{ syncBusy ? '同步中…' : '同步 ERP' }}
        </button>
        <button v-if="canDo('data', 'create')" class="btn btn-primary btn-sm" @click="openAdd">+ 新增客户</button>
        <button v-if="canDo('data', 'create')" class="btn btn-ghost btn-sm" @click="openImport">导入</button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="card cas-panel">
      <div class="cas-filters">
        <div class="cas-search">
          <svg class="cas-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input v-model="keyword" class="input cas-kw" placeholder="客户名称 / 编码 / 助记码 / 电话" @input="onFilterChange">
        </div>
        <!-- v316：业态下拉的选项**从库里现取**（`/api/contacts/options`）。不给固定 6 项 ——
             生产数据里用户已用开 12 种业态，把现实塞回 6 个格子会造出同义不同字的重复档案。 -->
        <select v-model="bizFilter" class="input" @change="onFilterChange">
          <option value="">全部业态</option>
          <option v-for="b in bizOptions" :key="b" :value="b">{{ b }}</option>
        </select>
        <button class="btn btn-ghost btn-sm" @click="resetFilters">重置</button>
      </div>

      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="items.length" class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th><th>客户名称</th><th v-if="isVisible('channel')">业态</th><th v-if="isVisible('region')">片区</th><th v-if="isVisible('route')">配送线路</th><th>老板 / 电话</th>
              <th v-if="isVisible('sales')">负责业务员</th><th class="num">应收余额</th><th v-if="isVisible('last')">最近下单</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in items" :key="c.id">
              <td class="seq-cell"><span class="seq-num">{{ (page - 1) * pageSize + i + 1 }}</span></td>
              <td class="cas-name">{{ c.name }}</td>
              <td v-if="isVisible('channel')">{{ c.channel || '—' }}</td>
              <td v-if="isVisible('region')">{{ c.region || '—' }}</td>
              <td v-if="isVisible('route')">{{ c.delivery_route || '—' }}</td>
              <td>
                <span v-if="c.boss_name">{{ c.boss_name }}</span><span v-else class="cas-miss">未填</span>
                <span v-if="c.boss_phone" class="cas-phone">{{ c.boss_phone }}</span>
              </td>
              <td v-if="isVisible('sales')">{{ c.assigned_salesperson || '—' }}</td>
              <td class="num" :class="{ 'cas-ar': Number(c.ar_balance) > 0 }">
                {{ Number(c.ar_balance) > 0 ? money(c.ar_balance) : '—' }}
              </td>
              <td v-if="isVisible('last')">{{ fmtDate(c.last_order) }}</td>
              <td class="cas-ops">
                <!-- v335 按钮级门禁：编辑 = PUT /api/contacts/{id} ⇒ data/update
                     （弹窗里的「保存」不再重复判 —— 入口已藏就进不去） -->
                <button v-if="canDo('data', 'update')" class="btn btn-ghost btn-sm" @click="openEdit(c)">编辑</button>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="cas-pager" v-if="total > pageSize">
          <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <span class="cas-pageinfo">第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 个客户</span>
          <button class="btn btn-ghost btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
          <select v-model="pageSize" class="input cas-size" @change="onPageSizeChange">
            <option :value="20">20 / 页</option>
            <option :value="50">50 / 页</option>
            <option :value="100">100 / 页</option>
          </select>
        </div>
      </div>
      <div v-else class="state-empty">
        {{ keyword || bizFilter ? '没有匹配的客户，换个条件试试' : '还没有客户档案 —— 点右上角「+ 新增客户」，或用「导入」批量录入' }}
      </div>
      <ColMenuPanel ref="panel" :col-list="COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />
    </div>

    <Teleport to="body">
      <!-- 新增 / 编辑客户 -->
      <Transition name="fade"><div v-if="formOpen" class="cas-overlay" @click="formOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="formOpen" class="cas-modal" role="dialog" aria-modal="true">
          <div class="cas-modal-hd">
            <b>{{ editTarget ? '编辑客户' : '新增客户' }}</b>
            <button class="cas-x" @click="formOpen = false"><Icon name="close"/></button>
          </div>
          <div class="cas-modal-body">
            <p class="cas-tip">
              只摆真实在用的字段；点「更多字段」可填编码 / 结算方式等。
              <template v-if="editTarget">没改动的项目会<b>保持原样</b>，不会被动到。</template>
            </p>
            <div class="cas-form">
              <label class="cas-f"><span>客户名称 <i>*</i></span>
                <input v-model="form.name" class="input" placeholder="必填，如「XX 超市」"></label>
              <!-- 业态：`contacts.channel` 这一列装的其实是**业态**（20店/零食系统/便利店…）。
                   label 必须叫「业态」—— 叫「渠道」会和「渠道与价格」模块那个渠道（永辉/分销价）撞名。 -->
              <label class="cas-f"><span>业态 <em>可手填，也可选已有</em></span>
                <input v-model="form.channel" class="input" list="cas-biz-list" placeholder="如 便利店 / 零食系统"></label>
              <label class="cas-f"><span>片区</span>
                <input v-model="form.region" class="input" list="cas-region-list" placeholder="如 樊城 / 襄城"></label>
              <label class="cas-f"><span>负责业务员</span>
                <input v-model="form.assigned_salesperson" class="input" list="cas-emp-list" placeholder="选已有或手填"></label>
              <label class="cas-f"><span>老板姓名</span>
                <input v-model="form.boss_name" class="input" placeholder="如 张老板"></label>
              <label class="cas-f"><span>老板电话</span>
                <input v-model="form.boss_phone" class="input" placeholder="门店老板的手机号"></label>
              <!-- v386：配送线路。与「片区」同族（都是"怎么找到/送到这家店"），
                   但**追加为核心 6 格之后的第 7 格**（`.cas-form` 是 `1fr 1fr` 两列网格）
                   —— 前 6 个字段的栅格位置一格不动（行 1-3 原样），对已经熟悉这页的人零视觉扰动。
                   代价：第 7 格独占行 4 左格，右格留白（后面「地址 / 备注」都是 `cas-f-full` 通栏，
                   填不了这一格）。若哪天要消掉这块留白，正解是**再补一个字段**或把本格改通栏，
                   不是往前挪 —— 往前挪会把 负责业务员/老板姓名/老板电话 三格整体位移。
                   `list="cas-route-list"` 的候选**从库里现取**（后端 contact_options 的
                   safe 白名单已补 delivery_route）—— 不这么做的话，用户会把
                   「城东线」「城东线路」填成两种值，而档案匹配是按名字匹配的（v316 已付过代价）。 -->
              <label class="cas-f"><span>配送线路 <em>选已有或手填</em></span>
                <input v-model="form.delivery_route" class="input" list="cas-route-list" placeholder="如 城东线"></label>
              <label class="cas-f cas-f-full"><span>地址</span>
                <input v-model="form.address" class="input" placeholder="门店地址"></label>
              <label class="cas-f cas-f-full"><span>备注</span>
                <textarea v-model="form.note" class="input cas-ta" placeholder="选填"></textarea></label>
            </div>

            <button class="cas-more" @click="showMore = !showMore">
              {{ showMore ? '收起更多字段' : '更多字段（选填）' }}
              <span class="cas-caret">{{ showMore ? '▲' : '▼' }}</span>
            </button>
            <div v-if="showMore" class="cas-form cas-form-more">
              <label class="cas-f"><span>编码 <em>留空即可</em></span>
                <input v-model="form.code" class="input" placeholder="一般不填"></label>
              <label class="cas-f"><span>助记码 <em>用于快速搜索</em></span>
                <input v-model="form.mnemonic" class="input" placeholder="如 XXCS"></label>
              <label class="cas-f"><span>电话 <em>备用号</em></span>
                <input v-model="form.phone" class="input" placeholder="一般不填"></label>
              <label class="cas-f"><span>结算方式</span>
                <select v-model="form.settlement_method" class="input">
                  <option value="">未设置</option>
                  <option value="现结">现结</option>
                  <option value="赊账">赊账</option>
                </select></label>
              <label class="cas-f"><span>账期（天）<em>赊账才填</em></span>
                <input v-model="form.credit_days" class="input" type="text" inputmode="numeric" placeholder="0 = 现结"></label>
              <label class="cas-f"><span>信用额度（元）</span>
                <input v-model="form.credit_limit" class="input" type="text" inputmode="numeric" placeholder="0 = 不限制"></label>
            </div>
          </div>
          <div class="cas-modal-ft">
            <button class="btn btn-ghost" @click="formOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="formSaving" @click="saveForm">{{ formSaving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>

      <!-- 导入客户（Excel） -->
      <Transition name="fade"><div v-if="impOpen" class="cas-overlay" @click="impOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="impOpen" class="cas-modal">
          <div class="cas-modal-hd"><b>导入客户（Excel）</b><button class="cas-x" @click="impOpen = false"><Icon name="close"/></button></div>
          <div class="cas-modal-body">
            <p v-if="impStep === 'pick'" class="cas-tip">
              下载模板 → 按列填写 → 选文件自动识别列。同名同类型的客户<b>不会重复建</b>（会被跳过并逐条点名）。
            </p>
            <div class="cas-imp-row">
              <button class="btn btn-ghost" @click="downloadTpl">下载模板</button>
              <label class="btn btn-ghost cas-file-btn">
                选择文件
                <input type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onImpFile">
              </label>
              <span v-if="impFileName" class="cas-fname">{{ impFileName }}</span>
              <button v-if="impStep === 'pick'" class="btn btn-primary" :disabled="!impFile || impSaving" @click="previewImport">{{ impSaving ? '识别中…' : '下一步' }}</button>
            </div>
            <template v-if="impStep === 'map'">
              <p class="cas-tip">核对「识别为」这一列 —— 认错了就在下拉里改；标「不导入」的列不会进来。</p>
              <ImportMapping v-model="impMapping" :suggestions="impSuggestions" :field-options="impFieldOptions"
                             :memory="impMemory" v-model:incremental="impInc" />
            </template>
            <ImportReceipt :result="impResult" @undone="loadList()" />
          </div>
          <div class="cas-modal-ft">
            <template v-if="impStep === 'map'">
              <button class="btn btn-ghost" :disabled="impSaving" @click="impStep = 'pick'">返回</button>
              <button class="btn btn-primary" :disabled="impSaving" @click="doImport">{{ impSaving ? '导入中…' : '确认导入' }}</button>
            </template>
            <button v-else class="btn btn-primary" @click="impOpen = false">关闭</button>
          </div>
        </div>
      </Transition>

      <!-- 未连接提醒 -->
      <Transition name="fade"><div v-if="remindOpen" class="cas-overlay" @click="remindOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="remindOpen" class="cas-modal">
          <div class="cas-modal-hd"><b>尚未连接 ERP</b><button class="cas-x" @click="remindOpen = false"><Icon name="close"/></button></div>
          <div class="cas-modal-body">
            <p class="cas-tip">「同步」需要先把你的 ERP（畅捷通 / 金蝶）接入 Hergent。</p>
            <p class="cas-tip">请前往 <b>AI 引擎 › 连接器</b> 完成授权连接后，再来点「同步」。</p>
            <p class="cas-tip">还没接 ERP 也没关系 —— 用上面的「+ 新增客户」或「导入」先把客户录进来。</p>
          </div>
          <div class="cas-modal-ft">
            <button class="btn btn-ghost" @click="remindOpen = false">知道了</button>
            <button class="btn btn-primary" @click="goConnect">去 AI 引擎</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 表单字段的「已有值」候选（datalist）：选项来自后端现取，不是前端硬编码 -->
    <datalist id="cas-biz-list"><option v-for="b in bizOptions" :key="'b' + b" :value="b"></option></datalist>
    <datalist id="cas-region-list"><option v-for="r in regionOptions" :key="'r' + r" :value="r"></option></datalist>
    <datalist id="cas-emp-list"><option v-for="s in salesOptions" :key="'s' + s" :value="s"></option></datalist>
    <datalist id="cas-route-list"><option v-for="r in routeOptions" :key="'rt' + r" :value="r"></option></datalist>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { useColSettings } from '../composables/useColSettings.js'
import ColMenuPanel from '../components/ColMenuPanel.vue'
import ImportMapping from '../components/ImportMapping.vue'
import ImportReceipt from '../components/ImportReceipt.vue'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { importApi } from '../api/modules'
import { toast, canDo } from '../store'
/* v291：页内跳转入口同判据（见 goConnect）。 */

/* 🔴 列设置（齿轮）：替换「序号」表头，可选列默认全开，核心列恒显。 */
const COLS = [
  { key: 'channel', label: '业态', core: false },
  { key: 'region', label: '片区', core: false },
  { key: 'route', label: '配送线路', core: false },
  { key: 'sales', label: '负责业务员', core: false },
  { key: 'last', label: '最近下单', core: false },
]
const { isVisible, toggleCol, resetCols } = useColSettings('CUSTOMER-ARCHIVE', COLS)
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }

import { canSee } from '../constants/pages'

const router = useRouter()

/* ---- 列表 ---- */
const items = ref([])
const total = ref(null)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const keyword = ref('')
const bizFilter = ref('')
const totalPages = computed(() => Math.max(1, Math.ceil((total.value || 0) / pageSize.value)))

/* ---- 表单的「已有值」候选 ---- */
const bizOptions = ref([])
const regionOptions = ref([])
const salesOptions = ref([])
const routeOptions = ref([])

/* ---- ERP 同步 ---- */
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

/* ---- 新增 / 编辑 ---- */
/* 表单字段清单 = 提交白名单的**唯一来源**（校验、diff、新建三条路都读它）。
   ⚠️ 后端 `contact_create` / `contact_update` 各有自己的 allowed 白名单；
      两边不对齐就是「填了不生效、零报错」那一族缺陷（v316 修过一次）。
      往这里加字段时，**必须同时确认那两个白名单里有它**。 */
const FORM_FIELDS = ['name', 'channel', 'region', 'delivery_route', 'assigned_salesperson',
                     'boss_name', 'boss_phone',
                     'address', 'note', 'code', 'mnemonic', 'phone', 'settlement_method',
                     'credit_days', 'credit_limit']
const NUM_FIELDS = ['credit_days', 'credit_limit']
const formOpen = ref(false)
const formSaving = ref(false)
const showMore = ref(false)
const editTarget = ref(null)
const form = ref({})
const baseline = ref({})

/* ---- 导入 ---- */
const impOpen = ref(false)
const impFile = ref(null)
const impFileName = ref('')
const impSaving = ref(false)
const impStep = ref('pick')
const impSuggestions = ref([])
const impFieldOptions = ref([])
const impMapping = ref({})
const impMemory = ref(null)
const impInc = ref(true)
const impResult = ref(null)

function money(v) {
  const n = Number(v || 0)
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/* 日期只显示到「天」。后端 `sale_orders.order_date` 存的是 `2026-08-08 00:00:00`
   —— 直出会多出**永远为 0 的时分秒**（v316b 真机截图上就是这么显示的）。 */
function fmtDate(v) {
  const s = String(v || '').trim()
  if (!s) return '—'
  return s.length >= 10 ? s.slice(0, 10) : s
}

/* 数值归一化：中文输入法常打出**全角数字**（１２３）与中文标点（。、，）。
   先 NFKC 折半角，再把「。」当小数点、「、」「，」当千分位去掉 —— 与站内数字格同一套规则。
   ⚠️ 本项目数字格的病根在**输入层**：用 `type=number` 时浏览器会直接吞掉这些字符，
      用户看到的是「打了没反应」，所以这里用 `type=text + inputmode=numeric`。 */
function numNorm(v) {
  let s = String(v ?? '').trim()
  if (!s) return ''
  s = s.normalize('NFKC').replace(/。/g, '.').replace(/[、，,]/g, '')
  const n = Number(s)
  return isFinite(n) ? n : ''
}
function normVal(k, v) {
  if (NUM_FIELDS.includes(k)) return numNorm(v)
  return String(v ?? '').trim()
}

async function loadList() {
  loading.value = true
  try {
    const q = ['type=customer',                    // 🔴 必须显式传：不传会把 14 个员工 + 4 个部门当客户列出来
               'limit=' + pageSize.value,
               'offset=' + ((page.value - 1) * pageSize.value)]
    if (keyword.value) q.push('keyword=' + encodeURIComponent(keyword.value))
    if (bizFilter.value) q.push('channel=' + encodeURIComponent(bizFilter.value))
    const d = await api('/api/contacts?' + q.join('&'))
    items.value = d.items || []
    total.value = d.total || 0
  } catch (e) { toast(e.message || '加载客户失败', 'err') }
  finally { loading.value = false }
}

async function loadOptions() {
  try {
    const d = await api('/api/contacts/options?type=customer')
    const o = (d && d.options) || {}
    bizOptions.value = o.channel || []
    regionOptions.value = o.region || []
    salesOptions.value = o.assigned_salesperson || []
    routeOptions.value = o.delivery_route || []
  } catch (e) { /* 候选是增强项，失败不影响主流程 */ }
}

let _t = null
function onFilterChange() {
  clearTimeout(_t)
  _t = setTimeout(() => { page.value = 1; loadList() }, 250)
}
function resetFilters() { keyword.value = ''; bizFilter.value = ''; page.value = 1; loadList() }
function goPage(p) { if (p < 1 || p > totalPages.value) return; page.value = p; loadList() }
function onPageSizeChange() { page.value = 1; loadList() }

function blankForm() {
  const f = {}
  for (const k of FORM_FIELDS) f[k] = ''
  return f
}
function openAdd() {
  editTarget.value = null
  form.value = blankForm()
  baseline.value = {}
  showMore.value = false
  formSaving.value = false
  formOpen.value = true
}
function openEdit(c) {
  editTarget.value = c
  const f = {}
  for (const k of FORM_FIELDS) f[k] = c[k] == null ? '' : String(c[k])
  form.value = f
  baseline.value = { ...f }        // 编辑走 diff：基线就是"打开时看到的值"
  showMore.value = false
  formSaving.value = false
  formOpen.value = true
}

async function saveForm() {
  const f = form.value
  if (!String(f.name || '').trim()) { toast('请填写客户名称', 'err'); return }
  formSaving.value = true
  try {
    if (editTarget.value) {
      // **只提交真的改动过的字段**（与商品编辑弹窗同一范式）：
      // 不整表回传 ⇒ 不误清空、不留假痕迹、并发时不吃掉别人刚改的字段。
      const body = {}
      for (const k of FORM_FIELDS) {
        const nv = normVal(k, f[k])
        if (nv === baseline.value[k]) continue
        if (nv === '' && NUM_FIELDS.includes(k)) continue   // 数字留空 = 不动（不写成 0）
        body[k] = nv
      }
      if (!Object.keys(body).length) { toast('没有改动', 'warn'); formSaving.value = false; return }
      await api('/api/contacts/' + editTarget.value.id, { method: 'PUT', body })
      toast('已保存 ' + Object.keys(body).length + ' 处改动', 'ok')
    } else {
      const body = { name: String(f.name).trim(), type: 'customer' }
      for (const k of FORM_FIELDS) {
        if (k === 'name') continue
        const nv = normVal(k, f[k])
        if (nv === '') continue
        body[k] = nv
      }
      const r = await api('/api/contacts', { method: 'POST', body })
      toast(r && r.id ? '客户已新建' : '已提交', 'ok')
    }
    formOpen.value = false
    await Promise.all([loadList(), loadOptions()])
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { formSaving.value = false }
}

/* ---- 导入客户 ---- */
function openImport() {
  impFile.value = null; impFileName.value = ''; impResult.value = null; impSaving.value = false
  impStep.value = 'pick'; impSuggestions.value = []; impFieldOptions.value = []; impMapping.value = {}
  impMemory.value = null; impInc.value = true
  impOpen.value = true
}
function onImpFile(ev) {
  const f = ev.target.files[0] || null
  if (f && !/\.(xlsx|xls|csv)$/i.test(f.name)) { toast('仅支持 Excel/CSV 文件', 'err'); ev.target.value = ''; return }
  impFile.value = f; impFileName.value = f ? f.name : ''; impResult.value = null
  impMemory.value = null
  impStep.value = 'pick'
}
async function downloadTpl() {
  try {
    const blob = await importApi.templateFile('contacts')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '客户导入模板.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}
async function previewImport() {
  if (!impFile.value) return
  impSaving.value = true
  try {
    const prev = await importApi.preview(impFile.value, 'contacts')
    impSuggestions.value = prev.suggestions || []
    impFieldOptions.value = prev.field_options || []
    impMemory.value = prev.remembered || null
    if (!impSuggestions.value.length) { toast('没读到任何列，请检查文件是否为 Excel/CSV', 'err'); return }
    const m = {}
    for (const s of impSuggestions.value) if (s.suggested_field) m[s.index] = s.suggested_field
    impMapping.value = m
    impStep.value = 'map'
  } catch (e) { toast(e.message || '文件解析失败', 'err') }
  finally { impSaving.value = false }
}
async function doImport() {
  if (!impFile.value) return
  impSaving.value = true
  try {
    const r = await importApi.execute(impFile.value, 'contacts', impMapping.value,
                                      impInc.value ? { mode: 'incremental' } : {})
    impResult.value = r
    impStep.value = 'pick'
    toast('导入完成：成功 ' + ((r.results && r.results.success) || 0) + ' 条',
          (r.results && r.results.errors && r.results.errors.length) ? 'warn' : 'ok')
    await Promise.all([loadList(), loadOptions()])
  } catch (e) { toast(e.message || '导入失败', 'err') }
  finally { impSaving.value = false }
}

/* ---- ERP 同步 ---- */
async function probeConnectors() {
  try { const s = await api('/api/datasources/v2/chanjet/status'); chanjetLinked.value = !!s.connected } catch { chanjetLinked.value = false }
  try { const s = await api('/api/datasources/v2/kingdee/status'); kingdeeLinked.value = !!s.connected } catch { kingdeeLinked.value = false }
}
async function onSync() {
  if (!chanjetLinked.value && !kingdeeLinked.value) { remindOpen.value = true; return }
  syncBusy.value = true
  try {
    const jobs = []
    if (chanjetLinked.value) jobs.push(api('/api/datasources/v2/chanjet/sync', { method: 'POST', body: { objects: ['customers', 'products', 'suppliers'] } }))
    if (kingdeeLinked.value) jobs.push(api('/api/datasources/v2/kingdee/sync', { method: 'POST', body: { objects: ['customers', 'products', 'suppliers', 'inventory', 'sales_orders', 'purchase_orders'] } }))
    await Promise.all(jobs)
    toast('已同步客户/商品档案', 'ok')
    loadList()
  } catch (e) { toast(e.message || '同步失败', 'err') }
  finally { syncBusy.value = false }
}
function goConnect() {
  /* v291（2026-09-27）：入口同判据 —— 能进档案的人**不一定**能进「AI 引擎」
     （业务员能进档案，但不能进连接器/数据源配置）⇒ 不判就会出现"点了被弹回工作台"（假入口）。
     ⚠️ v311：容器已由「能力中心」更名「AI 引擎」——**提示文案必须跟着改**，
        否则用户按提示去找一个已经不存在的菜单名。路由仍是 `/connect`，判据没变。 */
  if (!canSee('/connect')) { toast('你没有访问「AI 引擎」的权限', 'warn'); return }
  remindOpen.value = false
  router.push('/connect')
}

onMounted(() => { loadList(); loadOptions(); probeConnectors() })
</script>

<style scoped>
.cas-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap}
.cas-stat{font-size:12.5px;color:var(--t2)}
.cas-stat b{font-size:15px;color:var(--t1)}
.sync-state{font-size:11.5px;padding:3px 10px;border-radius:10px;background:var(--bg2);color:var(--t3);white-space:nowrap}
.sync-state.linked{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.sync-state.unlinked{background:rgba(var(--war-rgb),.12);color:var(--war)}

.cas-panel{padding:18px;margin-bottom:14px}
.cas-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.cas-search{position:relative;display:flex;align-items:center;flex:0 1 280px;min-width:180px}
.cas-search-ico{position:absolute;left:10px;width:15px;height:15px;color:var(--t3);pointer-events:none}
.cas-kw{width:100%;padding-left:32px}
.cas-filters select{flex:0 0 150px;width:150px}

.tbl td.cas-name{font-weight:600;color:var(--t1)}
.cas-miss{color:var(--t3)}
.cas-phone{display:block;font-size:11.5px;color:var(--t3);font-variant-numeric:tabular-nums}
.cas-ar{color:var(--dan);font-weight:600}
.cas-ops{text-align:right;white-space:nowrap}

.cas-pager{display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}
.cas-pageinfo{font-size:12.5px;color:var(--t2)}
.cas-size{height:30px;width:auto}

/* 弹窗 */
.cas-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:var(--z-overlay)}
.cas-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(560px,94vw);max-height:88vh;
  display:flex;flex-direction:column;background:var(--bg);border-radius:var(--radius-lg);z-index:var(--z-modal);box-shadow:var(--shadow-lg)}
.cas-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.cas-modal-hd b{font-size:15px;color:var(--t1)}
.cas-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.cas-modal-body{padding:18px 20px;overflow-y:auto}
.cas-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
.cas-tip{font-size:12px;color:var(--t2);line-height:1.7;margin:0 0 12px;background:var(--bg2);padding:8px 12px;border-radius:8px}

.cas-form{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.cas-form-more{margin-top:12px;padding-top:12px;border-top:1px dashed var(--border-subtle)}
.cas-f{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--t2)}
.cas-f>span{display:flex;align-items:baseline;gap:6px}
.cas-f i{color:var(--dan);font-style:normal}
.cas-f em{font-size:11px;color:var(--t3);font-style:normal}
.cas-f .input{height:32px;padding:0 10px}
.cas-f-full{grid-column:1 / -1}
.cas-ta{height:auto;min-height:60px;padding:8px 10px;line-height:1.6;resize:vertical;font-family:inherit}
.cas-more{width:100%;margin-top:12px;padding:8px;border:1px dashed var(--border-subtle);border-radius:8px;
  background:none;color:var(--t2);font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.cas-more:hover{color:var(--p);border-color:var(--p)}
.cas-caret{font-size:10px}

.cas-imp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cas-file-btn{position:relative;overflow:hidden}
.cas-fname{font-size:12.5px;color:var(--t2)}

@media (max-width:640px){
  .cas-form{grid-template-columns:1fr}
  .cas-modal{width:96vw;max-height:92vh}
  .cas-search{flex:1 1 100%}
  .cas-filters select{flex:1 1 46%;width:auto}
}
</style>
