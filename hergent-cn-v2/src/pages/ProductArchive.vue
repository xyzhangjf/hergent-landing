<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>商品档案</h2>
        <span class="page-sub">浏览与轻量维护商品主档 · 点品牌格行内改（自动归一）· 售价/进价/安全库存只读</span>
      </div>
      <div class="pa-actions">
        <span class="pa-stat" v-if="total !== null"><b>{{ total }}</b>&nbsp;个商品</span>
        <button class="btn btn-primary btn-sm" @click="openAdd">+ 新增</button>
        <button class="btn btn-ghost btn-sm" @click="openImport">导入</button>
        <button class="btn btn-ghost btn-sm" @click="exportXlsx">导出</button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="card pa-panel">
      <div class="pa-filters">
        <div class="pa-search">
          <svg class="pa-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input v-model="keyword" class="input pa-kw" placeholder="商品名称 / 条码 / 规格 / 编码" @input="onFilterChange">
        </div>
        <select v-model="brandFilter" class="input" @change="onFilterChange">
          <option value="">全部品牌</option>
          <option v-for="b in brandOptions" :key="b" :value="b">{{ b }}</option>
        </select>
        <select v-model="categoryFilter" class="input" @change="onFilterChange">
          <option value="">全部分类</option>
          <option v-for="c in categoryOptions" :key="c" :value="c">{{ c }}</option>
        </select>
        <label class="pa-check"><input type="checkbox" v-model="includeInactive" @change="onFilterChange"> 含停用</label>
        <button class="btn btn-ghost btn-sm" @click="resetFilters">重置</button>
      </div>

      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="products.length" class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>名称</th><th>条码</th><th>规格</th><th>单位</th>
            <th>品牌</th><th class="num">标准售价</th><th class="num">进价</th><th class="num">安全库存</th><th>状态</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="p in products" :key="p.id" :class="{ stopped: p.is_active === 0 }">
              <td class="pa-name">{{ p.name }}</td>
              <td class="pa-mono">{{ p.barcode || '—' }}</td>
              <td>{{ p.spec || '—' }}</td>
              <td>{{ p.unit || '—' }}</td>
              <td class="pa-brand-cell">
                <input v-if="editingId === p.id" v-model="editBrand" class="input pa-brand-input" list="pa-brand-list"
                       @keyup.enter="saveBrand(p)" @blur="saveBrand(p)">
                <span v-else class="pa-brand" @click="startEditBrand(p)">{{ p.brand || '—' }}</span>
              </td>
              <td class="num">{{ money(p.sale_price) }}</td>
              <td class="num">{{ money(p.purchase_price) }}</td>
              <td class="num">{{ p.safety_stock != null ? p.safety_stock : '—' }}</td>
              <td>
                <span class="pa-status" :class="p.is_active === 0 ? 'off' : 'on'">{{ p.is_active === 0 ? '停用' : '启用' }}</span>
              </td>
              <td class="pa-ops"><button class="btn btn-ghost btn-sm" @click="openDetail(p)">详情</button></td>
            </tr>
          </tbody>
        </table>

        <!-- 分页 -->
        <div class="pa-pager" v-if="total > pageSize">
          <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <span class="pa-pageinfo">第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
          <button class="btn btn-ghost btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
          <select v-model="pageSize" class="input pa-size" @change="onPageSizeChange">
            <option :value="20">20 / 页</option>
            <option :value="50">50 / 页</option>
            <option :value="100">100 / 页</option>
          </select>
        </div>
      </div>
      <div v-else class="state-empty">没有匹配的商品，调整筛选条件试试</div>
    </div>

    <!-- 只读详情弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="detailOpen" class="pa-overlay" @click="detailOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="detailOpen" class="pa-modal">
          <div class="pa-modal-hd"><b>商品详情 · {{ detailTarget?.name }}</b><button class="pa-x" @click="detailOpen = false"><Icon name="close"/></button></div>
          <div class="pa-modal-body">
            <div class="pa-detail-grid">
              <div class="pa-detail-item"><span>名称</span><b>{{ detailTarget?.name }}</b></div>
              <div class="pa-detail-item"><span>条码</span><b>{{ detailTarget?.barcode || '—' }}</b></div>
              <div class="pa-detail-item"><span>规格</span><b>{{ detailTarget?.spec || '—' }}</b></div>
              <div class="pa-detail-item"><span>单位</span><b>{{ detailTarget?.unit || '—' }}</b></div>
              <div class="pa-detail-item"><span>品牌</span><b>{{ detailTarget?.brand || '—' }}</b></div>
              <div class="pa-detail-item"><span>分类</span><b>{{ detailTarget?.category || '—' }}</b></div>
              <div class="pa-detail-item"><span>标准售价</span><b>{{ money(detailTarget?.sale_price) }}</b></div>
              <div class="pa-detail-item"><span>进价</span><b>{{ money(detailTarget?.purchase_price) }}</b></div>
              <div class="pa-detail-item"><span>分销价</span><b>{{ money(detailTarget?.dist_price) }}</b></div>
              <div class="pa-detail-item"><span>安全库存</span><b>{{ detailTarget?.safety_stock != null ? detailTarget.safety_stock : '—' }}</b></div>
              <div class="pa-detail-item"><span>保质期(天)</span><b>{{ detailTarget?.expiry_days != null ? detailTarget.expiry_days : '—' }}</b></div>
              <div class="pa-detail-item"><span>厂家编码</span><b>{{ detailTarget?.product_code || '—' }}</b></div>
              <div class="pa-detail-item pa-full"><span>别名</span><b>{{ detailTarget?.alias || '—' }}</b></div>
              <div class="pa-detail-item pa-full"><span>状态</span><b>{{ detailTarget?.is_active === 0 ? '已停用' : '启用' }}</b></div>
            </div>
          </div>
          <div class="pa-modal-ft">
            <button class="btn btn-primary" @click="detailOpen = false">知道了</button>
          </div>
        </div>
      </Transition>

      <!-- 新增商品弹窗 -->
      <Transition name="fade"><div v-if="addOpen" class="pa-overlay" @click="addOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="addOpen" class="pa-modal">
          <div class="pa-modal-hd"><b>新增商品</b><button class="pa-x" @click="addOpen = false"><Icon name="close"/></button></div>
          <div class="pa-modal-body">
            <p class="pa-tip">名称重复将更新已有商品（其余字段按填写覆盖）。品牌自动归一，未匹配品牌进入待审。</p>
            <div class="pa-form">
              <label class="pa-f"><span>商品名称 <i>*</i></span><input v-model="addForm.name" class="input" placeholder="必填"></label>
              <label class="pa-f"><span>条码</span><input v-model="addForm.barcode" class="input" placeholder="唯一编码，留空按名称匹配"></label>
              <label class="pa-f"><span>规格</span><input v-model="addForm.spec" class="input" placeholder="如 200g×12"></label>
              <label class="pa-f"><span>单位</span><input v-model="addForm.unit" class="input" placeholder="件（默认）"></label>
              <label class="pa-f"><span>品牌</span><input v-model="addForm.brand" class="input" list="pa-brand-list" placeholder="可手填或选已有"></label>
              <label class="pa-f"><span>分类</span><input v-model="addForm.category" class="input" placeholder="如 液态奶"></label>
              <label class="pa-f"><span>进价</span><input v-model="addForm.purchase_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>
              <label class="pa-f"><span>售价</span><input v-model="addForm.sale_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>
              <label class="pa-f"><span>安全库存</span><input v-model="addForm.safety_stock" class="input" type="number" min="0" step="1" placeholder="0"></label>
              <label class="pa-f"><span>保质期(天)</span><input v-model="addForm.expiry_days" class="input" type="number" min="0" step="1" placeholder="0"></label>
            </div>
          </div>
          <div class="pa-modal-ft">
            <button class="btn btn-ghost" @click="addOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="addSaving" @click="saveAdd">{{ addSaving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>

      <!-- 导入弹窗 -->
      <Transition name="fade"><div v-if="impOpen" class="pa-overlay" @click="impOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="impOpen" class="pa-modal">
          <div class="pa-modal-hd"><b>导入商品（Excel）</b><button class="pa-x" @click="impOpen = false"><Icon name="close"/></button></div>
          <div class="pa-modal-body">
            <p class="pa-tip">下载模板 → 按列填写 → 选择文件自动识别列并导入。重复名称/条码将更新而非新增。</p>
            <div class="pa-imp-row">
              <button class="btn btn-ghost" @click="downloadTpl">下载模板</button>
              <label class="btn btn-ghost pa-file-btn">
                选择文件
                <input type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onImpFile">
              </label>
              <span v-if="impFileName" class="pa-fname">{{ impFileName }}</span>
              <button class="btn btn-primary" :disabled="!impFile || impSaving" @click="runImport">{{ impSaving ? '导入中…' : '开始导入' }}</button>
            </div>
            <div v-if="impResult" class="pa-imp-result" :class="impResult.results?.errors?.length ? 'warn' : 'ok'">
              成功 {{ impResult.results?.success }} 条 · 跳过 {{ impResult.results?.skipped }} 条 · 失败 {{ impResult.results?.errors?.length || 0 }} 条
              <span v-if="impResult.results?.errors?.length" class="pa-errs">
                <span v-for="(er, i) in impResult.results.errors.slice(0, 4)" :key="i" class="pa-err">第{{ er.row }}行: {{ er.msg }}</span>
              </span>
            </div>
          </div>
          <div class="pa-modal-ft">
            <button class="btn btn-primary" @click="impOpen = false">关闭</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 共享品牌候选 datalist：仅一份，避免每行重复渲染造成 DOM 爆炸（沿用 Forecast 修复范式） -->
    <datalist id="pa-brand-list">
      <option v-for="b in brandOptions" :key="b" :value="b"></option>
    </datalist>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/client'
import { productsApi, importApi } from '../api/modules'
import * as XLSX from 'xlsx'
import { toast } from '../store'

const loading = ref(false)
const products = ref([])
const total = ref(null)
const page = ref(1)
const pageSize = ref(50)
const keyword = ref('')
const brandFilter = ref('')
const categoryFilter = ref('')
const includeInactive = ref(false)
const brandOptions = ref([])
const categoryOptions = ref([])

const totalPages = computed(() => Math.max(1, Math.ceil((total.value || 0) / pageSize.value)))

const editingId = ref(null)
const editBrand = ref('')
const detailOpen = ref(false)
const detailTarget = ref(null)

// 新增弹窗
const addOpen = ref(false)
const addSaving = ref(false)
const addForm = ref({ name: '', barcode: '', spec: '', unit: '', brand: '', category: '', purchase_price: '', sale_price: '', safety_stock: '', expiry_days: '' })

// 导入弹窗
const impOpen = ref(false)
const impFile = ref(null)
const impFileName = ref('')
const impResult = ref(null)
const impSaving = ref(false)

async function loadProducts() {
  loading.value = true
  try {
    const q = []
    if (keyword.value) q.push('keyword=' + encodeURIComponent(keyword.value))
    if (brandFilter.value) q.push('brand=' + encodeURIComponent(brandFilter.value))
    if (categoryFilter.value) q.push('category=' + encodeURIComponent(categoryFilter.value))
    if (includeInactive.value) q.push('include_inactive=1')
    q.push('limit=' + pageSize.value)
    q.push('offset=' + ((page.value - 1) * pageSize.value))
    const d = await api('/api/products?' + q.join('&'))
    products.value = d.items || []
    total.value = d.total || 0
  } catch (e) { toast(e.message || '加载商品失败', 'err') }
  finally { loading.value = false }
}

async function loadBrandOptions() {
  try {
    const d = await api('/api/brands?include_inactive=1')
    brandOptions.value = (Array.isArray(d) ? d : []).map(b => b.name).filter(Boolean)
  } catch (e) { /* 品牌候选为增强项，失败不影响主流程 */ }
}

async function loadCategoryOptions() {
  try {
    // 一次性枚举全量商品分类用于筛选下拉（428 行可接受）
    const d = await api('/api/products?include_inactive=1&limit=5000')
    const set = new Set()
    for (const p of (d.items || [])) if (p.category) set.add(p.category)
    categoryOptions.value = [...set].sort()
  } catch (e) { /* 分类候选为增强项，失败不影响主流程 */ }
}

function onFilterChange() { page.value = 1; loadProducts() }
function onPageSizeChange() { page.value = 1; loadProducts() }
function goPage(p) { if (p < 1 || p > totalPages.value) return; page.value = p; loadProducts() }
function resetFilters() {
  keyword.value = ''; brandFilter.value = ''; categoryFilter.value = ''; includeInactive.value = false
  page.value = 1; loadProducts()
}

function money(n) {
  if (n == null || n === '') return '—'
  const v = Number(n)
  if (isNaN(v)) return '—'
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function startEditBrand(p) { editingId.value = p.id; editBrand.value = p.brand || '' }
async function saveBrand(p) {
  if (editingId.value !== p.id) return  // 已保存过（如 Enter + blur 重复触发）
  editingId.value = null
  const raw = (editBrand.value || '').trim()
  if (raw === (p.brand || '')) return  // 无变化
  try {
    await api('/api/products/' + p.id, { method: 'PUT', body: { brand: raw } })
    p.brand = raw
    toast('品牌已更新（已自动归一）', 'ok')
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

function openDetail(p) { detailTarget.value = p; detailOpen.value = true }

/* ---- 新增商品 ---- */
function openAdd() {
  addForm.value = { name: '', barcode: '', spec: '', unit: '', brand: '', category: '', purchase_price: '', sale_price: '', safety_stock: '', expiry_days: '' }
  addSaving.value = false
  addOpen.value = true
}
function _num(v, d = 0) { const n = Number(v); return isNaN(n) ? d : n }
async function saveAdd() {
  const f = addForm.value
  if (!f.name.trim()) { toast('请填写商品名称', 'err'); return }
  addSaving.value = true
  try {
    const row = {
      name: f.name.trim(),
      barcode: f.barcode.trim(),
      spec: f.spec.trim(),
      unit: f.unit.trim() || '件',
      brand: f.brand.trim(),
      category: f.category.trim(), // 显式提供（含空），后端仅当提供时更新
      purchase_price: _num(f.purchase_price),
      sale_price: _num(f.sale_price),
      safety_stock: _num(f.safety_stock),
      expiry_days: _num(f.expiry_days),
    }
    const r = await productsApi.bulkUpsert([row])
    toast(`已保存（新增 ${r.inserted || 0} / 更新 ${r.updated || 0}）`, 'ok')
    addOpen.value = false
    loadProducts()
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { addSaving.value = false }
}

/* ---- 导入商品 ---- */
function openImport() { impFile.value = null; impFileName.value = ''; impResult.value = null; impSaving.value = false; impOpen.value = true }
function onImpFile(ev) {
  const f = ev.target.files[0] || null
  if (f && !/\.(xlsx|xls|csv)$/i.test(f.name)) { toast('仅支持 Excel/CSV 文件', 'err'); ev.target.value = ''; return }
  impFile.value = f; impFileName.value = f?.name || ''; impResult.value = null
}
async function downloadTpl() {
  try {
    const blob = await importApi.templateFile('products')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '商品导入模板.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}
async function runImport() {
  if (!impFile.value) return
  impSaving.value = true
  try {
    const prev = await importApi.preview(impFile.value, 'products')
    const mapping = {}
    for (const s of (prev.suggestions || [])) if (s.suggested_field) mapping[s.index] = s.suggested_field
    const r = await importApi.execute(impFile.value, 'products', mapping)
    impResult.value = r
    toast(`导入完成：成功 ${r.results?.success || 0} 条`, r.results?.errors?.length ? 'warn' : 'ok')
    loadProducts()
  } catch (e) { toast(e.message || '导入失败', 'err') }
  finally { impSaving.value = false }
}

/* ---- 导出商品（当前筛选） ---- */
async function exportXlsx() {
  try {
    const q = []
    if (keyword.value) q.push('keyword=' + encodeURIComponent(keyword.value))
    if (brandFilter.value) q.push('brand=' + encodeURIComponent(brandFilter.value))
    if (categoryFilter.value) q.push('category=' + encodeURIComponent(categoryFilter.value))
    if (includeInactive.value) q.push('include_inactive=1')
    q.push('limit=5000'); q.push('offset=0')
    const d = await api('/api/products?' + q.join('&'))
    const items = d.items || []
    const rows = items.map(p => ({
      '商品名称': p.name, '条码': p.barcode || '', '规格': p.spec || '', '单位': p.unit || '',
      '品牌': p.brand || '', '分类': p.category || '',
      '标准售价': p.sale_price || 0, '进价': p.purchase_price || 0,
      '安全库存': p.safety_stock != null ? p.safety_stock : '', '保质期(天)': p.expiry_days != null ? p.expiry_days : '',
      '状态': p.is_active === 0 ? '停用' : '启用',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '商品档案')
    XLSX.writeFile(wb, `商品档案_${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast(`已导出 ${rows.length} 条`, 'ok')
  } catch (e) { toast(e.message || '导出失败', 'err') }
}

onMounted(() => {
  loadProducts()
  loadBrandOptions()
  loadCategoryOptions()
})
</script>

<style scoped>
.page-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.pa-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.pa-stat{font-size:13px;color:var(--t2);flex-shrink:0}
.pa-stat b{color:var(--p);font-size:16px}

.pa-panel{padding:18px;margin-bottom:14px}
.pa-filters{display:flex;gap:10px;flex-wrap:nowrap;align-items:center;overflow-x:auto;padding-bottom:2px}
.pa-search{position:relative;display:flex;align-items:center;flex:0 1 260px;min-width:170px;max-width:300px}
.pa-search-ico{position:absolute;left:10px;width:15px;height:15px;color:var(--t3);pointer-events:none}
.pa-kw{width:100%;padding-left:32px}
.pa-filters select{flex:0 0 140px;width:140px}
.pa-filters .pa-check,.pa-filters .btn{flex:0 0 auto}

.tbl tbody tr.stopped td{color:var(--t3);background:var(--bg2)}
.pa-name{font-weight:600;color:var(--t1)}
.pa-mono{font-size:12px;color:var(--t3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pa-brand{display:inline-block;min-width:48px;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t1);cursor:pointer;transition:.15s}
.pa-brand:hover{background:rgba(var(--p-rgb,6,182,212),.14);color:var(--p)}
.pa-brand-input{height:30px;min-width:120px}
.pa-status{font-size:12px;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t3)}
.pa-status.on{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.pa-status.off{background:rgba(var(--t3-rgb,156,163,175),.14);color:var(--t3)}
.pa-ops{white-space:nowrap}
.pa-ops .btn{margin-left:6px}

.pa-pager{display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}
.pa-pageinfo{font-size:12.5px;color:var(--t2)}
.pa-size{height:30px;width:auto}

/* 弹窗 */
.pa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:980}
.pa-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(520px,92vw);background:var(--bg);border-radius:16px;z-index:990;box-shadow:0 16px 48px rgba(0,0,0,.18)}
.pa-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.pa-modal-hd b{font-size:15px;color:var(--t1)}
.pa-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.pa-modal-body{padding:18px 20px}
.pa-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
.pa-tip{font-size:12px;color:var(--t2);line-height:1.7;margin:0 0 14px;background:var(--bg2);padding:8px 12px;border-radius:8px}

/* 详情网格 */
.pa-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}
.pa-detail-item{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--t3)}
.pa-detail-item b{font-size:14px;color:var(--t1);font-weight:600;word-break:break-all}
.pa-detail-item.pa-full{grid-column:1 / -1}

/* 新增表单 */
.pa-form{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.pa-f{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--t2)}
.pa-f i{color:var(--dan);font-style:normal}
.pa-f .input{height:34px}

/* 导入 */
.pa-imp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pa-file-btn{position:relative;overflow:hidden}
.pa-fname{font-size:12.5px;color:var(--t2)}
.pa-imp-result{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px;background:rgba(var(--suc-rgb),.1);color:var(--suc)}
.pa-imp-result.warn{background:rgba(var(--war-rgb),.12);color:var(--war)}
.pa-errs{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.pa-err{font-size:12px;color:var(--t2)}

.state-empty{font-size:13px;color:var(--t3);text-align:center;padding:22px 0}
</style>
