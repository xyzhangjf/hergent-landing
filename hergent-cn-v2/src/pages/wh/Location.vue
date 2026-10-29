<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>库位管理</h2>
        <span class="page-sub">把库存行指向正式库位（替代自由文本库位），拣货上架更清晰</span>
      </div>
      <div class="wl-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
        <button class="btn btn-primary btn-sm" @click="openCreate()">
          <Icon name="plus" :size="14" />新建库位
        </button>
        <button class="btn btn-ghost btn-sm" @click="openAssign()">
          <Icon name="map-pin" :size="14" />绑定库存
        </button>
      </div>
    </div>

    <div class="card wl-filter">
      <div class="wl-f">
        <label class="wl-lb">仓库</label>
        <select v-model.number="warehouseId" class="input wl-sel" :disabled="!warehouses.length" @change="load()">
          <option :value="0">全部仓库</option>
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <div v-else-if="!locations.length" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="map-pin" :size="22" /></div>
        <p>还没有库位。点「新建库位」登记冷藏A区、拣货位等。</p>
      </div>
    </div>

    <template v-else>
      <div class="card wl-tbl">
        <div class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>编码</th><th>名称</th><th>分区</th><th>备注</th>
                <th>仓库</th><th class="wl-act-th">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in locations" :key="l.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ l.code || '—' }}</td>
                <td>{{ l.name }}</td>
                <td>{{ l.zone || '—' }}</td>
                <td>{{ l.remark || '—' }}</td>
                <td>{{ whName(l.warehouse_id) }}</td>
                <td class="wl-act">
                  <button class="btn btn-ghost btn-xs" @click="openEdit(l)">编辑</button>
                  <button class="btn btn-ghost btn-xs danger" @click="del(l)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 新建 / 编辑库位面板 -->
    <div v-if="showForm" class="wl-modal-mask" @click.self="showForm = false">
      <div class="card wl-modal">
        <div class="wl-modal-hd">
          <h3>{{ editing ? '编辑库位' : '新建库位' }}</h3>
          <button class="wl-x" @click="showForm = false"><Icon name="close" :size="16" /></button>
        </div>
        <div class="wl-form">
          <div class="wl-f">
            <label class="wl-lb">仓库<span class="req">*</span></label>
            <select v-model.number="form.warehouse_id" class="input">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
          <div class="wl-f">
            <label class="wl-lb">编码</label>
            <input v-model.trim="form.code" class="input" placeholder="如：A-01" />
          </div>
          <div class="wl-f">
            <label class="wl-lb">名称<span class="req">*</span></label>
            <input v-model.trim="form.name" class="input" placeholder="如：冷藏A区" />
          </div>
          <div class="wl-f">
            <label class="wl-lb">分区</label>
            <input v-model.trim="form.zone" class="input" placeholder="如：冷藏 / 拣货面" />
          </div>
          <div class="wl-f wl-f-wide">
            <label class="wl-lb">备注</label>
            <input v-model.trim="form.remark" class="input" placeholder="可选" />
          </div>
        </div>
        <div v-if="formErr" class="state-error wl-fe"><Icon name="alert" :size="14" />{{ formErr }}</div>
        <div class="wl-modal-ft">
          <button class="btn btn-ghost btn-sm" @click="showForm = false">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save()">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 绑定库存到库位面板 -->
    <div v-if="showAssign" class="wl-modal-mask" @click.self="showAssign = false">
      <div class="card wl-modal wl-modal-lg">
        <div class="wl-modal-hd">
          <h3>绑定库存到库位</h3>
          <button class="wl-x" @click="showAssign = false"><Icon name="close" :size="16" /></button>
        </div>
        <div class="wl-form">
          <div class="wl-f">
            <label class="wl-lb">目标库位<span class="req">*</span></label>
            <select v-model.number="assignForm.location_id" class="input">
              <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
          </div>
          <div class="wl-f">
            <label class="wl-lb">仓库</label>
            <select v-model.number="assignForm.warehouse_id" class="input" @change="assignProducts = []">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
          <div class="wl-f wl-f-wide">
            <label class="wl-lb">商品</label>
            <select v-model.number="assignForm.product_id" class="input">
              <option :value="0">请选择商品</option>
              <option v-for="p in assignProducts" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
        </div>
        <p class="wl-tip">选好商品与仓库后点「查询」，会把该商品在此仓的库存行（按批次）全部绑定到目标库位。</p>
        <div v-if="assignErr" class="state-error wl-fe"><Icon name="alert" :size="14" />{{ assignErr }}</div>
        <div v-if="assignRows.length" class="wl-ar">
          <div class="table-wrap freeze-list">
            <table class="tbl">
              <thead><tr><th>商品</th><th>批次号</th><th class="num">数量</th><th>当前库位</th></tr></thead>
              <tbody>
                <tr v-for="r in assignRows" :key="r.id">
                  <td>{{ r.product_name || ('商品 ' + r.product_id) }}</td>
                  <td>{{ r.batch_no || '—' }}</td>
                  <td class="num">{{ fmtQty(r.quantity) }}</td>
                  <td>{{ r.location_name || '未指定' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="wl-modal-ft">
          <button class="btn btn-ghost btn-sm" @click="showAssign = false">取消</button>
          <button class="btn btn-ghost btn-sm" :disabled="!assignForm.product_id" @click="queryStock()">查询</button>
          <button class="btn btn-primary btn-sm" :disabled="!assignRows.length || assigning" @click="assign()">
            {{ assigning ? '绑定中…' : ('绑定 ' + assignRows.length + ' 行') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 库位管理（仓配管理 · ④ W3）—— 数据源：/api/wh/locations（目录 CRUD）+ /api/wh/locations/assign。
   🔴 inventory.location_id 把每行(lot)指向正式库位，替代 free-text bin_location。
   🔴 「绑定库存」按商品+仓库查询库存行（psiApi.stock）取 inventory.id，再批量指向库位。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { psiApi } from '../../api/psi'

const loading = ref(true)
const err = ref('')
const locations = ref([])
const warehouses = ref([])
const warehouseId = ref(0)

const showForm = ref(false)
const editing = ref(false)
const saving = ref(false)
const formErr = ref('')
const editingId = ref(0)
const form = ref({ warehouse_id: 0, code: '', name: '', zone: '', remark: '' })

const showAssign = ref(false)
const assigning = ref(false)
const assignErr = ref('')
const assignProducts = ref([])
const assignRows = ref([])
const assignForm = ref({ location_id: 0, warehouse_id: 0, product_id: 0 })

function whName (id) { const w = warehouses.value.find(x => x.id === id); return w ? w.name : ('仓库 ' + id) }
function fmtQty (n) { const v = Number(n || 0); return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2) }

async function load () {
  loading.value = true
  err.value = ''
  try {
    if (!warehouses.value.length) {
      const ws = await whApi.warehouses()
      warehouses.value = Array.isArray(ws) ? ws : []
      if (warehouses.value.length) {
        if (!form.value.warehouse_id) form.value.warehouse_id = warehouses.value[0].id
        if (!assignForm.value.warehouse_id) assignForm.value.warehouse_id = warehouses.value[0].id
      }
    }
    const list = await whApi.locationList({ warehouse_id: warehouseId.value })
    locations.value = Array.isArray(list) ? list : []
  } catch (e) {
    err.value = e.message || '库位读取失败'
  } finally {
    loading.value = false
  }
}

function openCreate () {
  editing.value = false
  editingId.value = 0
  formErr.value = ''
  form.value = { warehouse_id: warehouses.value.length ? warehouses.value[0].id : 0, code: '', name: '', zone: '', remark: '' }
  showForm.value = true
}

function openEdit (l) {
  editing.value = true
  editingId.value = l.id
  formErr.value = ''
  form.value = { warehouse_id: l.warehouse_id, code: l.code || '', name: l.name, zone: l.zone || '', remark: l.remark || '' }
  showForm.value = true
}

async function save () {
  saving.value = true
  formErr.value = ''
  try {
    if (!form.value.name) { formErr.value = '请填写库位名称'; return }
    if (editing.value) {
      await whApi.locationUpdate(editingId.value, {
        code: form.value.code, name: form.value.name, zone: form.value.zone, remark: form.value.remark,
      })
    } else {
      await whApi.locationCreate({
        warehouse_id: form.value.warehouse_id, code: form.value.code, name: form.value.name,
        zone: form.value.zone, remark: form.value.remark,
      })
    }
    showForm.value = false
    await load()
  } catch (e) {
    formErr.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function del (l) {
  if (!confirm(`删除库位「${l.name}」？已绑定到该库位的库存行会变为「未指定」。`)) return
  try {
    await whApi.locationDelete(l.id)
    await load()
  } catch (e) {
    err.value = e.message || '删除失败'
  }
}

async function openAssign () {
  assignErr.value = ''
  assignRows.value = []
  assignForm.value = { location_id: locations.value.length ? locations.value[0].id : 0, warehouse_id: warehouses.value.length ? warehouses.value[0].id : 0, product_id: 0 }
  try {
    const ps = await whApi.products()
    assignProducts.value = Array.isArray(ps) ? ps : []
  } catch (e) {
    assignProducts.value = []
  }
  showAssign.value = true
}

async function queryStock () {
  assignErr.value = ''
  assignRows.value = []
  if (!assignForm.value.product_id) { assignErr.value = '请先选择商品'; return }
  try {
    const product = assignProducts.value.find(p => p.id === assignForm.value.product_id)
    const d = await psiApi.stock({
      keyword: product ? product.name : '',
      warehouse_id: assignForm.value.warehouse_id,
      limit: 200, offset: 0,
    })
    const rows = (d && d.rows) || []
    assignRows.value = rows.filter(r => r.product_id === assignForm.value.product_id)
  } catch (e) {
    assignErr.value = e.message || '库存查询失败'
  }
}

async function assign () {
  assigning.value = true
  assignErr.value = ''
  try {
    const ids = assignRows.value.map(r => r.id)
    if (!ids.length) { assignErr.value = '没有可绑定的库存行'; return }
    await whApi.locationAssign({ inventory_ids: ids, location_id: assignForm.value.location_id })
    showAssign.value = false
    await load()
  } catch (e) {
    assignErr.value = e.message || '绑定失败'
  } finally {
    assigning.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.wl-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.wl-filter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px }
.wl-f { display: flex; flex-direction: column; gap: 4px }
.wl-lb { font-size: 12px; color: var(--t3) }
.wl-sel { min-width: 160px }
.wl-act-th { text-align: right }
.wl-act { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap }

.wl-modal-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.38);
  display: flex; align-items: center; justify-content: center; z-index: 60; padding: 18px;
}
.wl-modal { width: 460px; max-width: 100%; max-height: 88vh; overflow: auto; padding: 18px }
.wl-modal-lg { width: 720px }
.wl-modal-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px }
.wl-modal-hd h3 { font-size: 16px }
.wl-x { border: none; background: transparent; cursor: pointer; color: var(--t2); padding: 4px }
.wl-form { display: flex; flex-direction: column; gap: 12px }
.wl-f-wide { width: 100% }
.wl-tip { font-size: 12px; color: var(--t2); margin: 4px 0 0 }
.wl-fe { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 10px }
.wl-modal-ft { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px }
.wl-ar { max-height: 42vh; overflow: auto; margin-top: 8px }
.btn.danger { color: var(--danger, #d4380d) }
.req { color: var(--danger, #d4380d) }
</style>
