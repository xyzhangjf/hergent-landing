<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>买赠活动管理</h2>
        <span class="page-sub">买赠 / 满赠 / 折扣等让利政策的建、改、删与启停（只老板 / 管理员可操作）</span>
      </div>
      <div class="pm-acts">
        <button class="btn btn-primary btn-sm" :disabled="loading" @click="openCreate()">
          <Icon name="plus" :size="14" />新建活动
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <template v-else>
      <!-- 列表 -->
      <div v-if="list.length" class="card pm-card">
        <div class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>活动名</th>
                <th>类型</th>
                <th>适用商品</th>
                <th>活动周期</th>
                <th>状态</th>
                <th class="pm-op">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in list" :key="p.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ p.name || '—' }}</td>
                <td>{{ typeLabel(p.promo_type) }}</td>
                <td class="pm-prods">
                  <span v-if="(p.product_ids || []).length">{{ prodNames(p.product_ids) }}</span>
                  <span v-else class="pm-muted">全部商品</span>
                </td>
                <td>{{ rangeText(p) }}</td>
                <td>
                  <span class="pm-badge" :class="p.is_active ? 'on' : 'off'">
                    {{ p.is_active ? '启用中' : '已停用' }}
                  </span>
                </td>
                <td class="pm-op">
                  <button class="btn-row-ic" title="编辑" @click="openEdit(p)"><Icon name="edit" :size="14" /></button>
                  <button class="btn-row-ic" :title="p.is_active ? '停用' : '启用'" @click="doToggle(p)">
                    <Icon :name="p.is_active ? 'pause' : 'play'" :size="14" />
                  </button>
                  <button class="btn-row-ic danger" title="删除" @click="doRemove(p)"><Icon name="trash" :size="14" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 诚实空态：没有 ≠ 是零 -->
      <div v-else class="pm-empty">
        <p class="pm-empty-note">还没有任何买赠 / 满赠 / 折扣活动。</p>
        <p class="pm-empty-guide">点右上角「新建活动」建立第一条让利政策；建好后，销售开单命中规则会自动套用，并在「促销 ROI 分析」里出现对比。</p>
      </div>
    </template>

    <!-- 新建 / 编辑弹窗 -->
    <div v-if="showForm" class="pm-mask" @click.self="closeForm()">
      <div class="pm-modal">
        <div class="pm-modal-hd">
          <span>{{ editing ? '编辑活动' : '新建活动' }}</span>
          <button class="btn-row-ic" @click="closeForm()"><Icon name="close" :size="16" /></button>
        </div>
        <div class="pm-modal-bd">
          <div v-if="formErr" class="state-error pm-form-err"><p>{{ formErr }}</p></div>

          <label class="pm-fld">
            <span class="pm-lab">活动名<span class="isn-req">*</span></span>
            <input v-model.trim="form.name" class="input" placeholder="如：整箱买二赠一" />
          </label>

          <div class="pm-row">
            <label class="pm-fld">
              <span class="pm-lab">开始日期<span class="isn-req">*</span></span>
              <input v-model="form.start_date" type="date" class="input" />
            </label>
            <label class="pm-fld">
              <span class="pm-lab">结束日期<span class="isn-req">*</span></span>
              <input v-model="form.end_date" type="date" class="input" />
            </label>
          </div>

          <label class="pm-fld">
            <span class="pm-lab">活动类型<span class="isn-req">*</span></span>
            <select v-model="form.promo_type" class="input" @change="onTypeChange()">
              <option value="buy_x_free_y">买 X 赠 Y（买赠）</option>
              <option value="gift">满赠（指定赠品）</option>
              <option value="discount">折扣优惠</option>
            </select>
          </label>

          <!-- 类型相关字段 -->
          <div v-if="form.promo_type === 'buy_x_free_y'" class="pm-row">
            <label class="pm-fld">
              <span class="pm-lab">买满数量（件）</span>
              <input v-model.number="form.buy_qty" type="number" min="1" class="input num" placeholder="如 2" />
            </label>
            <label class="pm-fld">
              <span class="pm-lab">赠送数量（件）</span>
              <input v-model.number="form.free_qty" type="number" min="1" class="input num" placeholder="如 1" />
            </label>
          </div>
          <div v-else-if="form.promo_type === 'gift'" class="pm-row">
            <label class="pm-fld">
              <span class="pm-lab">赠品商品名</span>
              <input v-model.trim="form.gift_product_name" class="input" placeholder="如：尝鲜装" />
            </label>
            <label class="pm-fld">
              <span class="pm-lab">赠送数量（件）</span>
              <input v-model.number="form.gift_qty" type="number" min="1" class="input num" placeholder="如 1" />
            </label>
          </div>
          <div v-else-if="form.promo_type === 'discount'" class="pm-row">
            <label class="pm-fld">
              <span class="pm-lab">折扣百分比（%）</span>
              <input v-model.number="form.discount_pct" type="number" min="0" max="100" class="input num" placeholder="如 10 表示减 10%" />
            </label>
            <label class="pm-fld">
              <span class="pm-lab">满额加赠（件，可选）</span>
              <input v-model.number="form.bonus_qty" type="number" min="0" class="input num" placeholder="0" />
            </label>
          </div>

          <label class="pm-fld">
            <span class="pm-lab">适用商品</span>
            <div class="pm-prod-box">
              <label class="pm-all"><input type="checkbox" v-model="allProducts" @change="onAllProducts()" /> 全部商品</label>
              <div v-if="!allProducts" class="pm-prod-list">
                <label v-for="pr in products" :key="pr.id" class="pm-prod-item">
                  <input type="checkbox" :value="pr.id" v-model="form.product_ids" /> {{ pr.name }}
                </label>
                <div v-if="!products.length" class="pm-muted">商品档案为空</div>
              </div>
            </div>
          </label>
        </div>
        <div class="pm-modal-ft">
          <button class="btn btn-ghost btn-sm" :disabled="saving" @click="closeForm()">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save()">
            <Icon name="save" :size="14" />{{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 买赠活动管理（市场营销 P2-1 二期，v537）—— 数据源：GET/POST/PUT/DELETE /api/promotions。
   🔴 这是**让利政策**的管理页：后端 4 个写端点（POST/PUT/DELETE/toggle）统一挂 `_admin`
      （role∈admin/boss），销售员不可自建 ⇒ 前端调用即被后端拦截（fail-closed），无需前端再判角色。
   🔴 与「促销 ROI 分析」(PromoRoi.vue) 是上下游：这里建的活动，销售开单命中后会在 ROI 页出现对比；
      本页只读列表 + 建改删启停，不重算任何口径（成本/对比全在后端）。
   🔴 生产买赠为主、活动 0 条 ⇒ 列表空是**诚实空态**，展示说明 + 引导，不编造活动。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { api } from '../../api/client.js'
import { promotionsApi } from '../../api/modules.js'

const loading = ref(true)
const err = ref('')
const list = ref([])
const products = ref([])

const showForm = ref(false)
const editing = ref(null)          // null = 新建；对象 = 编辑
const saving = ref(false)
const formErr = ref('')
const allProducts = ref(true)

const emptyForm = () => ({
  name: '', start_date: '', end_date: '', promo_type: 'buy_x_free_y',
  discount_pct: 0, bonus_qty: 0, buy_qty: 2, free_qty: 1,
  gift_product_name: '', gift_qty: 1, product_ids: []
})
const form = ref(emptyForm())

const TYPE_LABELS = { discount: '折扣优惠', buy_x_free_y: '买X赠Y', gift: '满赠（指定赠品）' }
function typeLabel (t) { return TYPE_LABELS[t] || (t || '—') }

function prodNames (ids) {
  if (!ids || !ids.length) return ''
  return ids.map(id => {
    const p = products.value.find(x => x.id === id)
    return p ? p.name : ('#' + id)
  }).join('、')
}

function rangeText (p) {
  const s = p.start_date || ''
  const e = p.end_date || ''
  if (s && e) return s + ' ~ ' + e
  return s || e || '—'
}

function onTypeChange () { formErr.value = '' }
function onAllProducts () {
  if (allProducts.value) form.value.product_ids = []
}

function openCreate () {
  editing.value = null
  form.value = emptyForm()
  allProducts.value = true
  formErr.value = ''
  showForm.value = true
}
function openEdit (p) {
  editing.value = p
  form.value = {
    name: p.name || '', start_date: p.start_date || '', end_date: p.end_date || '',
    promo_type: p.promo_type || 'buy_x_free_y',
    discount_pct: Number(p.discount_pct || 0), bonus_qty: Number(p.bonus_qty || 0),
    buy_qty: Number(p.buy_qty || 2), free_qty: Number(p.free_qty || 1),
    gift_product_name: p.gift_product_name || '', gift_qty: Number(p.gift_qty || 1),
    product_ids: Array.isArray(p.product_ids) ? p.product_ids.slice() : []
  }
  allProducts.value = !form.value.product_ids.length
  formErr.value = ''
  showForm.value = true
}
function closeForm () { showForm.value = false; editing.value = null }

function validate () {
  const f = form.value
  if (!f.name) return '请填写活动名'
  if (!f.start_date || !f.end_date) return '请选择开始与结束日期'
  if (f.start_date > f.end_date) return '结束日期不能早于开始日期'
  if (f.promo_type === 'buy_x_free_y' && (!f.buy_qty || !f.free_qty)) return '请填写买满数量与赠送数量'
  if (f.promo_type === 'gift' && (!f.gift_product_name || !f.gift_qty)) return '请填写赠品名称与数量'
  if (f.promo_type === 'discount' && (f.discount_pct == null)) return '请填写折扣百分比'
  return ''
}

function buildPayload () {
  const f = form.value
  return {
    name: f.name,
    start_date: f.start_date,
    end_date: f.end_date,
    promo_type: f.promo_type,
    discount_pct: f.promo_type === 'discount' ? Number(f.discount_pct || 0) : 0,
    bonus_qty: Number(f.bonus_qty || 0),
    buy_qty: f.promo_type === 'buy_x_free_y' ? Number(f.buy_qty || 0) : 0,
    free_qty: f.promo_type === 'buy_x_free_y' ? Number(f.free_qty || 0) : 0,
    gift_product_name: f.promo_type === 'gift' ? f.gift_product_name : '',
    gift_qty: f.promo_type === 'gift' ? Number(f.gift_qty || 0) : 0,
    product_ids: allProducts.value ? [] : (f.product_ids || [])
  }
}

async function save () {
  const v = validate()
  if (v) { formErr.value = v; return }
  saving.value = true
  formErr.value = ''
  try {
    const payload = buildPayload()
    if (editing.value) await promotionsApi.update(editing.value.id, payload)
    else await promotionsApi.create(payload)
    closeForm()
    await load()
  } catch (e) {
    formErr.value = (e && e.message) || '保存失败'
  } finally {
    saving.value = false
  }
}

async function doToggle (p) {
  try {
    await promotionsApi.toggle(p.id, !p.is_active)
    await load()
  } catch (e) {
    err.value = (e && e.message) || '启停失败'
  }
}

async function doRemove (p) {
  if (!confirm(`确定删除活动「${p.name || ''}」？已落库的销售归因不受影响。`)) return
  try {
    await promotionsApi.remove(p.id)
    await load()
  } catch (e) {
    err.value = (e && e.message) || '删除失败'
  }
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const data = await promotionsApi.list()
    list.value = Array.isArray(data) ? data : []
  } catch (e) {
    err.value = (e && e.message) || '买赠活动读取失败'
    list.value = []
  } finally {
    loading.value = false
  }
}

async function loadProducts () {
  try {
    const data = await api('/api/products?limit=1000')
    const arr = Array.isArray(data) ? data : (data && data.items) || []
    products.value = arr
  } catch (_) { products.value = [] }
}

onMounted(() => { load(); loadProducts() })
</script>

<style scoped>
/* 页面私有类一律 `pm-` 前缀；全局件（.page/.page-hd/.card/.table-wrap/.tbl/.num/.seq-th/
   .seq-cell/.state-empty/.state-error/.btn/.btn-sm/.btn-primary/.btn-ghost/.btn-row-ic/.input）
   一律复用，不重定义。 */
.pm-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.pm-card { margin-top: 14px }
.pm-prods { max-width: 220px }
.pm-muted { color: var(--t3); font-size: 12px }
.pm-op { white-space: nowrap; text-align: right }
.pm-badge { display: inline-block; padding: 1px 9px; border-radius: 9px; font-size: 12px; font-weight: 400 }
.pm-badge.on { background: var(--ok-green-bg); color: var(--ok) }
.pm-badge.off { background: var(--bg2); color: var(--t3) }
.pm-empty { padding: 28px 4px }
.pm-empty-note { font-size: 13px; color: var(--t2); margin: 0 }
.pm-empty-guide { font-size: 12px; color: var(--t1); margin: 8px 0 0; line-height: 1.8 }

/* 弹窗 */
.pm-mask { position: fixed; inset: 0; background: rgba(0,0,0,.38); display: flex; align-items: center; justify-content: center; z-index: 80 }
.pm-modal { width: 560px; max-width: 94vw; max-height: 90vh; overflow: auto; background: var(--bg); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.25) }
.pm-modal-hd { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--bd) }
.pm-modal-bd { padding: 16px; display: flex; flex-direction: column; gap: 12px }
.pm-modal-ft { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--bd) }
.pm-form-err { padding: 8px 10px }
.pm-fld { display: flex; flex-direction: column; gap: 5px }
.pm-lab { font-size: 12px; color: var(--t2) }
.pm-row { display: flex; gap: 12px }
.pm-row .pm-fld { flex: 1 }
.pm-prod-box { border: 1px solid var(--bd); border-radius: 8px; padding: 8px }
.pm-all { font-size: 12px; color: var(--t2); display: flex; align-items: center; gap: 6px }
.pm-prod-list { margin-top: 8px; max-height: 180px; overflow: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px }
.pm-prod-item { font-size: 12px; color: var(--t1); display: flex; align-items: center; gap: 6px }
</style>
