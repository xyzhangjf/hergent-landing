<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>车辆库存查询</h2>
        <span class="page-sub">在车库存 · 按车辆查看，用于车销与配送核对</span>
      </div>
      <div class="wvs-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading || !vehicles.length" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <div class="card wvs-filter">
      <div class="wvs-f">
        <label class="wvs-lb">车辆</label>
        <select v-model.number="vehicleId" class="input wvs-sel" :disabled="!vehicles.length" @change="load()">
          <option v-if="!vehicles.length" :value="0">暂无车辆</option>
          <option v-for="v in vehicles" :key="v.id" :value="v.id">
            {{ v.name }}{{ v.plate ? '（' + v.plate + '）' : '' }}{{ v.driver ? ' · ' + v.driver : '' }}
          </option>
        </select>
      </div>
      <span class="wvs-hint">车辆库存与「仓库库存」分开：装车后从仓库扣减、回到车上，卸载后回仓。</span>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <template v-else-if="vehicles.length">
      <div class="card kpi-strip cols-3">
        <div class="kpi">
          <div class="kpi-label">在车品种</div>
          <div class="kpi-val">{{ items.length }}</div>
          <div class="kpi-sub">台车上有货的商品数</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">在车总数量</div>
          <div class="kpi-val">{{ fmtQty(totalQty) }}</div>
          <div class="kpi-sub">按商品档案单位累加</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">当前车辆</div>
          <div class="kpi-val wvs-vname">{{ curVehicleName }}</div>
          <div class="kpi-sub">{{ curPlate || '未登记车牌' }}</div>
        </div>
      </div>

      <div v-if="items.length" class="card">
        <div class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th><th>商品</th><th>规格</th><th>单位</th>
                <th class="num">在车数量</th><th class="num">成本价</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in items" :key="i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.name }}</td>
                <td>{{ r.spec || '—' }}</td>
                <td>{{ r.unit || '—' }}</td>
                <td class="num">{{ fmtQty(r.quantity) }}</td>
                <td class="num">{{ fmtMoney(r.cost_price) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="4">本页合计</td>
                <td class="num">{{ fmtQty(pageTotals.qty) }}</td>
                <td class="num"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div v-else class="card">
        <div class="state-empty">
          <div class="se-ic"><Icon name="smartphone" :size="22" /></div>
          <p>这台车上当前没有库存。装车（车销出库）后才会产生。</p>
        </div>
      </div>
    </template>

    <div v-else class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="smartphone" :size="22" /></div>
        <p>还没有登记车辆。请先在车辆档案里新增，或在车销业务中建车。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 车辆库存查询（仓配管理 · 库存查询）—— 数据源：GET /api/vehicles + GET /api/vehicle-stock/{id}。
   🔴 车辆库存与仓库库存是两套 `warehouse_id`（车 = 1000 + vehicle_id，见后端 vehicle_stock_query）
      ⇒ 本页**只读**、不提供跨库调拨；装/卸车走去车销或调拨单。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { fmtMoney } from '../../constants/psiLabels'

const loading = ref(true)
const err = ref('')
const vehicles = ref([])
const vehicleId = ref(0)
const items = ref([])
const totalQty = ref(0)

const cur = computed(() => vehicles.value.find(v => v.id === vehicleId.value) || null)
const curVehicleName = computed(() => (cur.value ? cur.value.name : '—'))
const curPlate = computed(() => (cur.value ? cur.value.plate : ''))

function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    if (!vehicles.value.length) {
      const list = await whApi.vehicles()
      vehicles.value = Array.isArray(list) ? list : []
      if (vehicles.value.length && !vehicleId.value) vehicleId.value = vehicles.value[0].id
    }
    if (!vehicleId.value) {
      items.value = []
      totalQty.value = 0
      return
    }
    const d = await whApi.vehicleStock(vehicleId.value)
    items.value = Array.isArray(d.items) ? d.items : []
    totalQty.value = Number(d.total_qty || 0)
  } catch (e) {
    err.value = e.message || '车辆库存读取失败'
  } finally {
    loading.value = false
  }
}

/* 本页合计：只对当前车辆可见行的「在车数量」求和（成本价为单位成本，不合计）。 */
const pageTotals = computed(() => {
  let qty = 0
  for (const r of items.value) qty += Number(r.quantity || 0)
  return { qty }
})
onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 页面私有类一律 `wvs-` 前缀（仓配·车辆库存）。 */
.wvs-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.wvs-filter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px }
.wvs-f { display: flex; align-items: center; gap: 8px }
.wvs-lb { font-size: 13px; color: var(--t2) }
.wvs-sel { min-width: 240px }
.wvs-hint { font-size: 12px; color: var(--t2) }
.wvs-vname { font-size: 16px; font-weight: 600 }
</style>
