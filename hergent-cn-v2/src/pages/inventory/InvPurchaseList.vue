<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>{{ isReturn ? '采购退货单' : '采购单' }}</h2>
        <span class="page-sub">{{ isReturn ? '退给供应商的退货单据' : '向供应商进货的单据' }}</span>
      </div>
      <div class="ip-acts">
        <button v-if="canWrite" class="btn btn-primary btn-sm" @click="go(isReturn ? '/inventory/purchase/new?kind=return' : '/inventory/purchase/new')">
          <Icon name="plus" :size="14" />{{ isReturn ? '新建采购退货单' : '新建采购单' }}
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <div class="card ip-filter">
      <div class="ip-f">
        <label class="ip-lb">状态</label>
        <select v-model="f.status" class="input ip-sel" @change="load()">
          <option value="">全部状态</option>
          <option v-for="o in PO_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
        </select>
      </div>
      <div class="ip-f">
        <label class="ip-lb">供应商</label>
        <select v-model.number="f.supplier_id" class="input ip-sel" @change="load()">
          <option :value="0">全部供应商</option>
          <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div class="ip-f">
        <label class="ip-lb">下单起</label>
        <input type="date" v-model="f.date_from" class="input ip-date" @change="load()" />
      </div>
      <div class="ip-f">
        <label class="ip-lb">下单止</label>
        <input type="date" v-model="f.date_to" class="input ip-date" @change="load()" />
      </div>
      <button class="btn btn-primary btn-sm" @click="load()">查询</button>
      <button class="btn btn-ghost btn-sm" @click="resetFilter">重置</button>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <div v-else-if="!rows.length" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="inbox" :size="22" /></div>
        <p>{{ hasFilter ? '当前条件下没有采购单。' : '还没有采购单。' }}</p>
        <button v-if="canWrite" class="btn btn-primary btn-sm" style="margin-top:12px"
                @click="go('/inventory/purchase/new')">
          <Icon name="plus" :size="14" />新建采购单
        </button>
      </div>
    </div>

    <template v-else>
      <div class="card">
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>单号</th>
                <th>供应商</th>
                <th class="num">金额</th>
                <th>状态</th>
                <th>下单日期</th>
                <th>预计到货</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id" class="ip-row" @click="go('/inventory/purchase/' + r.id)">
                <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
                <td class="ip-no">{{ r.order_no || ('#' + r.id) }}</td>
                <td>{{ r.supplier_name || '—' }}</td>
                <td class="num">¥{{ fmtMoney(r.total_amount) }}</td>
                <td>
                  <span class="tag" :class="tagOf(PO_STATUS, r.status)">{{ textOf(PO_STATUS, r.status) }}</span>
                </td>
                <td>{{ (r.order_date || '').slice(0, 10) || '—' }}</td>
                <td>{{ r.expected_date || '—' }}</td>
                <td class="ip-op">查看</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="ip-page">
          <span class="ip-cnt">共 {{ total }} 张，第 {{ pageFrom }}–{{ pageTo }} 张</span>
          <button class="btn btn-ghost btn-sm" :disabled="offset <= 0 || loading" @click="prev">上一页</button>
          <button class="btn btn-ghost btn-sm" :disabled="offset + limit >= total || loading" @click="next">下一页</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 采购单列表 —— 数据源：`GET /api/psi/purchase-orders`。
   🔴 状态一律走 `psiLabels` 的中文映射，**不许出现 `received`/`draft` 这类英文值**
      （后端加新状态时，兜底也是中文「未知」，见 `textOf` 的默认参数）。 */
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { canDo } from '../../store'
import { PO_STATUS, textOf, tagOf, fmtMoney } from '../../constants/psiLabels'

const router = useRouter()
const route = useRoute()

/* 🔴 v395（2026-10-08）：侧栏「采购单 / 采购退货单」是**同一条 path、不同 query**，
   这里必须读 URL 预置筛选，否则点哪个进去都一样 ⇒ 入口就是假的。
   · `kind=return` → 状态=已退货（`PO_STATUS.returned`）；
   · `kind=order`  → 结果里**排除**已退货行（退货独立成单之前的唯一区分口径）。 */
const _qKind = String((route.query && route.query.kind) || '')
const _kindOrder = _qKind === 'order'
const isReturn = _qKind === 'return'

const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const suppliers = ref([])
const limit = 50
const offset = ref(0)

const f = ref({ status: isReturn ? 'returned' : '', supplier_id: 0, date_from: '', date_to: '' })

const canWrite = computed(() => canDo('inventory', 'create'))
const hasFilter = computed(() => !!(f.value.status || f.value.supplier_id || f.value.date_from || f.value.date_to))
const pageFrom = computed(() => (total.value ? offset.value + 1 : 0))
const pageTo = computed(() => Math.min(offset.value + limit, total.value))

/* 状态下拉 = 词表的全部档位（含「已入库 / 部分入库」），顺序按业务流：草稿 → 待审批 → 已确认 → 已入库 → 部分入库 → 已退货 → 已取消 */
const PO_OPTIONS = ['draft', 'pending_approval', 'confirmed', 'received', 'partial', 'returned', 'cancelled']
  .map(v => ({ value: v, text: textOf(PO_STATUS, v) }))

async function load (resetPage = true) {
  if (resetPage) offset.value = 0
  loading.value = true
  err.value = ''
  try {
    const [d, refs] = await Promise.all([
      psiApi.listPurchases({ ...f.value, limit, offset: offset.value }),
      suppliers.value.length ? Promise.resolve(null) : psiApi.refs('suppliers', '', 200),
    ])
    let list = d.orders || []
    /* 「采购单」入口要排除已退货行（见上方 URL 读取处的口径说明） */
    if (_kindOrder) list = list.filter(r => r.status !== 'returned')
    rows.value = list
    total.value = Number(d.total || 0)
    if (refs && Array.isArray(refs.suppliers)) suppliers.value = refs.suppliers
  } catch (e) {
    err.value = e.message || '采购单读取失败'
  } finally {
    loading.value = false
  }
}

function resetFilter () { f.value = { status: '', supplier_id: 0, date_from: '', date_to: '' }; load() }
function next () { offset.value += limit; load(false) }
function prev () { offset.value = Math.max(0, offset.value - limit); load(false) }
function go (p) { router.push(p) }
onMounted(load)
</script>

<style scoped>
.inv-page { display: block }
.ip-acts { display: flex; gap: 8px; flex-wrap: wrap }
.ip-filter { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
.ip-f { display: flex; flex-direction: column; gap: 4px }
.ip-lb { font-size: 12px; color: var(--t3) }
.ip-sel { min-width: 130px; height: 32px }
.ip-date { height: 32px }
.ip-row { cursor: pointer }
.ip-no { font-variant-numeric: tabular-nums }
.ip-op { color: var(--p-dark); white-space: nowrap }
.ip-page { display: flex; align-items: center; gap: 8px; justify-content: flex-end; padding-top: 12px; flex-wrap: wrap }
.ip-cnt { font-size: 12px; color: var(--t3); margin-right: auto }

@media (max-width: 640px) {
  .ip-filter { align-items: stretch }
  .ip-f, .ip-sel, .ip-date { width: 100%; min-width: 0 }
}
</style>
