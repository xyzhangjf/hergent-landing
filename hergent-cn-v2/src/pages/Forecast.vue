<template>
  <div class="page">
    <div class="page-hd">
      <h2>预报订货管理</h2>
      <span class="page-sub">报单汇总 · 智能审核大脑</span>
    </div>

    <!-- 报单期次选择 -->
    <div class="card toolbar">
      <div class="tb-left">
        <select v-model="curPeriod" class="input sel-period" @change="loadOrders">
          <option value="0">— 选择期次 —</option>
          <option v-for="p in periods" :key="p.id" :value="p.id">{{ p.name }}（{{ p.order_start }} ~ {{ p.order_end }}）</option>
        </select>
        <button class="btn btn-ghost" @click="showNewPeriod = !showNewPeriod">+ 新建期次</button>
      </div>
      <div class="tb-right">
        <button class="btn btn-primary" :disabled="!draft.length || auditing" @click="runAudit">
          {{ auditing ? '审核中…' : '智能审核' }}
        </button>
        <button class="btn btn-ghost" :disabled="!auditResults.length" @click="saveDraft">保存草稿</button>
      </div>
    </div>

    <!-- 新建期次表单 -->
    <div v-if="showNewPeriod" class="card new-period">
      <div class="np-row">
        <input v-model="np.name" class="input" placeholder="期次名称（如 8月第二批）">
        <input v-model="np.order_start" class="input" type="date" placeholder="下单开始">
        <input v-model="np.order_end" class="input" type="date" placeholder="下单截止">
        <input v-model="np.arrival" class="input" type="date" placeholder="预计到货">
        <button class="btn btn-primary" @click="createPeriod">创建</button>
      </div>
    </div>

    <!-- 商品搜索 + 草稿区 -->
    <div class="card draft-section">
      <div class="panel-hd"><b>报单草稿</b><span class="tag info">{{ draft.length }} 个商品</span></div>

      <div class="search-row">
        <input v-model="searchQ" class="input" placeholder="搜索商品名称/规格/拼音首字母…" @input="onSearch">
        <button class="btn btn-ghost" @click="searchQ=''; searchResults=[]">清空</button>
      </div>

      <!-- 搜索结果下拉 -->
      <div v-if="searchResults.length" class="search-dropdown">
        <div v-for="p in searchResults" :key="p.id" class="sd-item" @click="addToDraft(p)">
          <div class="sd-name">{{ p.name }} <span class="sd-spec">{{ p.spec || '' }}</span></div>
          <div class="sd-meta">库存 {{ p.current_stock ?? '—' }}{{ p.unit || '' }} · 日均 {{ p.avg_daily_sales ?? '—' }}{{ p.unit || '' }}/天</div>
        </div>
      </div>

      <!-- 草稿表格 -->
      <div v-if="draft.length" class="table-wrap" style="margin-top:12px">
        <table class="tbl">
          <thead>
            <tr>
              <th>商品</th><th>规格</th><th>单位</th>
              <th class="num">预报数量</th>
              <th class="num">当前库存</th>
              <th class="num">日均销量</th>
              <th class="num">可销天数</th>
              <th class="num">建议下单量</th>
              <th>审核判定</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(d,i) in draft" :key="d.product_id">
              <td>{{ d.name }}</td>
              <td>{{ d.spec || '—' }}</td>
              <td>{{ d.unit || '—' }}</td>
              <td class="num"><input v-model.number="d.requested_qty" class="qty-input" type="number" min="0"></td>
              <td class="num">{{ d.current_stock ?? '—' }}</td>
              <td class="num">{{ d.avg_daily_sales ?? '—' }}</td>
              <td class="num">
                <span v-if="d.days_of_cover != null" class="cover-days" :class="coverClass(d.days_of_cover)">{{ d.days_of_cover }} 天</span>
                <span v-else>—</span>
              </td>
              <td class="num">
                <span class="sug-cell">
                  <b v-if="d.suggested_qty != null" :class="suggestedClass(d)">{{ d.suggested_qty }}</b>
                  <span v-else>—</span>
                  <span v-if="d.suggested_qty != null && d.avg_daily_sales" class="why">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    <span class="why-tip">
                      <div class="why-formula">日均销 {{ d.avg_daily_sales }} 件 × 覆盖 {{ d.coverage_days }} 天</div>
                      <div class="why-formula">+ 安全库存 {{ d.safety_stock }} 件 = 需求 {{ d.required_stock }} 件</div>
                      <div class="why-formula">− 当前库存 {{ d.current_stock }} 件</div>
                      <div class="why-result">= 建议补货 {{ d.suggested_qty }} 件</div>
                    </span>
                  </span>
                </span>
              </td>
              <td><span v-if="d.verdict" class="tag" :class="verdictTag(d.verdict)">{{ d.verdict }}</span></td>
              <td><button class="btn-del" @click="draft.splice(i,1)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="state-empty">
        <div class="se-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 4-5"/></svg></div>
        <p>搜索商品并添加到草稿，然后点击「智能审核」</p>
      </div>
    </div>

    <!-- 返利达成汇总 -->
    <div class="card rebate-section" style="margin-top:14px" v-if="rebateSummary.length">
      <div class="panel-hd"><b>厂家返利达成</b><span class="tag info">{{ rebateSummary.length }} 个合同</span></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr><th>合同ID</th><th>供应商</th><th>年度</th><th class="num">目标额</th><th class="num">已采额</th><th class="num">达成率</th><th>返利比例</th><th>进度</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rebateSummary" :key="r.contract_id">
              <td>#{{ r.contract_id }}</td>
              <td>{{ r.contact_name || '供应商#' + r.contact_id }}</td>
              <td>{{ r.year }}</td>
              <td class="num">¥{{ fmt(r.target_amount) }}</td>
              <td class="num">¥{{ fmt(r.bought_amount) }}</td>
              <td class="num"><b :class="achClass(r.achievement)">{{ r.achievement != null ? Math.round(r.achievement * 100) + '%' : '—' }}</b></td>
              <td>{{ r.rebate_pct ? (r.rebate_pct * 100).toFixed(1) + '%' : '—' }}</td>
              <td style="min-width:100px">
                <div class="progress" :class="achProgressClass(r.achievement)">
                  <i :style="{width: Math.min(100, (r.achievement || 0) * 100) + '%'}"></i>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { store, toast } from '../store'
import { forecastApi, auditApi } from '../api/modules'

const periods = ref([])
const curPeriod = ref(0)
const showNewPeriod = ref(false)
const np = ref({ name: '', order_start: '', order_end: '', arrival: '' })

const searchQ = ref('')
const searchResults = ref([])
const draft = ref([])
const auditing = ref(false)
const auditResults = ref([])
const rebateSummary = ref([])

let searchTimer = null

function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(doSearch, 300)
}

async function doSearch() {
  const q = searchQ.value.trim()
  if (!q) { searchResults.value = []; return }
  try {
    const data = await auditApi.searchProducts(q)
    searchResults.value = data.products || data.data || data || []
  } catch (e) { /* 静默 */ }
}

function addToDraft(p) {
  if (draft.value.find(d => d.product_id === p.id)) {
    toast('已在草稿中', 'info')
    return
  }
  draft.value.push({
    product_id: p.id,
    name: p.name,
    spec: p.spec,
    unit: p.unit,
    requested_qty: 1,
    current_stock: p.current_stock ?? null,
    avg_daily_sales: p.avg_daily_sales ?? null,
    suggested_qty: null,
    verdict: '',
  })
  searchQ.value = ''
  searchResults.value = []
}

async function runAudit() {
  if (!draft.value.length) return
  auditing.value = true
  try {
    const items = draft.value.map(d => ({ product_id: d.product_id, requested_qty: d.requested_qty }))
    const res = await auditApi.compute(items)
    const results = res.data || res.results || res || []
    auditResults.value = results
    // 合并结果回草稿
    for (const r of results) {
      const d = draft.value.find(x => x.product_id === r.product_id)
      if (d) {
        d.suggested_qty = r.suggested_qty
        d.verdict = r.verdict
        d.current_stock = r.current_stock
        d.avg_daily_sales = r.avg_daily_sales
        d.days_of_cover = r.days_of_cover
        d.safety_stock = r.safety_stock
        d.lead_time_days = r.lead_time_days
        d.coverage_days = r.coverage_days
        d.required_stock = r.required_stock
      }
    }
    toast('智能审核完成', 'success')
  } catch (e) {
    toast('审核失败: ' + (e.message || ''), 'error')
  } finally {
    auditing.value = false
  }
}

async function saveDraft() {
  try {
    const items = draft.value.map(d => ({ product_id: d.product_id, requested_qty: d.requested_qty }))
    await auditApi.save({ submitter_name: store.user.name || '系统', items })
    toast('草稿已保存', 'success')
  } catch (e) {
    toast('保存失败: ' + (e.message || ''), 'error')
  }
}

async function createPeriod() {
  const b = np.value
  if (!b.name || !b.order_start || !b.order_end || !b.arrival) {
    toast('请填写完整期次信息', 'error')
    return
  }
  try {
    await forecastApi.createPeriod(b)
    toast('期次已创建', 'success')
    showNewPeriod.value = false
    np.value = { name: '', order_start: '', order_end: '', arrival: '' }
    await loadPeriods()
  } catch (e) {
    toast('创建失败: ' + (e.message || ''), 'error')
  }
}

async function loadPeriods() {
  try {
    const d = await forecastApi.periods()
    periods.value = d.periods || []
    if (d.current) curPeriod.value = d.current.id || 0
  } catch (e) { /* 静默 */ }
}

async function loadOrders() {
  if (!curPeriod.value) return
  try {
    const d = await forecastApi.periodOrders(curPeriod.value)
    const orders = d.orders || d || []
    // 把已有报单填入草稿
    draft.value = orders.map(o => ({
      product_id: o.product_id,
      name: o.product_name,
      spec: '',
      unit: o.unit || '',
      requested_qty: o.quantity || 0,
      current_stock: null,
      avg_daily_sales: null,
      suggested_qty: null,
      verdict: '',
    }))
  } catch (e) { /* 静默 */ }
}

async function loadRebate() {
  try {
    const d = await auditApi.rebateSummary()
    rebateSummary.value = d.data || d || []
  } catch (e) { /* 静默 */ }
}

function suggestedClass(d) {
  if (d.suggested_qty == null) return ''
  if (d.requested_qty > d.suggested_qty * 1.2) return 'val-warn'
  if (d.requested_qty < d.suggested_qty * 0.8 && d.suggested_qty > 0) return 'val-bad'
  return 'val-ok'
}
function verdictTag(v) {
  if (v.includes('积压') || v.includes('高于')) return 'warn'
  if (v.includes('缺货') || v.includes('低于')) return 'bad'
  if (v.includes('吻合')) return 'ok'
  return 'info'
}
function coverClass(days) {
  if (days == null) return ''
  if (days < 3) return 'cover-danger'
  if (days < 7) return 'cover-warn'
  return 'cover-ok'
}
function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function achClass(ach) {
  if (ach == null) return ''
  if (ach >= 1) return 'val-ok'
  if (ach >= 0.8) return ''
  return 'val-bad'
}
function achProgressClass(ach) {
  if (ach == null) return ''
  if (ach >= 1) return 'green'
  if (ach < 0.7) return 'amber'
  return ''
}

onMounted(() => {
  loadPeriods()
  loadRebate()
})
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.toolbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;margin-bottom:14px;flex-wrap:wrap;gap:10px}
.tb-left,.tb-right{display:flex;align-items:center;gap:8px}
.sel-period{width:260px}
.new-period{padding:16px;margin-bottom:14px}
.np-row{display:flex;gap:10px;flex-wrap:wrap}
.np-row .input{flex:1;min-width:140px}
.draft-section{padding:16px}
.search-row{display:flex;gap:8px;position:relative}
.search-dropdown{position:absolute;top:42px;left:0;right:60px;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-md);max-height:280px;overflow-y:auto;z-index:100}
.sd-item{padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-subtle)}
.sd-item:hover{background:var(--bg2)}
.sd-name{font-size:13px;font-weight:500}
.sd-spec{font-size:12px;color:var(--t3);margin-left:6px}
.sd-meta{font-size:12px;color:var(--t3);margin-top:2px}
.qty-input{width:72px;height:30px;padding:0 6px;border:1px solid var(--bd);border-radius:6px;text-align:right;background:var(--bg3);color:var(--t1)}
.btn-del{border:none;background:none;color:var(--t3);font-size:14px;cursor:pointer;padding:4px 8px;border-radius:6px}
.btn-del:hover{background:rgba(var(--dan-rgb),.1);color:var(--dan)}
.rebate-section{padding:16px}
.val-ok{color:var(--suc)}
.val-warn{color:var(--war)}
.val-bad{color:var(--dan)}

/* 可销天数 */
.cover-days{font-weight:500;font-variant-numeric:tabular-nums}
.cover-danger{color:var(--dan)}
.cover-warn{color:var(--war)}
.cover-ok{color:var(--t2)}

/* 建议量「为什么」 */
.sug-cell{display:inline-flex;align-items:center;gap:4px;position:relative}
.why{display:inline-flex;align-items:center;color:var(--t3);cursor:help}
.why:hover{color:var(--p-dark)}
.why-tip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);width:230px;background:var(--bg);border:1px solid var(--bd);border-radius:10px;box-shadow:var(--shadow-md);padding:11px 13px;z-index:60;font-size:12px;color:var(--t2);line-height:1.8;text-align:left;white-space:nowrap}
.why:hover .why-tip{display:block}
.why-formula{white-space:nowrap}
.why-result{color:var(--p-dark);font-weight:500;margin-top:3px;padding-top:3px;border-top:1px solid var(--border-subtle)}

@media(max-width:768px){
  .toolbar{flex-direction:column;align-items:stretch}
  .sel-period{width:100%}
  .search-dropdown{right:0}
}
</style>
