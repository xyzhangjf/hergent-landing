<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>{{ meta.label }}</h2>
        <span class="page-sub">{{ subText }}</span>
      </div>
      <div class="fd-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()"><Icon name="refresh" :size="14" />刷新</button>
        <button class="btn btn-primary btn-sm" @click="openCreate"><Icon name="plus" :size="14" />新建</button>
      </div>
    </div>

    <Skeleton v-if="loading" />
    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <template v-else>
      <!-- 概览 -->
      <div class="card kpi-strip cols-3">
        <div class="kpi"><div class="kpi-label">草稿</div><div class="kpi-val">{{ stats.draft }}</div><div class="kpi-sub">待过账</div></div>
        <div class="kpi"><div class="kpi-label">已过账</div><div class="kpi-val val-ok">{{ stats.posted }}</div><div class="kpi-sub">本类单据</div></div>
        <div class="kpi"><div class="kpi-label">金额合计</div><div class="kpi-val">¥{{ fmtMoney(stats.amount) }}</div><div class="kpi-sub">已过账单据</div></div>
      </div>

      <!-- 筛选 -->
      <div class="card fd-filter">
        <div class="fd-frow">
          <label>日期从<input type="date" v-model="f.date_from" class="input"></label>
          <label>日期到<input type="date" v-model="f.date_to" class="input"></label>
          <label>状态
            <select v-model="f.status" class="input">
              <option value="all">全部</option>
              <option value="draft">草稿</option>
              <option value="posted">已过账</option>
              <option value="void">已作废</option>
            </select>
          </label>
          <label class="fd-grow">关键词<input v-model="f.keyword" class="input" placeholder="单号 / 对方 / 备注"></label>
          <button class="btn btn-ghost btn-sm" @click="load()"><Icon name="search" :size="14" />查询</button>
        </div>
      </div>

      <!-- 列表 -->
      <div class="card fd-card">
        <div v-if="!list.length" class="state-empty">暂无{{ meta.label }}。</div>
        <div v-else class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th><th>单号</th><th>日期</th>
                <th v-if="meta.partyType !== 'none'">对方</th>
                <th>账户</th><th class="num">金额</th><th>状态</th><th class="fd-op">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(d, i) in list" :key="d.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ d.doc_no }}</td>
                <td>{{ d.bill_date }}</td>
                <td v-if="meta.partyType !== 'none'">{{ d.party_name || '—' }}</td>
                <td>{{ d.account || '—' }}</td>
                <td class="num" :class="amountCls(d)">¥{{ fmtMoney(d.amount) }}</td>
                <td><span class="tag" :class="fundStatusTag(d.status)">{{ fundStatusText(d.status) }}</span></td>
                <td class="fd-op">
                  <button class="btn btn-ghost btn-sm" @click="openDetail(d)">查看</button>
                  <button v-if="d.status === 'draft'" class="btn btn-ghost btn-sm" @click="doPost(d)">过账</button>
                  <button v-if="d.status !== 'void'" class="btn btn-danger btn-sm" @click="doVoid(d)">作废</button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb">本页合计</td>
                <td></td>
                <td></td>
                <td v-if="meta.partyType !== 'none'"></td>
                <td></td>
                <td class="num">¥{{ fmtMoney(pageTotals.amount) }}</td>
                <td></td>
                <td class="fd-op"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>

    <!-- 新建弹窗 -->
    <div v-if="showCreate" class="fd-mask" @click.self="showCreate = false">
      <div class="fd-modal">
        <div class="fd-modal-hd"><h3>新建{{ meta.label }}</h3><button class="fd-x" @click="showCreate = false">✕</button></div>
        <div class="fd-modal-bd">
          <div class="fd-frow">
            <label>日期<input type="date" v-model="form.bill_date" class="input"></label>
            <label v-if="meta.partyType !== 'none'">{{ meta.partyLabel }}名称
              <input v-model="form.party_name" class="input" :placeholder="meta.partyLabel + '名称'">
            </label>
          </div>
          <!-- 账户：调拨单为「从 → 到」双选 -->
          <div class="fd-frow" v-if="meta.dir === 'transfer'">
            <label>调出账户
              <select v-model="form.account" class="input"><option value="">请选择</option><option v-for="a in accounts" :key="a.id" :value="a.name">{{ a.name }}</option></select>
            </label>
            <label>调入账户
              <select v-model="form.to_account" class="input"><option value="">请选择</option><option v-for="a in accounts" :key="a.id" :value="a.name">{{ a.name }}</option></select>
            </label>
          </div>
          <div class="fd-frow" v-else>
            <label>账户
              <select v-model="form.account" class="input"><option value="">请选择</option><option v-for="a in accounts" :key="a.id" :value="a.name">{{ a.name }}（{{ a.type }}）</option></select>
            </label>
            <label v-if="!meta.itemMode">金额
              <input type="number" step="0.01" v-model="form.amount" class="input" placeholder="0.00">
            </label>
          </div>

          <!-- 明细行（结算 / 成本） -->
          <div v-if="meta.itemMode" class="fd-items">
            <div class="fd-items-hd">
              <span>{{ itemLabel }}</span>
              <button class="btn btn-ghost btn-sm" @click="addItem">＋ 加一行</button>
            </div>
            <div class="table-wrap">
              <table class="tbl">
                <thead><tr>
                  <th v-for="c in itemCols" :key="c.key">{{ c.label }}</th><th class="fd-op">删</th>
                </tr></thead>
                <tbody>
                  <tr v-for="(it, idx) in form.items" :key="idx">
                    <td v-for="c in itemCols" :key="c.key">
                      <input v-if="c.type === 'num'" type="number" step="0.01" v-model="it[c.key]" class="input fd-i">
                      <input v-else v-model="it[c.key]" class="input fd-i" :placeholder="c.placeholder">
                    </td>
                    <td class="fd-op"><button class="btn btn-danger btn-sm" @click="form.items.splice(idx, 1)">✕</button></td>
                  </tr>
                  <tr v-if="!form.items.length"><td :colspan="itemCols.length + 1" class="state-empty">暂未添加明细</td></tr>
                </tbody>
              </table>
            </div>
            <div class="fd-items-sum">合计：¥{{ fmtMoney(itemSum) }}</div>
          </div>

          <label class="fd-full">备注<textarea v-model="form.remark" class="input" rows="2" placeholder="选填"></textarea></label>
          <p v-if="formErr" class="fd-err">{{ formErr }}</p>
        </div>
        <div class="fd-modal-ft">
          <button class="btn btn-ghost btn-sm" @click="showCreate = false">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="submitCreate">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <div v-if="showDetail" class="fd-mask" @click.self="showDetail = false">
      <div class="fd-modal">
        <div class="fd-modal-hd"><h3>{{ detail.doc_no }}</h3><button class="fd-x" @click="showDetail = false">✕</button></div>
        <div class="fd-modal-bd">
          <div class="fd-dl">
            <div><span>类型</span>{{ fundDocLabel(detail.doc_type) }}</div>
            <div><span>日期</span>{{ detail.bill_date }}</div>
            <div v-if="detail.party_name"><span>{{ meta.partyLabel || '对方' }}</span>{{ detail.party_name }}</div>
            <div><span>账户</span>{{ detail.account || '—' }}</div>
            <div><span>金额</span>¥{{ fmtMoney(detail.amount) }}</div>
            <div><span>状态</span><span class="tag" :class="fundStatusTag(detail.status)">{{ fundStatusText(detail.status) }}</span></div>
            <div v-if="detail.remark"><span>备注</span>{{ detail.remark }}</div>
          </div>
          <div v-if="detail.items && detail.items.length" class="fd-items">
            <div class="fd-items-hd"><span>明细（{{ detail.items.length }} 行）</span></div>
            <div class="table-wrap">
              <table class="tbl">
                <thead><tr><th v-for="c in itemCols" :key="c.key">{{ c.label }}</th><th class="num">金额</th></tr></thead>
                <tbody>
                  <tr v-for="(it, idx) in detail.items" :key="idx">
                    <td v-for="c in itemCols" :key="c.key">{{ it[c.key] || '—' }}</td>
                    <td class="num">¥{{ fmtMoney(it.amount || 0) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="fd-modal-ft" v-if="detail.status === 'draft'">
          <button class="btn btn-ghost btn-sm" @click="showDetail = false">关闭</button>
          <button class="btn btn-primary btn-sm" @click="doPost(detail); showDetail = false">过账</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 资金管理 · 参数化单据引擎（覆盖 17 类资金单据）。
   🔴 docType 由路由 `meta.docType` 注入（一处配置、28 页复用同一引擎）。
   🔴 复用全局件：.page/.page-hd/.card/.kpi-strip/.tbl/.tag/.state-*；私有类一律 `fd-` 前缀。
   🔴 金额显示唯一实现 = psiLabels.fmtMoney；状态中文/徽标 = fundLabels 词表。
   🔴 失败显式抛出：api() 抛 Error，页面必显示 .state-error，不许 catch {} 吞。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { fundsApi } from '../../api/funds'
import { fmtMoney } from '../../constants/psiLabels'
import { FUND_DOC_META, fundDocLabel, fundStatusText, fundStatusTag, FUND_ITEM_COLS } from '../../constants/fundLabels'

const route = useRoute()
const docType = computed(() => route.meta.docType || 'receipt')
const meta = computed(() => FUND_DOC_META[docType.value] || { label: fundDocLabel(docType.value), partyType: 'none', dir: 'in', itemMode: null })

const loading = ref(true)
const err = ref('')
const list = ref([])
const accounts = ref([])

const f = reactive({ date_from: '', date_to: '', status: 'all', keyword: '' })

const subText = computed(() => {
  const m = meta.value
  if (m.dir === 'transfer') return '同一笔调拨在两个账户间互转，不影响资金总额'
  if (m.dir === 'cost') return '核算商品出入库成本，过账后写入成本快照'
  return m.partyType === 'none' ? '资金单据' : `${m.partyLabel}相关资金单据`
})

const stats = computed(() => {
  let draft = 0, posted = 0, amount = 0
  for (const d of list.value) {
    if (d.status === 'draft') draft++
    else if (d.status === 'posted') { posted++; amount += Number(d.amount || 0) }
  }
  return { draft, posted, amount }
})
/* v512：客户端「本页合计」—— 后端单据列表不返回合计，对当前页可见行金额求和。
   ⚠️ 含草稿 / 已过账 / 已作废全部可见行（与 v511「本页可见行」同口径）；「已过账金额合计」见上方 KPI。 */
const pageTotals = computed(() => {
  let amount = 0
  for (const d of list.value) amount += Number(d.amount || 0)
  return { amount }
})

const itemCols = computed(() => (meta.value.itemMode ? FUND_ITEM_COLS[meta.value.itemMode] : []))
const itemLabel = computed(() => (meta.value.itemMode === 'cost' ? '成本明细' : '结算明细'))
const itemSum = computed(() => form.items.reduce((s, it) => s + Number(it.amount || 0), 0))

function amountCls(d) {
  if (meta.value.dir === 'out') return 'val-bad'
  if (meta.value.dir === 'in') return 'val-ok'
  return ''
}

async function load() {
  loading.value = true
  err.value = ''
  try {
    const [dl, al] = await Promise.all([
      fundsApi.docs({ doc_type: docType.value, ...f }),
      fundsApi.accounts()
    ])
    list.value = Array.isArray(dl.items) ? dl.items : []
    accounts.value = Array.isArray(al.items) ? al.items : []
  } catch (e) {
    err.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

/* —— 新建 —— */
const showCreate = ref(false)
const saving = ref(false)
const formErr = ref('')
const form = reactive({ bill_date: new Date().toISOString().slice(0, 10), party_name: '', account: '', to_account: '', amount: '', remark: '', items: [] })

function openCreate() {
  formErr.value = ''
  form.bill_date = new Date().toISOString().slice(0, 10)
  form.party_name = ''
  form.account = accounts.value[0] ? accounts.value[0].name : ''
  form.to_account = ''
  form.amount = ''
  form.remark = ''
  form.items = []
  showCreate.value = true
}
function addItem() {
  const row = {}
  for (const c of itemCols.value) row[c.key] = ''
  form.items.push(row)
}
async function submitCreate() {
  formErr.value = ''
  if (!form.account && meta.value.dir !== 'transfer') { formErr.value = '请选择账户'; return }
  if (meta.value.dir === 'transfer' && (!form.account || !form.to_account)) { formErr.value = '请选择调出与调入账户'; return }
  const account = meta.value.dir === 'transfer' ? `${form.account} → ${form.to_account}` : form.account
  const payload = {
    doc_type: docType.value,
    bill_date: form.bill_date,
    party_type: meta.value.partyType,
    party_name: form.party_name,
    account,
    amount: meta.value.itemMode ? itemSum.value : Number(form.amount || 0),
    remark: form.remark,
    items: meta.value.itemMode ? form.items.map(it => ({ ...it, amount: Number(it.amount || 0), qty: Number(it.qty || 0), cost: Number(it.cost || 0) })) : []
  }
  if (!meta.value.itemMode && !(payload.amount > 0)) { formErr.value = '金额必须大于 0'; return }
  if (meta.value.itemMode && !form.items.length) { formErr.value = `请至少添加一行${itemLabel.value}`; return }
  saving.value = true
  try {
    await fundsApi.createDoc(payload)
    showCreate.value = false
    await load()
  } catch (e) {
    formErr.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

/* —— 详情 / 过账 / 作废 —— */
const showDetail = ref(false)
const detail = ref({})
async function openDetail(d) {
  try {
    const r = await fundsApi.doc(d.id)
    detail.value = r || d
    showDetail.value = true
  } catch (e) {
    err.value = e.message || '加载详情失败'
  }
}
async function doPost(d) {
  if (!confirm(`确认过账「${d.doc_no}」？过账后资金余额将更新，且不可再编辑。`)) return
  try {
    await fundsApi.postDoc(d.id)
    await load()
  } catch (e) {
    err.value = e.message || '过账失败'
  }
}
async function doVoid(d) {
  if (!confirm(`确认作废「${d.doc_no}」？`)) return
  try {
    await fundsApi.voidDoc(d.id)
    await load()
  } catch (e) {
    err.value = e.message || '作废失败'
  }
}

onMounted(load)
</script>

<style scoped>
/* 私有类一律 fd- 前缀；全局件（.page/.page-hd/.card/.kpi-strip/.tbl/.tag/.state-*）不重定义。 */
.fd-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.fd-filter { margin: 14px 0 }
.fd-frow { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.fd-frow > label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--t2) }
.fd-grow { flex: 1; min-width: 160px }
.fd-frow .input { margin-top: 2px }
.fd-card { padding: 0; overflow: hidden }
.fd-op { white-space: nowrap; width: 1% }
.fd-items { margin-top: 12px }
.fd-items-hd { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; color: var(--t1); margin-bottom: 6px }
.fd-items-sum { text-align: right; font-size: 13px; color: var(--t1); margin-top: 6px; font-weight: 600 }
.fd-i { padding: 4px 6px; font-size: 13px }
.fd-full { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--t2); margin-top: 12px }
.fd-err { color: var(--danger-txt); font-size: 12px; margin-top: 8px }

/* 弹窗（页面私有 UI，fd- 前缀，不造全局第二份） */
.fd-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 1120; padding: 16px }
.fd-modal { background: var(--bg1, #fff); border-radius: 16px; width: min(560px, 100%); max-height: 88vh; display: flex; flex-direction: column; box-shadow: var(--shadow-lg) }
.fd-modal-hd { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--bd) }
.fd-modal-hd h3 { font-size: 15px; font-weight: 600; color: var(--t1) }
.fd-x { border: none; background: none; font-size: 16px; color: var(--t3); cursor: pointer }
.fd-modal-bd { padding: 14px 18px; overflow-y: auto }
.fd-modal-ft { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--bd) }
.fd-dl { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px }
.fd-dl > div { display: flex; gap: 8px; font-size: 13px; color: var(--t1); align-items: center }
.fd-dl span { color: var(--t2); min-width: 48px }
</style>
