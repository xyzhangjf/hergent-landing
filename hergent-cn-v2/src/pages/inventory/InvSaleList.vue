<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>{{ title }}</h2>
        <span class="page-sub">{{ subTitle }}</span>
      </div>
      <div class="is-acts">
        <button v-if="canWrite" class="btn btn-primary btn-sm" @click="go(newTo)">
          <Icon name="plus" :size="14" />新建{{ title }}
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <div class="card isl-filter">
      <div class="isl-f">
        <label class="isl-lb">状态</label>
        <select v-model="f.status" class="input isl-sel" @change="load()">
          <option value="">全部状态</option>
          <option v-for="o in SO_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
        </select>
      </div>
      <div class="isl-f">
        <label class="isl-lb">出货方式</label>
        <select v-model="f.order_type" class="input isl-sel" @change="load()">
          <option v-for="o in ORDER_TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
        </select>
      </div>
      <div class="isl-f">
        <label class="isl-lb">客户</label>
        <select v-model.number="f.customer_id" class="input isl-sel" @change="load()">
          <option :value="0">全部客户</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <div class="isl-f">
        <label class="isl-lb">下单起</label>
        <input type="date" v-model="f.date_from" class="input isl-date" @change="load()" />
      </div>
      <div class="isl-f">
        <label class="isl-lb">下单止</label>
        <input type="date" v-model="f.date_to" class="input isl-date" @change="load()" />
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
        <div class="se-ic"><Icon name="receipt" :size="22" /></div>
        <p>{{ hasFilter ? '当前条件下没有销售单。' : '还没有销售单。' }}</p>
        <button v-if="canWrite" class="btn btn-primary btn-sm" style="margin-top:12px"
                @click="go('/inventory/sale/new')">
          <Icon name="plus" :size="14" />新建销售单
        </button>
      </div>
    </div>

    <template v-else>
      <div class="card">
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
                <th>单号</th>
                <th>客户</th>
                <th class="num">金额</th>
                <th>状态</th>
                <th v-if="isVisible('otype')">出货方式</th>
                <th v-if="isVisible('odate')">下单日期</th>
                <th v-if="isVisible('ddate')">交货日期</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id" class="isl-row" @click="go('/inventory/sale/' + r.id)">
                <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
                <td class="isl-no">{{ r.order_no || ('#' + r.id) }}</td>
                <td>{{ r.customer_name || '—' }}</td>
                <td class="num">¥{{ fmtMoney(r.total_amount) }}</td>
                <td>
                  <span class="tag" :class="tagOf(SO_STATUS, r.status)">{{ textOf(SO_STATUS, r.status) }}</span>
                </td>
                <td v-if="isVisible('otype')">{{ orderTypeText(r.order_type) }}</td>
                <td v-if="isVisible('odate')">{{ (r.order_date || '').slice(0, 10) || '—' }}</td>
                <td v-if="isVisible('ddate')">{{ (r.delivery_date || '').slice(0, 10) || '—' }}</td>
                <td class="isl-op">查看</td>
              </tr>
            </tbody>
          </table>
        </div>

        <ColMenuPanel ref="panel" :col-list="COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />

        <div class="isl-page">
          <span class="isl-cnt">共 {{ total }} 张，第 {{ pageFrom }}–{{ pageTo }} 张</span>
          <button class="btn btn-ghost btn-sm" :disabled="offset <= 0 || loading" @click="prev">上一页</button>
          <button class="btn btn-ghost btn-sm" :disabled="offset + limit >= total || loading" @click="next">下一页</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 销售单列表 —— 数据源：`GET /api/psi/sale-orders`。
   🔴 「出货方式」（自提 / 调拨 / 车销）筛选是**后端过滤**（v392 给
      `sale_order_list` 追加了 `order_type` 参数）。⚠️ 不要改成前端 filter：
      本页有 2.2 万张单、按页拉 50 行，前端过滤只会作用于当前这一页 ⇒ 用户会看到
      「筛选后还有 50 条」这种假结果。 */
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { useColSettings } from '../../composables/useColSettings.js'
import ColMenuPanel from '../../components/ColMenuPanel.vue'
import { psiApi } from '../../api/psi'
import { canDo } from '../../store'
import { SO_STATUS, ORDER_TYPE, ORDER_TYPE_OPTIONS, textOf, tagOf, fmtMoney } from '../../constants/psiLabels'

/* 🔴 列设置（齿轮）：替换「序号」表头，可选列默认全开，核心列恒显。 */
const COLS = [
  { key: 'otype', label: '出货方式', core: false },
  { key: 'odate', label: '下单日期', core: false },
  { key: 'ddate', label: '交货日期', core: false },
]
const { isVisible, toggleCol, resetCols } = useColSettings('INV-SALE-LIST', COLS)
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }

const router = useRouter()
const route = useRoute()

/* 🔴 v395（2026-10-08）：单据类型**从 URL 读** —— 侧栏「自提订单 / 自提退单 /
   车销订单 / 车销退单 / 调拨单」五个入口是**同一条 path、不同 query**，
   没有这一段的话，点哪个进去都是同一张未筛选的列表 ⇒ 入口是假的。
   · `type` → 出货方式（`ORDER_TYPE` 的键）；未知值忽略（不许把脏 query 带进筛选）；
   · `kind=return` → 该出货方式 **且 状态=退货**（后端 `sale_orders.status='returned'`）；
   · `kind=order` → 结果里**排除**退货行（退单独立成单之前唯一可用的区分口径）。 */
const _qType = String((route.query && route.query.type) || '')
const _qKind = String((route.query && route.query.kind) || '')
const _kindOrder = _qKind === 'order'

const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const customers = ref([])
const limit = 50
const offset = ref(0)

const f = ref({ status: _qKind === 'return' ? 'returned' : '',
  order_type: ORDER_TYPE[_qType] ? _qType : '', customer_id: 0, date_from: '', date_to: '' })

/* 页头随入口变（自提订单 / 车销退单 / 调拨单 …）—— 让人一眼确认筛选真的生效了，
   而不是点五个入口都看到同一张「销售单」。 */
const title = computed(() => {
  const t = f.value.order_type ? textOf(ORDER_TYPE, f.value.order_type, '') : ''
  const k = _qKind === 'return' ? '退单' : (_qKind === 'order' ? '订单' : '')
  return t ? `${t}${k}` : '销售单'
})
const subTitle = computed(() => title.value === '销售单'
  ? '出货台账' : `按「${title.value}」筛选的出货台账`)
/* 「＋」带同一份 `type` / `kind` 进新建页 ⇒ 新单落在对应入口下（不靠手选） */
const newTo = computed(() => {
  const q = {}
  if (ORDER_TYPE[_qType]) q.type = _qType
  if (_qKind) q.kind = _qKind
  return { path: '/inventory/sale/new', query: q }
})

const canWrite = computed(() => canDo('inventory', 'create'))
const hasFilter = computed(() => !!(f.value.status || f.value.order_type || f.value.customer_id
  || f.value.date_from || f.value.date_to))
const pageFrom = computed(() => (total.value ? offset.value + 1 : 0))
const pageTo = computed(() => Math.min(offset.value + limit, total.value))

const SO_OPTIONS = ['draft', 'confirmed', 'delivered', 'signed', 'rejected', 'returned', 'cancelled']
  .map(v => ({ value: v, text: textOf(SO_STATUS, v) }))

/* 未知出货方式也必须是中文（不许回落英文值） */
function orderTypeText (v) { return textOf(ORDER_TYPE, v, '未标注') }

async function load (resetPage = true) {
  if (resetPage) offset.value = 0
  loading.value = true
  err.value = ''
  try {
    const [d, refs] = await Promise.all([
      psiApi.listSales({ ...f.value, limit, offset: offset.value }),
      customers.value.length ? Promise.resolve(null) : psiApi.refs('customers', '', 200),
    ])
    let list = d.orders || []
    /* 「订单」入口要排除退货行（见上方 URL 读取处的口径说明） */
    if (_kindOrder) list = list.filter(r => r.status !== 'returned')
    rows.value = list
    total.value = Number(d.total || 0)
    if (refs && Array.isArray(refs.customers)) customers.value = refs.customers
  } catch (e) {
    err.value = e.message || '销售单读取失败'
  } finally {
    loading.value = false
  }
}

function resetFilter () {
  f.value = { status: '', order_type: '', customer_id: 0, date_from: '', date_to: '' }
  load()
}
function next () { offset.value += limit; load(false) }
function prev () { offset.value = Math.max(0, offset.value - limit); load(false) }
function go (p) { router.push(p) }
onMounted(load)
</script>

<style scoped>
.inv-page { display: block }
.is-acts { display: flex; gap: 8px; flex-wrap: wrap }
.isl-filter { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
.isl-f { display: flex; flex-direction: column; gap: 4px }
.isl-lb { font-size: 12px; color: var(--t3) }
.isl-sel { min-width: 130px; height: 32px }
.isl-date { height: 32px }
.isl-row { cursor: pointer }
.isl-no { font-variant-numeric: tabular-nums }
.isl-op { color: var(--p-dark); white-space: nowrap }
.isl-page { display: flex; align-items: center; gap: 8px; justify-content: flex-end; padding-top: 12px; flex-wrap: wrap }
.isl-cnt { font-size: 12px; color: var(--t3); margin-right: auto }

@media (max-width: 640px) {
  .isl-filter { align-items: stretch }
  .isl-f, .isl-sel, .isl-date { width: 100%; min-width: 0 }
}
</style>
