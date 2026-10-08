<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>库存查询</h2>
        <span class="page-sub">按批次看库存，最早到期的排在最上面</span>
      </div>
      <div class="is-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <!-- 筛选条：全部由**后端**筛选（分页才不会骗人 —— 前端过滤只作用于当前这 50 行） -->
    <div class="card is-filter">
      <div class="is-f">
        <label class="is-lb">关键字</label>
        <input v-model.trim="f.keyword" class="input is-kw" placeholder="商品名 / 条码 / 批次号"
               @keyup.enter="load()" />
      </div>
      <div class="is-f">
        <label class="is-lb">仓库</label>
        <select v-model.number="f.warehouse_id" class="input is-sel" @change="load()">
          <option :value="0">全部仓库</option>
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <div class="is-f">
        <label class="is-lb">到期</label>
        <select v-model.number="f.expiring_within_days" class="input is-sel" @change="load()">
          <option :value="0">全部</option>
          <option :value="7">7 天内到期</option>
          <option :value="15">15 天内到期</option>
          <option :value="30">30 天内到期</option>
          <option :value="60">60 天内到期</option>
          <option :value="90">90 天内到期</option>
        </select>
      </div>
      <label class="is-chk">
        <input type="checkbox" v-model="f.only_saleable" @change="load()" />
        只看还能卖的
      </label>
      <button class="btn btn-primary btn-sm" @click="load()">查询</button>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <div v-else-if="!rows.length" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="package" :size="22" /></div>
        <p>当前条件下没有库存。库存要靠采购单到货入库才会产生。</p>
      </div>
    </div>

    <template v-else>
      <div class="card is-tbl">
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th>规格</th>
                <th>仓库</th>
                <th>批次号</th>
                <th>到期日</th>
                <th>剩余</th>
                <th class="num">数量</th>
                <th class="num">成本价</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id">
                <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
                <td>{{ r.product_name || ('商品 ' + r.product_id) }}</td>
                <td>{{ r.spec || '—' }}</td>
                <td>{{ r.warehouse_name || ('仓库 ' + r.warehouse_id) }}</td>
                <td>{{ r.batch_no || '—' }}</td>
                <td>{{ r.expiry_date || '—' }}</td>
                <!-- 剩余天数由后端算（与排序、可售判定同源），前端不再拿今天去减 -->
                <td>{{ daysText(r) }}</td>
                <td class="num">{{ fmtQty(r.quantity) }}</td>
                <td class="num">¥{{ fmtMoney(r.cost_price) }}</td>
                <td>
                  <span class="tag" :class="tagOf(EXPIRY_STATUS, r.expiry_status)">
                    {{ textOf(EXPIRY_STATUS, r.expiry_status) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="is-page">
          <span class="is-cnt">共 {{ total }} 行，第 {{ pageFrom }}–{{ pageTo }} 行</span>
          <button class="btn btn-ghost btn-sm" :disabled="offset <= 0 || loading" @click="prev">上一页</button>
          <button class="btn btn-ghost btn-sm" :disabled="offset + limit >= total || loading" @click="next">下一页</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 库存查询（批次级）—— 数据源：`GET /api/psi/stock`。
   🔴 默认排序**不在前端做**：后端已按 `到期日升序（无到期日排最后）` 返回，且与出库
      扣减（FEFO）同口径。前端再 sort 一遍就会出现「屏幕顺序 ≠ 实际扣减顺序」。
   🔴 本页**刻意没有「创建」入口**（计划 §七 页面 8）：库存是采购/销售的**结果**，
      手改库存要走去库存效期补录或盘点，不该在这里凭空加。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { EXPIRY_STATUS, textOf, tagOf, fmtMoney } from '../../constants/psiLabels'

const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const warehouses = ref([])
const limit = 50
const offset = ref(0)

const f = ref({
  keyword: '',
  warehouse_id: 0,
  expiring_within_days: 0,
  only_saleable: false,
})

const pageFrom = computed(() => (total.value ? offset.value + 1 : 0))
const pageTo = computed(() => Math.min(offset.value + limit, total.value))

async function load (resetPage = true) {
  if (resetPage) offset.value = 0
  loading.value = true
  err.value = ''
  try {
    const [d, refs] = await Promise.all([
      psiApi.stock({
        keyword: f.value.keyword,
        warehouse_id: f.value.warehouse_id,
        expiring_within_days: f.value.expiring_within_days,
        only_saleable: f.value.only_saleable,
        limit,
        offset: offset.value,
      }),
      warehouses.value.length ? Promise.resolve(null) : psiApi.refs('warehouses'),
    ])
    rows.value = d.rows || []
    total.value = Number(d.total || 0)
    if (refs && Array.isArray(refs.warehouses)) warehouses.value = refs.warehouses
  } catch (e) {
    err.value = e.message || '库存读取失败'
  } finally {
    loading.value = false
  }
}

function next () { offset.value += limit; load(false) }
function prev () { offset.value = Math.max(0, offset.value - limit); load(false) }

/* 「剩余天数」文案：后端给的是 `expiry_days_left`（null = 无到期日或日期不可解析，
   两者已由 `expiry_status` 区分）⇒ 这里只做**单位中文化**，不参与任何判断。 */
function daysText (r) {
  const s = r.expiry_status
  if (s === 'none') return '—'
  if (s === 'unknown') return '—'
  const d = r.expiry_days_left
  if (d === null || d === undefined) return '—'
  if (d < 0) return `已过 ${Math.abs(d)} 天`
  if (d === 0) return '今天到期'
  return `${d} 天`
}

function fmtQty (n) { return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }
onMounted(load)
</script>

<style scoped>
.inv-page { display: block }
.is-acts { display: flex; gap: 8px; flex-wrap: wrap }

.is-filter {
  display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap;
  margin-bottom: 12px;
}
.is-f { display: flex; flex-direction: column; gap: 4px }
.is-lb { font-size: 12px; color: var(--t3) }
.is-kw { width: 220px; height: 32px }
.is-sel { min-width: 130px; height: 32px }
.is-chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--t2); height: 32px }

.is-page {
  display: flex; align-items: center; gap: 8px; justify-content: flex-end;
  padding-top: 12px; flex-wrap: wrap;
}
.is-cnt { font-size: 12px; color: var(--t3); margin-right: auto }

@media (max-width: 640px) {
  .is-kw { width: 100% }
  .is-filter { align-items: stretch }
  .is-f, .is-sel { width: 100%; min-width: 0 }
}
</style>
