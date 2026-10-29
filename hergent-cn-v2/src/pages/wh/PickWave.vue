<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>拣货波次</h2>
        <span class="page-sub">把待拣销售单聚成波次统一拣货，生成时按小单位自动预留，防超卖</span>
      </div>
      <div class="pw-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
        <button class="btn btn-primary btn-sm" @click="openCreate()">
          <Icon name="plus" :size="14" />生成波次
        </button>
      </div>
    </div>

    <div class="card pw-filter">
      <div class="pw-f">
        <label class="pw-lb">仓库</label>
        <select v-model.number="warehouseId" class="input pw-sel" :disabled="!warehouses.length" @change="load()">
          <option :value="0">全部仓库</option>
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <span class="pw-hint">生成波次会聚合该仓「草稿 / 已确认 / 已审批」状态的销售单；预留不足会整体回滚并提示。</span>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <div v-else-if="!waves.length" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="package" :size="22" /></div>
        <p>还没有拣货波次。点「生成波次」把待拣销售单聚成一批。</p>
      </div>
    </div>

    <template v-else>
      <div class="card pw-tbl">
        <div class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>波次号</th>
                <th>仓库</th>
                <th>拣货员</th>
                <th>状态</th>
                <th class="num">项数</th>
                <th class="num">已拣 / 总量</th>
                <th>生成时间</th>
                <th class="pw-act-th">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(w, i) in waves" :key="w.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ w.wave_no }}</td>
                <td>{{ whName(w.warehouse_id) }}</td>
                <td>{{ w.picker_id || '—' }}</td>
                <td><span class="tag" :class="waveTag(w.status)">{{ waveText(w.status) }}</span></td>
                <td class="num">{{ w.item_count || 0 }}</td>
                <td class="num">{{ fmtQty(w.picked_count) }} / {{ fmtQty(w.total_qty) }}</td>
                <td>{{ w.created_at || '—' }}</td>
                <td class="pw-act">
                  <button class="btn btn-ghost btn-xs" @click="openDetail(w.id)">查看</button>
                  <button v-if="w.status === 'picking'" class="btn btn-ghost btn-xs" @click="completeWave(w.id)">完成</button>
                  <button v-if="w.status === 'picking'" class="btn btn-ghost btn-xs danger" @click="cancelWave(w.id)">作废</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 生成波次面板 -->
    <div v-if="showCreate" class="pw-modal-mask" @click.self="showCreate = false">
      <div class="card pw-modal">
        <div class="pw-modal-hd">
          <h3>生成拣货波次</h3>
          <button class="pw-x" @click="showCreate = false"><Icon name="close" :size="16" /></button>
        </div>
        <div class="pw-form">
          <div class="pw-f">
            <label class="pw-lb">仓库<span class="req">*</span></label>
            <select v-model.number="createForm.warehouse_id" class="input">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
          <div class="pw-f">
            <label class="pw-lb">拣货员</label>
            <input v-model.trim="createForm.picker_id" class="input" placeholder="可选，如：张三" />
          </div>
          <div class="pw-f pw-f-wide">
            <label class="pw-lb">指定订单号</label>
            <input v-model.trim="createForm.order_ids_text" class="input"
                   placeholder="留空 = 聚合该仓全部待拣单；多个用逗号隔开，如：12,15,18" />
          </div>
          <p class="pw-tip">生成时会为每张单按小单位预留库存；某单库存不足则整波回滚，不会留下半截波次。</p>
        </div>
        <div v-if="createErr" class="state-error pw-ce"><Icon name="alert" :size="14" />{{ createErr }}</div>
        <div class="pw-modal-ft">
          <button class="btn btn-ghost btn-sm" @click="showCreate = false">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="creating" @click="createWave()">
            {{ creating ? '生成中…' : '生成' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 波次明细面板 -->
    <div v-if="detail" class="pw-modal-mask" @click.self="detail = null">
      <div class="card pw-modal pw-modal-lg">
        <div class="pw-modal-hd">
          <h3>波次明细 · {{ detail.wave_no }}
            <span class="tag" :class="waveTag(detail.status)">{{ waveText(detail.status) }}</span>
          </h3>
          <button class="pw-x" @click="detail = null"><Icon name="close" :size="16" /></button>
        </div>
        <div class="pw-detail-meta">
          <span>仓库：{{ whName(detail.warehouse_id) }}</span>
          <span>拣货员：{{ detail.picker_id || '—' }}</span>
          <span>生成：{{ detail.created_at || '—' }}</span>
        </div>
        <div v-if="detailLoading" class="pw-dl"><Skeleton /></div>
        <div v-else-if="!detail.items || !detail.items.length" class="state-empty small">
          <p>该波次没有拣货明细。</p>
        </div>
        <div v-else class="pw-dtbl">
          <div class="table-wrap freeze-list">
            <table class="tbl">
              <thead>
                <tr>
                  <th>商品</th><th>规格</th><th>来源单</th><th>库位</th>
                  <th class="num">应拣</th><th class="num">已拣</th><th>状态</th><th class="pw-act-th">记录已拣</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="it in detail.items" :key="it.id">
                  <td>{{ it.product_name || ('商品 ' + it.product_id) }}</td>
                  <td>{{ it.product_spec || '—' }}</td>
                  <td>{{ it.sale_order_no || '—' }}</td>
                  <td>{{ it.bin_location || '—' }}</td>
                  <td class="num">{{ fmtQty(it.quantity) }}</td>
                  <td class="num">{{ fmtQty(it.picked_qty) }}</td>
                  <td><span class="tag" :class="itemTag(it.status)">{{ itemText(it.status) }}</span></td>
                  <td class="pw-act">
                    <input v-model.number="it._pick" type="number" min="0" :max="it.quantity"
                           class="input pw-pick-num" placeholder="已拣量" />
                    <button class="btn btn-ghost btn-xs" :disabled="it._pick === '' || it._pick === null"
                            @click="pick(it)">记录</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="pw-modal-ft">
          <button class="btn btn-ghost btn-sm" @click="detail = null">关闭</button>
          <button v-if="detail.status === 'picking'" class="btn btn-ghost btn-sm danger" @click="cancelWave(detail.id)">作废波次</button>
          <button v-if="detail.status === 'picking'" class="btn btn-primary btn-sm" :disabled="detailLoading" @click="completeWave(detail.id)">确认拣货完成</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 拣货波次（仓配管理 · ④ W1）—— 数据源：/api/picking/waves（列表/明细）+ /api/picking/waves/{id}/complete|cancel。
   🔴 生成波次即按小单位预留（auto_reserve）：预留不足后端整波回滚并 400，前端必须显示错误。
   🔴 「确认完成」只置 completed；预留随订单发货/作废时释放，不在完成处释放。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'

const loading = ref(true)
const err = ref('')
const waves = ref([])
const warehouses = ref([])
const warehouseId = ref(0)

const showCreate = ref(false)
const creating = ref(false)
const createErr = ref('')
const createForm = ref({ warehouse_id: 0, picker_id: '', order_ids_text: '' })

const detail = ref(null)
const detailLoading = ref(false)

const WAVE_STATUS = [
  { v: 'picking', t: '拣货中', cls: 'badge-blue' },
  { v: 'completed', t: '已完成', cls: 'badge-green' },
  { v: 'cancelled', t: '已作废', cls: 'badge-gray' },
]
const ITEM_STATUS = [
  { v: 'pending', t: '待拣', cls: 'badge-gray' },
  { v: 'partial', t: '部分拣', cls: 'badge-blue' },
  { v: 'picked', t: '已拣', cls: 'badge-green' },
]
function waveText (s) { const x = WAVE_STATUS.find(o => o.v === s); return x ? x.t : (s || '—') }
function waveTag (s) { const x = WAVE_STATUS.find(o => o.v === s); return x ? x.cls : 'badge-gray' }
function itemText (s) { const x = ITEM_STATUS.find(o => o.v === s); return x ? x.t : (s || '—') }
function itemTag (s) { const x = ITEM_STATUS.find(o => o.v === s); return x ? x.cls : 'badge-gray' }
function whName (id) { const w = warehouses.value.find(x => x.id === id); return w ? w.name : ('仓库 ' + id) }
function fmtQty (n) { const v = Number(n || 0); return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2) }

async function load () {
  loading.value = true
  err.value = ''
  try {
    if (!warehouses.value.length) {
      const ws = await whApi.warehouses()
      warehouses.value = Array.isArray(ws) ? ws : []
      if (warehouses.value.length && !createForm.value.warehouse_id) {
        createForm.value.warehouse_id = warehouses.value[0].id
      }
    }
    const list = await whApi.pickWaveList({ warehouse_id: warehouseId.value })
    waves.value = Array.isArray(list) ? list : []
  } catch (e) {
    err.value = e.message || '波次读取失败'
  } finally {
    loading.value = false
  }
}

function openCreate () {
  createErr.value = ''
  createForm.value.order_ids_text = ''
  showCreate.value = true
}

async function createWave () {
  creating.value = true
  createErr.value = ''
  try {
    const ids = (createForm.value.order_ids_text || '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0)
    await whApi.pickWaveCreate({
      warehouse_id: createForm.value.warehouse_id,
      picker_id: createForm.value.picker_id,
      order_ids: ids,
    })
    showCreate.value = false
    await load()
  } catch (e) {
    createErr.value = e.message || '生成失败'
  } finally {
    creating.value = false
  }
}

async function openDetail (id) {
  detailLoading.value = true
  detail.value = { id }
  try {
    const d = await whApi.pickWaveDetail(id)
    if (d && d.items) {
      for (const it of d.items) it._pick = ''
    }
    detail.value = d || { id, items: [] }
  } catch (e) {
    detail.value = { id, items: [], _err: e.message || '明细读取失败' }
  } finally {
    detailLoading.value = false
  }
}

async function completeWave (id) {
  if (!confirm('确认该波次拣货完成？已拣数量将保留，预留待发货/作废时释放。')) return
  try {
    await whApi.pickWaveComplete(id)
    detail.value = null
    await load()
  } catch (e) {
    err.value = e.message || '操作失败'
  }
}

async function cancelWave (id) {
  if (!confirm('作废该波次？会释放该波次各订单的预留，可用库存恢复。')) return
  try {
    await whApi.pickWaveCancel(id)
    detail.value = null
    await load()
  } catch (e) {
    err.value = e.message || '操作失败'
  }
}

async function pick (it) {
  const qty = Number(it._pick)
  if (!(qty >= 0)) return
  try {
    await whApi.pickItem(it.id, qty)
    it.picked_qty = qty
    it.status = qty >= Number(it.quantity) ? 'picked' : (qty > 0 ? 'partial' : 'pending')
    it._pick = ''
  } catch (e) {
    err.value = e.message || '记录失败'
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.pw-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.pw-filter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px }
.pw-f { display: flex; flex-direction: column; gap: 4px }
.pw-lb { font-size: 12px; color: var(--t3) }
.pw-sel { min-width: 160px }
.pw-hint { font-size: 12px; color: var(--t2) }
.pw-act-th { text-align: right }
.pw-act { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap }

.pw-modal-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.38);
  display: flex; align-items: center; justify-content: center; z-index: 60; padding: 18px;
}
.pw-modal { width: 460px; max-width: 100%; max-height: 88vh; overflow: auto; padding: 18px }
.pw-modal-lg { width: 760px }
.pw-modal-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px }
.pw-modal-hd h3 { font-size: 16px; display: flex; align-items: center; gap: 8px }
.pw-x { border: none; background: transparent; cursor: pointer; color: var(--t2); padding: 4px }
.pw-form { display: flex; flex-direction: column; gap: 12px }
.pw-f-wide { width: 100% }
.pw-tip { font-size: 12px; color: var(--t2); margin: 0 }
.pw-ce { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 10px }
.pw-modal-ft { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px }
.pw-detail-meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--t2); margin-bottom: 12px }
.pw-dl { padding: 8px 0 }
.pw-dtbl { max-height: 52vh; overflow: auto }
.pw-pick-num { width: 92px; height: 28px }

/* 危险操作按钮（作废） */
.btn.danger { color: var(--danger, #d4380d) }
.badge-gray { background: var(--bg-2, #eee); color: var(--t2) }
.req { color: var(--danger, #d4380d) }
.state-empty.small { padding: 18px 0 }
</style>
