<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>{{ detail ? (detail.freeze_no || ('冻结单 #' + detail.id)) : pageTitle }}</h2>
        <span class="page-sub">{{ detail ? subDetail : pageSub }}</span>
      </div>
      <div class="sfz-acts">
        <template v-if="detail">
          <button class="btn btn-ghost btn-sm" @click="backToList">返回列表</button>
          <button class="btn btn-ghost btn-sm" :disabled="busy" @click="loadDetail(detail.id)">
            <Icon name="refresh" :size="14" />刷新
          </button>
          <button v-if="detail.status === 'active'" class="btn btn-primary btn-sm"
                  :disabled="busy" @click="doRelease(detail.id, detail.freeze_no)">
            <Icon name="check" :size="14" />释放冻结
          </button>
        </template>
        <template v-else>
          <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadList()">
            <Icon name="refresh" :size="14" />刷新
          </button>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="showCreate = !showCreate">
            <Icon name="plus" :size="14" />新建冻结单
          </button>
        </template>
      </div>
    </div>

    <!-- ==================== 列表模式 ==================== -->
    <template v-if="!detail">
      <template v-if="!loading && !err">
        <div class="card kpi-strip cols-4">
          <div class="kpi">
            <div class="kpi-label">进行中</div>
            <div class="kpi-val val-warn">{{ cnt.active }}</div>
            <div class="kpi-sub">快照仍是计数基准</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">已释放</div>
            <div class="kpi-val val-ok">{{ cnt.released }}</div>
            <div class="kpi-sub">盘点已结束</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">快照商品</div>
            <div class="kpi-val">{{ cnt.items }}</div>
            <div class="kpi-sub">在所有冻结单明细里的行数合计</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">冻结单合计</div>
            <div class="kpi-val">{{ rows.length }}</div>
            <div class="kpi-sub">{{ scopeLabel }} · 最近 {{ LIST_LIMIT }} 单</div>
          </div>
        </div>

        <!-- 新建区（内联，不弹窗 —— 与本组其它页一致） -->
        <div v-if="showCreate" class="card sfz-new">
          <div class="sfz-new-hd">
            <Icon name="plus" :size="14" />
            <span>新建{{ scopeLabel }}</span>
            <span class="sfz-new-sub">给当前库存拍一张快照，作为盘点期间的计数基准</span>
          </div>
          <div class="sfz-new-row">
            <div class="sfz-fld">
              <label class="sfz-lb">仓库</label>
              <select v-model.number="form.warehouse_id" class="input">
                <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
              </select>
            </div>
            <div class="sfz-fld sfz-fld-grow">
              <label class="sfz-lb">冻结原因（选填）</label>
              <input v-model.trim="form.reason" class="input" maxlength="60" placeholder="如：月末全盘 / 抽盘 A 区" />
            </div>
          </div>

          <div v-if="isPartial" class="sfz-pick">
            <div class="sfz-pick-hd">
              <Icon name="package" :size="14" />
              <span>参与盘点的商品</span>
              <span class="sfz-new-sub">部分盘点**必须**至少选 1 个商品，否则后端不会建单</span>
            </div>
            <div class="sfz-pick-add">
              <div class="sfz-fld sfz-fld-grow">
                <label class="sfz-lb">搜索并添加商品</label>
                <ProductCombo :row="pickRow" :products="products" @pick="onPickProduct" />
              </div>
            </div>
            <div v-if="picked.length" class="sfz-chips">
              <span v-for="p in picked" :key="p.id" class="sfz-chip">
                {{ p.name }}
                <button class="sfz-chip-x" title="移除" @click="removePicked(p.id)">
                  <Icon name="close" :size="11" />
                </button>
              </span>
            </div>
            <p v-else class="sfz-pick-none">还没有选择商品。</p>
          </div>

          <div class="sfz-new-foot">
            <button class="btn btn-primary btn-sm" :disabled="busy || (isPartial && !picked.length)"
                    :title="isPartial && !picked.length ? '部分盘点至少选 1 个商品' : ''"
                    @click="doCreate">
              <Icon name="check" :size="14" />创建冻结单
            </button>
            <button class="btn btn-ghost btn-sm" :disabled="busy" @click="cancelCreate">取消</button>
            <span class="sfz-new-note">
              {{ isPartial ? `将冻结 ${picked.length} 个商品的库存快照`
                           : '将冻结当前仓库里所有有货商品的库存快照' }}
            </span>
          </div>
        </div>

        <div v-if="!rows.length" class="card">
          <div class="state-empty">
            <div class="se-ic"><Icon name="inbox" :size="22" /></div>
            <p>还没有{{ scopeLabel }}。</p>
            <p class="sfz-empty-hint">点右上角「新建冻结单」即可 —— 系统会给当前库存拍一张快照。</p>
          </div>
        </div>

        <div v-else class="card sfz-card">
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th>冻结单号</th>
                  <th>状态</th>
                  <th>仓库</th>
                  <th class="num">快照商品</th>
                  <th>原因</th>
                  <th>创建时间</th>
                  <th>释放时间</th>
                  <th style="width:110px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in rows" :key="r.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td class="sfz-mono">{{ r.freeze_no || ('#' + r.id) }}</td>
                  <td><span class="tag" :class="r.status === 'active' ? 'warn' : 'ok'">{{ statusText(r.status) }}</span></td>
                  <td class="sfz-dim">{{ whName(r.warehouse_id) }}</td>
                  <td class="num">{{ r.item_count || 0 }}</td>
                  <td class="sfz-dim">{{ r.reason || '—' }}</td>
                  <td class="sfz-time">{{ dt(r.created_at) }}</td>
                  <td class="sfz-time">{{ r.released_at ? dt(r.released_at) : '—' }}</td>
                  <td class="sfz-op-cell">
                    <button class="sfz-op" @click="openDetail(r.id)">查看</button>
                    <button v-if="r.status === 'active'" class="sfz-op" :disabled="busy"
                            @click="doRelease(r.id, r.freeze_no)">释放</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p class="sfz-foot">
          口径：创建冻结单时按<b>当前库存</b>拍一张快照（{{ isPartial ? '只含所选商品' : '含本仓所有有货商品' }}），
          盘点期间以这张快照为<b>计数基准</b>，核对完点「释放」结束冻结。
          <b>冻结不阻止出库、也不改库存</b> —— 它是权威快照与状态标识，不是库存闸门。
          ⚠️ 本页与「盘点单」<b>互不联动</b>：在这里释放<b>不会</b>完成任何盘点期次；
          要录实盘数、把差异落到库存，请去「盘点单」（或本组「盘点差异单」看结果）。
        </p>
      </template>

      <Skeleton v-else-if="loading" />

      <div v-else class="state-error">
        <div class="se-ic"><Icon name="alert" :size="22" /></div>
        <p>{{ err }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadList()">重试</button>
      </div>
    </template>

    <!-- ==================== 明细模式 ==================== -->
    <template v-else>
      <template v-if="!dLoading && !dErr">
        <div class="card kpi-strip cols-4">
          <div class="kpi">
            <div class="kpi-label">状态</div>
            <div class="kpi-val" :class="detail.status === 'active' ? 'val-warn' : 'val-ok'">
              {{ statusText(detail.status) }}
            </div>
            <div class="kpi-sub">{{ detail.status === 'active' ? '快照仍有效' : '已释放' }}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">快照商品</div>
            <div class="kpi-val">{{ items.length }}</div>
            <div class="kpi-sub">快照里的商品行数</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">快照数量</div>
            <div class="kpi-val">{{ fmtQty(totalQty) }}</div>
            <div class="kpi-sub">各行数量合计</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">冻结范围</div>
            <div class="kpi-val sfz-scope-val">{{ detail.scope === 'partial' ? '部分' : '整仓' }}</div>
            <div class="kpi-sub">{{ whName(detail.warehouse_id) }}</div>
          </div>
        </div>

        <div v-if="detail.status === 'active'" class="sfz-tip">
          <Icon name="lightbulb" :size="14" />
          这张快照仍是计数基准。核对完成后点右上角「释放冻结」结束 —— 释放<b>只改状态</b>，不动库存。
        </div>
        <div v-else class="sfz-lock">
          <Icon name="check" :size="14" />已释放，快照只作历史留痕，只能查看。
        </div>

        <div class="sfz-meta">
          <span><b>原因：</b>{{ detail.reason || '—' }}</span>
          <span><b>创建：</b>{{ dt(detail.created_at) }}</span>
          <span><b>释放：</b>{{ detail.released_at ? dt(detail.released_at) : '—' }}</span>
          <span v-if="detail.operator_id"><b>操作人：</b>{{ detail.operator_id }}</span>
        </div>

        <div class="card sfz-card">
          <div class="table-wrap">
            <table class="tbl sfz-tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th style="width:40%">商品</th>
                  <th>商品编号</th>
                  <th class="num" style="width:150px">快照数量</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in items" :key="it.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td><div class="sfz-name">{{ it.product_name || ('商品#' + it.product_id) }}</div></td>
                  <td class="sfz-dim">{{ it.product_id }}</td>
                  <td class="num">{{ fmtQty(it.quantity) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <div v-else-if="dLoading" class="state-empty">加载中…</div>

      <div v-else class="state-error">
        <div class="se-ic"><Icon name="alert" :size="22" /></div>
        <p>{{ dErr }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadDetail(detail.id)">重试</button>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 静态盘点单（仓配管理 · 库存作业 · P2）—— 数据源：**既有** `/api/stock-freezes`（v108）。
   ------------------------------------------------------------------
   🔴 一个组件参数化两次：`scope='full'` → 「静态盘点单（整仓）」；
      `scope='partial'` → 「静态盘点单（部分）」。两者的列表/明细/释放**完全同构**，
      只有「新建时要不要选商品」一点不同 ⇒ 拆成两个页面文件必然漂移。

   🔴 与 P1「盘点单」的分工（别合并！）：
      · 本页 = **冻结快照 + 状态标识**（`stock_freezes`，v108 旧前端建的）。不改库存。
      · P1「盘点单」= **录实盘数 + 差异落库存**（`wh_stock_takes`，v465e）。
      两者**没有任何数据联动**：这里的「释放」不会完成任何盘点期次。页面口径已写明。
      这不是疏漏 —— 冻结单自己的 docstring 就说「不强制阻止出库」「以快照为计数基准」。

   ⚠️ 计数口径与兄弟页一致：列表模式**一次拉全 + 本地筛选/计数**
      （KPI 与表格读同一个数组 ⇒ 结构上不可能出现「KPI 说 3 张、表里 2 行」）。
      后端 `/list` **没有 scope 参数**，所以整仓/部分是在前端按 `scope` 筛的。

   ⚠️ `partial` 的后端行为：`create_stock_freeze` 在 `product_ids` 为空时
      **删掉刚建的单并返回 None**（不报错）⇒ 路由层返回 `success:false`。
      本页因此**在前端就禁掉**「没选商品」的提交按钮，不让用户走到那句失败。 */

import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { toast, confirm } from '../../store'
import ProductCombo from '../inventory/new/ProductCombo.vue'

const props = defineProps({
  /** 'full' = 整仓 · 'partial' = 部分（按商品） */
  scope: { type: String, default: 'full' },
})

const LIST_LIMIT = 200

const isPartial = computed(() => props.scope === 'partial')
const scopeLabel = computed(() => (isPartial.value ? '静态盘点单（部分）' : '静态盘点单（整仓）'))
const pageTitle = scopeLabel
const pageSub = computed(() => (isPartial.value
  ? '按所选商品冻结库存快照 · 盘点期间以快照为计数基准 · 随时可释放'
  : '冻结整仓库存快照 · 盘点期间以快照为计数基准 · 随时可释放'))

const loading = ref(true)
const err = ref('')
const busy = ref(false)
const rows = ref([])          // 已按 scope 筛过的本范围冻结单

const detail = ref(null)
const dLoading = ref(false)
const dErr = ref('')
const items = ref([])

const products = ref([])
const warehouses = ref([])

const showCreate = ref(false)
const form = ref({ warehouse_id: 1, reason: '' })
const pickRow = ref({ product_id: 0 })
const picked = ref([])        // [{id, name}]

const cnt = computed(() => {
  const c = { active: 0, released: 0, items: 0 }
  rows.value.forEach(r => {
    if (r.status === 'active') c.active += 1
    else c.released += 1
    c.items += Number(r.item_count || 0)
  })
  return c
})
const totalQty = computed(() => items.value.reduce((s, it) => s + Number(it.quantity || 0), 0))

const subDetail = computed(() => {
  const d = detail.value
  return statusText(d.status) + ' · ' + (d.scope === 'partial' ? '部分商品' : '整仓')
    + ' · ' + (d.status === 'active' ? '快照仍有效，可释放' : '已释放')
})

function statusText (s) { return s === 'active' ? '进行中' : (s === 'released' ? '已释放' : (s || '—')) }
function dt (s) { return String(s || '').replace('T', ' ').slice(0, 16) }
function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}
function whName (id) {
  const w = warehouses.value.find(x => Number(x.id) === Number(id))
  return w ? w.name : ('仓库#' + id)
}

async function loadRefs () {
  const [p, w] = await Promise.allSettled([whApi.products(), whApi.warehouses()])
  products.value = p.status === 'fulfilled' ? p.value : []
  warehouses.value = w.status === 'fulfilled' ? w.value : []
  if (warehouses.value.length && !warehouses.value.some(x => Number(x.id) === 1)) {
    form.value.warehouse_id = warehouses.value[0].id
  }
}

async function loadList () {
  loading.value = true
  err.value = ''
  try {
    const all = await whApi.freezeList(LIST_LIMIT)
    /* 后端 `/list` 无 scope 参数 ⇒ 本地筛。三个兄弟页共用同一个端点，各筛各的。 */
    rows.value = (Array.isArray(all) ? all : []).filter(r => (r.scope || 'full') === props.scope)
  } catch (e) {
    err.value = e.message || '冻结单读取失败'
  } finally {
    loading.value = false
  }
}

async function loadDetail (fid) {
  dLoading.value = true
  dErr.value = ''
  try {
    const d = await whApi.freezeGet(fid)
    if (!d || !d.id) throw new Error('冻结单不存在')
    detail.value = d
    items.value = Array.isArray(d.items) ? d.items : []
  } catch (e) {
    dErr.value = e.message || '冻结单明细读取失败'
  } finally {
    dLoading.value = false
  }
}

function openDetail (fid) {
  detail.value = { id: fid }
  items.value = []
  loadDetail(fid)
}
function backToList () {
  detail.value = null
  items.value = []
  loadList()
}

function cancelCreate () {
  showCreate.value = false
  pickRow.value = { product_id: 0 }
  picked.value = []
}
function onPickProduct (row, p) {
  if (!p) return
  if (!picked.value.some(x => Number(x.id) === Number(p.id))) {
    picked.value = picked.value.concat([{ id: p.id, name: p.name || ('商品#' + p.id) }])
  } else {
    toast('这个商品已经在清单里了', 'warn')
  }
  pickRow.value = { product_id: 0 }
}
function removePicked (id) {
  picked.value = picked.value.filter(x => Number(x.id) !== Number(id))
}

async function doCreate () {
  if (busy.value) return
  if (isPartial.value && !picked.value.length) {
    toast('部分盘点至少选 1 个商品', 'warn')
    return
  }
  const scopeTxt = isPartial.value ? `${picked.value.length} 个商品` : '整仓所有有货商品'
  if (!await confirm(`创建${scopeLabel.value}？\n\n会给当前库存（${scopeTxt}·${whName(form.value.warehouse_id)}）拍一张快照。\n快照只读、不改库存，随时可以释放。`)) return
  busy.value = true
  try {
    const body = {
      warehouse_id: Number(form.value.warehouse_id || 1),
      scope: props.scope,
      reason: form.value.reason || '',
    }
    if (isPartial.value) body.product_ids = picked.value.map(x => Number(x.id))
    const r = await whApi.freezeCreate(body)
    if (!r || r.success === false) throw new Error((r && r.error) || '创建失败')
    toast('冻结单已创建', 'success')
    cancelCreate()
    openDetail(r.id)
  } catch (e) {
    toast(e.message || '创建冻结单失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doRelease (fid, no) {
  if (busy.value) return
  if (!await confirm(`释放冻结单 ${no || ('#' + fid)}？\n\n释放后快照只作历史留痕，不再作为计数基准。\n⚠️ 释放**不会**改库存，也**不会**完成任何盘点期次。`)) return
  busy.value = true
  try {
    await whApi.freezeRelease(fid)
    toast('已释放', 'success')
    if (detail.value) await loadDetail(detail.value.id)
    else await loadList()
  } catch (e) {
    toast(e.message || '释放失败', 'error')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await Promise.allSettled([loadRefs(), loadList()])
})
defineExpose({ load: loadList })
</script>

<style scoped>
/* 页面私有类一律 `sfz-` 前缀（仓配·静态盘点单），避免与兄弟页串味。 */
.sfz-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

.sfz-card { padding: 0; overflow: hidden }
.sfz-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.sfz-time { font-size: 12px; color: var(--t3) }
.sfz-dim { color: var(--t3); font-size: 12px }
.sfz-scope-val { font-size: 18px }

.sfz-op-cell { white-space: nowrap }
.sfz-op {
  border: none; background: none; padding: 0; margin-right: 10px; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.sfz-op:last-child { margin-right: 0 }
.sfz-op:hover { text-decoration: underline }
.sfz-op:disabled { color: var(--t3); cursor: not-allowed; text-decoration: none }

.sfz-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }
.sfz-empty-hint { font-size: 12px; color: var(--t3); margin-top: 6px }

.sfz-tip, .sfz-lock {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg2); color: var(--t2);
}
.sfz-tip { border-left: 3px solid var(--p) }
.sfz-lock { border-left: 3px solid var(--ok); color: var(--ok) }

.sfz-meta {
  display: flex; flex-wrap: wrap; gap: 18px;
  margin-bottom: 12px; font-size: 12px; color: var(--t2);
}
.sfz-meta b { color: var(--t3); font-weight: 500 }

.sfz-tbl { table-layout: fixed }
.sfz-name { font-weight: 500 }

/* 新建区 */
.sfz-new { margin-bottom: 12px }
.sfz-new-hd {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--t2); margin-bottom: 12px;
}
.sfz-new-sub { font-size: 12px; font-weight: 400; color: var(--t3) }
.sfz-new-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.sfz-fld { display: flex; flex-direction: column; gap: 4px; min-width: 170px }
.sfz-fld-grow { flex: 1; min-width: 240px }
.sfz-lb { font-size: 12px; color: var(--t3); white-space: nowrap }

.sfz-pick {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px dashed var(--border-subtle);
}
.sfz-pick-hd {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--t2); margin-bottom: 10px;
}
.sfz-pick-add { margin-bottom: 10px }
.sfz-pick-none { font-size: 12px; color: var(--t3) }

.sfz-chips { display: flex; flex-wrap: wrap; gap: 8px }
.sfz-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 6px 3px 10px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg2); color: var(--t2);
}
.sfz-chip-x {
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; padding: 0; cursor: pointer; color: var(--t3);
}
.sfz-chip-x:hover { color: var(--dan) }

.sfz-new-foot {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.sfz-new-note { font-size: 12px; color: var(--t3) }
</style>
