<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>进销存</h2>
        <span class="page-sub">采购、销售、库存的一体台账</span>
      </div>
      <div class="iw-acts">
        <label class="iw-lb">仓库</label>
        <select v-model.number="warehouseId" class="input iw-wh-sel" @change="load">
          <option :value="0">全部仓库</option>
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <!-- 🔴 失败必须显式：不吞错、不留一排 0（「恒空恒 0 且零报错」= 静默失效） -->
    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load">重试</button>
    </div>

    <template v-else>
      <!-- ① 还没有任何库存 ⇒ 显示**去哪做**的引导，而不是一排 0 -->
      <div v-if="!s || !s.batch_rows" class="card">
        <div class="state-empty">
          <div class="se-ic"><Icon name="package" :size="22" /></div>
          <p>{{ (s && s.empty_hint) || PSI_NOTES.stockEmpty }}</p>
          <div class="iw-go">
            <button v-if="canWrite" class="btn btn-primary btn-sm" @click="go('/inventory/purchase/new')">
              <Icon name="plus" :size="14" />新建采购单
            </button>
            <button class="btn btn-ghost btn-sm" @click="go('/inventory/purchase')">查看采购单</button>
          </div>
        </div>
      </div>

      <template v-else>
        <div class="bento">
          <!-- ② 4 个 KPI —— 数值逐条取自 `/api/psi/stock/summary`，不在这里二次计算 -->
          <div class="card kpi-strip cols-4">
            <div class="kpi">
              <div class="kpi-label">库存数量</div>
              <div class="kpi-val">{{ fmtQty(s.total_quantity) }}</div>
              <div class="kpi-sub">{{ s.sku_count }} 个商品有货</div>
            </div>
            <div class="kpi">
              <div class="kpi-label">库存金额</div>
              <div class="kpi-val">¥{{ fmtMoney(s.total_amount) }}</div>
              <div class="kpi-sub">按当前成本价计</div>
            </div>
            <div class="kpi">
              <div class="kpi-label">在库批次</div>
              <div class="kpi-val">{{ s.batch_rows }}</div>
              <div class="kpi-sub">{{ warehouseId ? '当前仓库' : '全部仓库' }}</div>
            </div>
            <div class="kpi">
              <div class="kpi-label">未登记到期日</div>
              <div class="kpi-val" :class="s.missing_expiry_rows ? 'val-bad' : 'val-ok'">
                {{ s.missing_expiry_rows }}
              </div>
              <div class="kpi-sub">共 {{ fmtQty(s.missing_expiry_quantity) }} 件</div>
            </div>
          </div>

          <!-- ③ 未登记到期日的提示 —— 它会让整套效期管理失效，必须显式提示 -->
          <div v-if="s.missing_expiry_rows" class="card iw-warn">
            <Icon name="alert" :size="16" />
            <span>{{ PSI_NOTES.stockNoExpiry }}</span>
            <button class="btn btn-ghost btn-sm" @click="go('/inventory/stock')">去库存查询看是哪些</button>
          </div>

          <!-- ④ 临期分档 -->
          <div class="card iw-exp">
            <div class="iw-hd">
              <b>临期与过期</b>
              <span class="iw-note">按到期日离今天的天数分档</span>
            </div>
            <div class="iw-chips">
              <div v-for="b in buckets" :key="b.key" class="iw-chip" :class="b.cls">
                <div class="iw-chip-lb">{{ b.label }}</div>
                <div class="iw-chip-val">{{ b.rows }} 批</div>
                <div class="iw-chip-sub">{{ fmtQty(b.quantity) }} 件</div>
              </div>
            </div>
          </div>

          <!-- ⑤ 按仓分布 -->
          <div class="card iw-wh">
            <div class="iw-hd"><b>各仓库存</b></div>
            <div v-if="!s.by_warehouse || !s.by_warehouse.length" class="state-empty">暂无数据</div>
            <div v-else class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr><th>仓库</th><th class="num">批次</th><th class="num">数量</th><th class="num">金额</th></tr>
                </thead>
                <tbody>
                  <tr v-for="w in s.by_warehouse" :key="w.warehouse_id">
                    <td>{{ w.warehouse_name || ('仓库 ' + w.warehouse_id) }}</td>
                    <td class="num">{{ w.rows_ }}</td>
                    <td class="num">{{ fmtQty(w.qty) }}</td>
                    <td class="num">¥{{ fmtMoney(w.amount) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
/* 进销存工作台 —— 数据源只有一个：`GET /api/psi/stock/summary`。
   🔴 为什么不在前端自己算：口径（含不含过期、金额按成本价、无到期日怎么算）必须与
      「库存查询 / 临期清单 / 出库扣减」**同一份**。前端再算一遍就是第二份实现。
   🔴 全 0 时**不渲染一排 0**（计划 §七 页面 1 的验收要点）—— 换成「去哪做」的引导。 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { canDo } from '../../store'
import { PSI_NOTES, fmtMoney } from '../../constants/psiLabels'

const router = useRouter()

const loading = ref(true)
const err = ref('')
const s = ref(null)
const warehouses = ref([])
/* 🔴 默认「全部仓库」，**不挑默认仓**：生产实测 `is_default=1` 有**两个**（临期仓与总仓），
   猜哪个都会让 KPI 与用户心里的数对不上。 */
const warehouseId = ref(0)

/* 按钮级门禁：api() 写路径都是 POST ⇒ 动作轴 = create（见 store.canDo 三态说明） */
const canWrite = computed(() => canDo('inventory', 'create'))

async function load() {
  loading.value = true
  err.value = ''
  try {
    const [sum, refs] = await Promise.all([
      psiApi.stockSummary(warehouseId.value),
      warehouses.value.length ? Promise.resolve(null) : psiApi.refs('warehouses'),
    ])
    s.value = sum
    if (refs && Array.isArray(refs.warehouses)) warehouses.value = refs.warehouses
  } catch (e) {
    // 显式失败：把后端的 detail 原样显示（它通常已说明原因），不写成「加载失败」
    err.value = e.message || '库存概览读取失败'
  } finally {
    loading.value = false
  }
}

function go(p) { router.push(p) }

/* ---- 展示格式化（与全站惯例一致：千分位；数量取整、金额 2 位） ---- */
function fmtQty(n) { return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }
/* 临期分档：key 与后端 `expiring` 字典一致（expired/d7/d15/d30/d60/d90）。
   ⚠️ 档位名称里**不写死天数**（30/90 是后端常量，改了就漂移）；天数写在标签上是因为
      它本身就是「N 天内」的含义，与后端用的同一个数字 —— 但**阈值判断在前端一处都没有**。 */
const BUCKETS = [
  { key: 'expired', label: '已过期',  cls: 'bad'  },
  { key: 'd7',      label: '7 天内',  cls: 'bad'  },
  { key: 'd15',     label: '15 天内', cls: 'warn' },
  { key: 'd30',     label: '30 天内', cls: 'warn' },
  { key: 'd60',     label: '60 天内', cls: ''     },
  { key: 'd90',     label: '90 天内', cls: ''     },
]
const buckets = computed(() => {
  const e = (s.value && s.value.expiring) || {}
  return BUCKETS.map(b => ({ ...b, rows: (e[b.key] || {}).rows || 0, quantity: (e[b.key] || {}).quantity || 0 }))
})

onMounted(load)
</script>

<style scoped>
/* 本页私有类统一 `iw-` 前缀（UI-SPEC：页面私有类带页面前缀，公共视觉语言走全局层）。 */
.inv-page { display: block }
.iw-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.iw-lb { font-size: 12px; color: var(--t3) }
.iw-wh-sel { height: 32px; min-width: 140px }
.iw-go { display: flex; gap: 8px; justify-content: center; margin-top: 12px; flex-wrap: wrap }

.iw-warn {
  grid-column: 1 / -1;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  border-left: 3px solid var(--war);
  color: var(--t1);
}
.iw-warn svg { color: var(--war); flex: none }
.iw-warn span { flex: 1; min-width: 200px; font-size: 13px }

.iw-exp { grid-column: span 7 }
.iw-wh { grid-column: span 5 }
.iw-hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; flex-wrap: wrap }
.iw-note { font-size: 12px; color: var(--t3) }

.iw-chips { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px }
.iw-chip {
  padding: 10px 8px; border-radius: var(--radius-sm);
  background: var(--bg2); text-align: center;
}
.iw-chip.bad  { background: var(--danger-bg); }
.iw-chip.warn { background: var(--p-bg); }
.iw-chip-lb  { font-size: 12px; color: var(--t2); margin-bottom: 4px }
.iw-chip-val { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--t1) }
.iw-chip.bad  .iw-chip-val { color: var(--dan) }
.iw-chip.warn .iw-chip-val { color: var(--war) }
.iw-chip-sub { font-size: 11px; color: var(--t3); margin-top: 2px }

/* 640px 断点：分档变 2 列、两卡全宽（UI-SPEC 要求表单/密集页在窄屏可读） */
@media (max-width: 900px) {
  .iw-exp, .iw-wh { grid-column: 1 / -1 }
  .iw-chips { grid-template-columns: repeat(3, 1fr) }
}
@media (max-width: 640px) {
  .iw-chips { grid-template-columns: repeat(2, 1fr) }
  .iw-wh-sel { min-width: 0; flex: 1 }
}
</style>
