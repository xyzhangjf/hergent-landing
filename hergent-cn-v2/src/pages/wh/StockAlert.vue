<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>库存预警</h2>
        <span class="page-sub">低于安全库存的在售商品 · 缺货 / 低于安全库存</span>
      </div>
      <div class="wsa-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <!-- 筛选：全部由**后端**筛选（与列表同源，前端不再过滤一遍） -->
    <div class="card wsa-filter">
      <div class="wsa-f">
        <label class="wsa-lb">关键字</label>
        <input v-model.trim="f.keyword" class="input wsa-kw" placeholder="商品名 / 品牌 / 规格"
               @keyup.enter="load()" />
      </div>
      <div class="wsa-f">
        <label class="wsa-lb">预警级别</label>
        <select v-model="f.severity" class="input wsa-sel" @change="load()">
          <option value="">全部</option>
          <option value="out">缺货</option>
          <option value="low">低于安全库存</option>
        </select>
      </div>
      <button class="btn btn-primary btn-sm" @click="load()">查询</button>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <template v-else>
      <div class="card kpi-strip cols-3">
        <div class="kpi">
          <div class="kpi-label">缺货品种</div>
          <div class="kpi-val val-bad">{{ outCount }}</div>
          <div class="kpi-sub">库存已为 0</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">低于安全库存</div>
          <div class="kpi-val val-warn">{{ lowCount }}</div>
          <div class="kpi-sub">尚有货、但低于阈值</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">预警合计</div>
          <div class="kpi-val">{{ total }}</div>
          <div class="kpi-sub">当前筛选下</div>
        </div>
      </div>

      <div v-if="rows.length" class="card">
        <div class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th><th>商品</th><th>规格</th><th>单位</th><th>品牌</th>
                <th class="num">当前库存</th><th class="num">安全库存</th><th class="num">缺口</th><th>预警</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.product_id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.name }}</td>
                <td>{{ r.spec || '—' }}</td>
                <td>{{ r.unit || '—' }}</td>
                <td>{{ r.brand || '—' }}</td>
                <td class="num">{{ fmtQty(r.stock) }}</td>
                <td class="num">{{ fmtQty(r.safety_stock) }}</td>
                <td class="num wsa-gap">{{ fmtQty(r.gap) }}</td>
                <td>
                  <span class="tag" :class="r.severity === 'out' ? 'bad' : 'warn'">{{ sevText(r.severity) }}</span>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="4">本页合计</td>
                <td></td>
                <td class="num">{{ fmtQty(pageTotals.stock) }}</td>
                <td class="num">{{ fmtQty(pageTotals.safety) }}</td>
                <td class="num wsa-gap">{{ fmtQty(pageTotals.gap) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div v-else class="card">
        <div class="state-empty">
          <div class="se-ic"><Icon name="check" :size="22" /></div>
          <p>当前条件下没有库存预警，库存都在安全线以上。</p>
        </div>
      </div>

      <p class="wsa-foot">
        口径：只对**设置了安全库存**的在售商品告警；「缺货」= 库存 ≤ 0，「低于安全库存」= 0 &lt; 库存 ≤ 安全库存。
        缺口 = 安全库存 − 当前库存。安全库存在商品档案里维护。
      </p>
    </template>
  </div>
</template>

<script setup>
/* 库存预警（仓配管理 · 库存查询）—— 数据源：GET /api/inventory/low-stock。
   🔴 预警口径（阈值、缺货判定、缺口计算）**全部在后端**（与全站低库存 SQL 同源），
      前端只做展示 —— 前端再判一次 = 第二份口径，必然漂移。
   🔴 本页**只读**：补货动作去采购/调拨，不在这里改库存。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'

const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const outCount = ref(0)
const lowCount = ref(0)

const f = ref({ keyword: '', severity: '' })

function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}
function sevText (s) {
  return s === 'out' ? '缺货' : '低于安全库存'
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await whApi.lowStock({ keyword: f.value.keyword, severity: f.value.severity })
    rows.value = Array.isArray(d.rows) ? d.rows : []
    total.value = Number(d.total || 0)
    outCount.value = Number(d.out_count || 0)
    lowCount.value = Number(d.low_count || 0)
  } catch (e) {
    err.value = e.message || '库存预警读取失败'
  } finally {
    loading.value = false
  }
}

/* 本页合计：只对当前预警列表可见行的可加总列求和（当前库存 / 安全库存 / 缺口）。 */
const pageTotals = computed(() => {
  let stock = 0, safety = 0, gap = 0
  for (const r of rows.value) {
    stock += Number(r.stock || 0)
    safety += Number(r.safety_stock || 0)
    gap += Number(r.gap || 0)
  }
  return { stock, safety, gap }
})
onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 页面私有类一律 `wsa-` 前缀（仓配·库存预警）。 */
.wsa-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.wsa-filter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px }
.wsa-f { display: flex; align-items: center; gap: 8px }
.wsa-lb { font-size: 13px; color: var(--t2) }
.wsa-kw { min-width: 220px }
.wsa-sel { min-width: 160px }
.wsa-gap { font-weight: 600; color: var(--dan) }
.wsa-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }
</style>
