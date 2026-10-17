<script setup>
/* ---- 按比例分摊弹窗（F5 从 Forecast.vue 抽离的懒加载叶子）----
   🔴 抽离铁律：函数体一字不改，只动「组件边界 + props/emits」。
   父组件保留 allocOpen / allocRow 两个 ref：「分摊」按钮在**中央网格每一行**，
   需要把本次要分摊的行传给本弹窗；前置校验（单人/无人/无期次）也留在父级。
   🔴 写操作收口：本组件**不直接写中央网格**。applyAlloc 只调后端 API，
      完成后 emit('applied', payload)，由父组件做网格回填（row.extraQty）
      + saveDraftNow() + loadPtGap() + loadCross() —— 与 AuditPanel emit('reload') 同模式。
   🔴 样式随组件自含（本文件 <style scoped>）—— 见 v558 判据：
      scoped 父组件的 data-v 只打在子组件根元素上，样式必须一起搬。 */
import { ref, computed, watch, onMounted } from 'vue'
import { productTargetsApi } from '../../api/modules'
import { fmt } from '../../utils/forecast/format.js'
import { toast } from '../../store'
import Icon from '../Icon.vue'

const props = defineProps({
  cross:        { type: Object,   default: null },
  row:          { type: Object,   default: null },   // = 父级 allocRow（本次要分摊的编辑态行）
  ptAlloc:      { type: Object,   default: null },   // product_id → extra-alloc item（预留）
  numInput:     { type: Function, required: true },
  numCommit:    { type: Function, required: true },
  loadPtGap:    { type: Function, required: true },
  canDo:        { type: Function, required: true },
})
const emit = defineEmits(['close', 'applied'])

const allocBusy = ref(false)          // 正在读 setup / 正在应用
const allocPrev = ref(false)          // 正在预演（只影响按钮文案，不锁输入）
/* ── v336：本商品的分摊占比是不是**推导出来的**（无目标 ⇒ 按本期报单量）──────────
   `true` 时：比例**只读**（它由报单事实推出，不由人手改）、无档案可写、
             「应用」= 只把加单量回填本行；界面文案全部换成"按报单量"口径。
   🔴 判据取**后端 setup 的 `basis`**，不在前端猜（猜 = 第二份实现，迟早与后端分叉）。 */
const allocIsDerived = computed(() =>
  String((allocSetup.value && allocSetup.value.basis) || '') === 'reported')
/* ── v339（P1）：占比是**本期临时设定**的 ──────────────────────────────────────
   `true` 时：占比可改，改动存进「本期临时占比」、**只影响本期**（不写商品目标档案）。
   老板原话：「**L2 的比例『临时改只影响本期』放 P1**」。
   🔴 判据取后端 setup 的 `basis`（与 `allocIsDerived` 同一条纪律：不在前端猜 —— 猜就是
      第二份实现，迟早与后端分叉）。 */
const allocIsOverride = computed(() =>
  String((allocSetup.value && allocSetup.value.basis) || '') === 'override')
/* 占比**能不能改** —— v339 起判据只有一条：本期有没有可分摊对象。
   ⚠️ 旧版把 `reported`（按报单量推导）设为**只读** —— 那等于对用户说
      "想按本月实际情况调？先去建个商品目标吧"，而他要的只是**这一期**的分法。
   · target   ⇒ 改 = 写档案（**全期生效**），既有行为不变；
   · reported ⇒ 改 = 存本期临时占比（v339 新增，只影响本期）；
   · override ⇒ 继续改本期那一份（再改就覆盖）。 */
const allocRatioEditable = computed(() => !!allocSetup.value && !allocFlags.value.no_members)
const allocErr = ref('')
const allocSetup = ref(null)          // setup 接口的 data
const allocRows = ref([])             // 预演结果（**唯一权威**：加单/定稿两列直接读它）
const allocSummary = ref(null)        // 预演 summary（fully_applied / ratio_gap / clip_gap）
const allocRatioTotal = ref(0)
const allocRatioOk = ref(false)
const allocTargetId = ref(0)
const allocFlags = ref({})
const allocTotalRaw = ref('')         // 总量输入框的**原串**（见下方"为什么存原串"）
const allocRatiosRaw = ref({})        // {eid: '占比原串'}
const allocAllocsRaw = ref({})        // {eid: '加单原串'}（显示用；每轮预演后回填）
const allocArchiveRatios = ref({})    // 档案原比例（供「恢复档案原比例」）
const allocFocusEid = ref(0)          // 当前聚焦的「加单(箱)」输入框所属人（防预演回填打断输入）
let _allocSeq = 0
let _allocTimer = null

/* 为什么三列数字都存**原串**而不直接存 number：
   `Number("12.")` = 12 ⇒ 若边打边把数字写回 `:value`，用户**永远打不出小数点**
   （敲了 `.` 立刻被抹掉）——与编辑网格 `numCommit` 的注释踩的是同一件事。
   故：输入期只做全角折算 + 存原串；**离开这一格（@change）**才收敛成数字并触发联动。 */
const _r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000
const _r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const _allocPid = () => Number((props.cross.value && props.cross.value.period && props.cross.value.period.id) || 0)

function allocRowRef(r) {
  // 模板里的 `r` 就是 `cross.rows` 的元素（编辑态唯一实例）⇒ 一般直接可用；
  // 这里再按 product_id 定一次位，避免"传进来的其实是只读表那份副本"时把值写丢。
  const pid = Number(r && r.product_id)
  const rows = (props.cross.value && props.cross.value.rows) || []
  return rows.find(x => Number(x.product_id) === pid) || r
}

function syncAllocAllocsFromRows() {
  const m = {}
  ;(allocRows.value || []).forEach(x => {
    const e = Number(x.employee_id)
    if (e !== Number(allocFocusEid.value || 0)) m[e] = String(_r3(x.alloc_box))
  })
  // 正在打字的那一格保留用户原串（预演回填不得打断输入）
  const fe = Number(allocFocusEid.value || 0)
  if (fe && allocAllocsRaw.value[fe] != null) m[fe] = allocAllocsRaw.value[fe]
  allocAllocsRaw.value = m
}

async function runAllocPreview() {
  const data = allocSetup.value
  const periodId = _allocPid()
  const pid = Number(data && data.product && data.product.id) || 0
  if (!data || !periodId || !pid) return
  const seq = ++_allocSeq
  allocPrev.value = true
  try {
    const ratios = Object.keys(allocRatiosRaw.value).map(k => ({
      employee_id: Number(k), ratio: _allocNum(allocRatiosRaw.value[k]),
    }))
    const d = await productTargetsApi.extraAllocPreview({
      periodId, productId: pid,
      totalDelta: _allocNum(allocTotalRaw.value),
      ratios,
    })
    if (seq !== _allocSeq) return              // 过期响应直接丢弃（连点/连改会并发多个请求）
    const dd = (d && d.data) || null
    allocRows.value = (dd && dd.rows) || []
    allocSummary.value = (dd && dd.summary) || null
    allocRatioTotal.value = dd ? Number(dd.ratio_total) : 0
    allocRatioOk.value = dd ? !!dd.ratio_ok : false
    allocTargetId.value = dd ? (Number(dd.target_id) || 0) : 0
    allocFlags.value = (dd && dd.flags) || {}
    allocErr.value = ''
    syncAllocAllocsFromRows()
  } catch (e) {
    if (seq !== _allocSeq) return
    allocErr.value = (e && e.message) || '预演失败'
  } finally {
    if (seq === _allocSeq) allocPrev.value = false
  }
}
function allocPreviewSoon() {
  if (_allocTimer) clearTimeout(_allocTimer)
  _allocTimer = setTimeout(() => { _allocTimer = null; runAllocPreview() }, 260)
}


/* 打开后的数据加载：父级 openAlloc 校验通过、allocOpen=true 挂载本组件时触发 */
async function loadAllocSetup() {
  const row = props.row.value
  if (!row) return
  const pid = Number(row.product_id) || 0
  const periodId = _allocPid()
  if (!pid || !periodId) return
  allocSetup.value = null
  allocRows.value = []
  allocSummary.value = null
  allocErr.value = ''
  allocFlags.value = {}
  allocTargetId.value = 0
  allocRatioOk.value = false
  allocRatioTotal.value = 0
  allocArchiveRatios.value = {}
  allocRatiosRaw.value = {}
  allocAllocsRaw.value = {}
  allocFocusEid.value = 0
  allocTotalRaw.value = String(_r3(row.extraQty))
  allocBusy.value = true
  try {
    const d = await productTargetsApi.extraAllocSetup(periodId, pid)
    // 期间用户可能关了、或又点了别的商品 ⇒ 只在"还是这一个商品"时才落盘
    if (!props.open.value || !props.row.value || Number(props.row.value.product_id) !== pid) return
    const data = (d && d.data) || null
    allocSetup.value = data
    if (data) {
      // 总量的初值：优先用接口给的"经理填的"（本行可能还没进编辑），否则用本行当前值
      const cur = Number(data.total_delta) || 0
      if (cur) allocTotalRaw.value = String(_r3(cur))
      const arch = {}, raw = {}
      ;(data.members || []).forEach(m => {
        const e = Number(m.employee_id) || 0
        if (!e) return
        arch[e] = Number(m.ratio) || 0
        raw[e] = String(_r2(m.ratio))
      })
      allocArchiveRatios.value = arch
      allocRatiosRaw.value = raw
    }
    await runAllocPreview()
  } catch (e) {
    allocErr.value = (e && e.message) || '读取分摊依据失败'
    toast('读取分摊依据失败：' + allocErr.value, 'err')
  } finally {
    allocBusy.value = false
  }
}

/* 关闭：交还父组件统一清 allocOpen / allocRow（单一收口，避免两边各清一半） */
function closeAlloc() { emit('close') }

/* 总量（改完离开这一格 ⇒ 联动重算） */
function onAllocTotalInput(e) { props.numInput(e, (v) => { allocTotalRaw.value = v }) }
function onAllocTotalCommit(e) {
  const v = _allocNum(e && e.target ? e.target.value : allocTotalRaw.value)
  allocTotalRaw.value = String(v)
  loadAllocArchivedRatiosIfEmpty()
  runAllocPreview()
}
/* 占比（同上；比例始终是"输入源"，预演**不回写**它） */
function onAllocRatioInput(e, eid) { props.numInput(e, (v) => { allocRatiosRaw.value[eid] = v }) }
function onAllocRatioCommit(e, eid) {
  const v = _allocNum(e && e.target ? e.target.value : allocRatiosRaw.value[eid])
  allocRatiosRaw.value[eid] = String(v)
  runAllocPreview()
}
function loadAllocArchivedRatiosIfEmpty() {
  // setup 没回来时（极少数：接口失败）用户仍可能改总量 ⇒ 至少让比例有一份可算的值
  const raw = allocRatiosRaw.value || {}
  if (Object.keys(raw).length) return
  const arch = allocArchiveRatios.value || {}
  const m = {}
  Object.keys(arch).forEach(k => { m[k] = String(_r2(arch[k])) })
  allocRatiosRaw.value = m
}

/* 加单(箱) 直接改 ⇒ **反向回推比例**：rᵢ := aᵢ / Σa × 100，并把总量改为 Σa。
   为什么双向都要收敛：只改 aᵢ 而不改 rᵢ 会让 Σaᵢ ≠ 总量，而 `allocate()` 是按占比算的
   ⇒ 下一次预演会把用户刚填的数**改回去**（"填了没用"）。两条路径必须同时收敛。
   🔴 归一化是**公开的界面规则**（不是 `allocate` 的第二份实现）：它只做"按权重缩放"，
     不碰夹断/重分 —— 那部分仍只由后端算。 */
function onAllocAllocInput(e, eid) { props.numInput(e, (v) => { allocAllocsRaw.value[eid] = v }) }
function onAllocAllocCommit(e, eid) {
  const rows = allocRows.value || []
  if (!rows.length) return
  const v = _allocNum(e && e.target ? e.target.value : allocAllocsRaw.value[eid])
  allocAllocsRaw.value[eid] = String(v)
  const want = {}          // {eid: 用户想要的加单量}
  rows.forEach(x => {
    const k = Number(x.employee_id)
    want[k] = (k === Number(eid)) ? v
      : _allocNum(allocAllocsRaw.value[k] != null ? allocAllocsRaw.value[k] : _r3(x.alloc_box))
  })
  const sum = Object.keys(want).reduce((s, k) => s + (Number(want[k]) || 0), 0)
  if (Math.abs(sum) < 1e-9) { toast('各人的加单量合计为 0，无法反推占比', 'warn'); runAllocPreview(); return }
  // 归一化到 Σ=100（保留 2 位；尾差补到**绝对值最大**的那一项，避免末位 99.99/100.01 抖动）
  const keys = Object.keys(want)
  const raw = keys.map(k => (Number(want[k]) || 0) / sum * 100)
  const rnd = raw.map(x => Math.round(x * 100) / 100)
  let resid = Math.round((100 - rnd.reduce((s, x) => s + x, 0)) * 100) / 100
  if (Math.abs(resid) >= 0.005) {
    let bi = 0
    rnd.forEach((x, i) => { if (Math.abs(raw[i]) > Math.abs(raw[bi])) bi = i })
    rnd[bi] = Math.round((rnd[bi] + resid) * 100) / 100
  }
  const newRaw = {}
  keys.forEach((k, i) => { newRaw[k] = String(rnd[i]) })
  allocRatiosRaw.value = newRaw
  allocTotalRaw.value = String(_r3(sum))
  runAllocPreview()
}

/* 平均分配：Σ 精确 = 100，尾差给最后一人（与 `ProductTarget.vue::splitEven` 同规则） */
function allocSplitEven() {
  const rows = allocRows.value || []
  if (!rows.length) return
  const n = rows.length
  const base = Math.round((100 / n) * 100) / 100
  const raw = {}
  rows.forEach((x, i) => {
    const e = Number(x.employee_id)
    raw[e] = String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base)
  })
  allocRatiosRaw.value = raw
  runAllocPreview()
}
function allocResetRatios() {
  const arch = allocArchiveRatios.value || {}
  const raw = {}
  Object.keys(arch).forEach(k => { raw[k] = String(_r2(arch[k])) })
  allocRatiosRaw.value = raw
  runAllocPreview()
}
function allocRatiosChanged() {
  const arch = allocArchiveRatios.value || {}
  const raw = allocRatiosRaw.value || {}
  const ks = Object.keys(raw)
  if (ks.length !== Object.keys(arch).length) return true
  for (const k of ks) {
    if (Math.abs(_allocNum(raw[k]) - (Number(arch[k]) || 0)) > 0.005) return true
  }
  return false
}
/* `parseNumInput` 解析失败时会**保留原串**（这是它的既有契约，见 Q18 注释）⇒ 这里必须再收敛
   成有限数字，否则 `Math.abs('abc')` = NaN 会顺手把整块界面染成 NaN。 */
function _allocNum(v) {
  const n = parseNumInput(v)
  return (typeof n === 'number' && isFinite(n)) ? n : 0
}
function allocTotalNum() { return _allocNum(allocTotalRaw.value) }
function allocAllocNum(eid) {
  const raw = allocAllocsRaw.value[eid]
  if (raw != null) return _allocNum(raw)
  const r = (allocRows.value || []).find(x => Number(x.employee_id) === Number(eid))
  return r ? Number(r.alloc_box) || 0 : 0
}

/* 应用：① 比例写目标档案（全期生效，仅在改动时写）② 加单量回填本行（仍随「保存」落库） */
async function applyAlloc() {
  const data = allocSetup.value, row = props.row.value
  if (!data || !row || allocBusy.value) return
  if (allocRatioOk.value !== true) {
    toast(`占比合计 ${fmt(allocRatioTotal.value)}%，必须等于 100% 才能应用到目标档案`, 'warn'); return
  }
  const tid = Number(allocTargetId.value) || 0
  // ── v339（P1）：占比存到哪 —— **两条不同的写路**，由 `basis` 决定（判据来自后端）──
  //   · 'target'                ⇒ 写**商品目标档案**（`PUT /product-targets/{tid}`），
  //                                 **全期生效**（v318 既有行为，不变）；
  //   · 'reported' / 'override' ⇒ 写**本期临时占比**（`PUT .../extra-alloc/override`），
  //                                 **只影响本期**、不碰档案（v339 新增）。
  //   🔴 旧实现把 'reported' 的 `changed` 直接置 `false` ⇒ 用户改了比例、点「应用」、
  //      看到「记得点保存」、保存后**比例回到原样** —— 而且**全程零报错**。
  //      这正是本项目反复栽的那类「界面允许你改、保存后无声丢失」。
  const _basis = String((allocSetup.value && allocSetup.value.basis) || 'target')
  const _derived = (_basis === 'reported')
  const _ovr = (_basis === 'override')
  // 本期临时占比这条路（L2 推导 / 已被覆盖）**不需要**目标档案 ⇒ 没有 tid 也合法
  const _periodPath = (_derived || _ovr)
  if (!tid && !_periodPath) {
    toast('该商品本月没有启用的目标，比例无处可存（请先到「商品目标」页建目标）', 'err'); return
  }
  const changed = allocRatiosChanged()
  const _pid = Number((data.product && data.product.id) || 0)
  const _periodId = _allocPid()
  allocBusy.value = true
  try {
    if (changed) {
      if (_periodPath) {
        // v339：本期临时占比（**只影响本期**）。整组提交 —— 占比是一组相互约束的值（Σ=100），
        //   逐行 upsert 会让并发读取侧读到"合计不是 100%"的中间态。
        await productTargetsApi.extraAllocOverride({
          periodId: _periodId, productId: _pid,
          ratios: (allocRows.value || []).map(x => ({
            employee_id: Number(x.employee_id),
            ratio: _allocNum(allocRatiosRaw.value[Number(x.employee_id)]),
          })),
        })
      } else {
        // 全量提交（`_write_allocs` 是整体替换）—— 保持与档案同样的排序（sort_no = 数组下标）
        const allocs = (allocRows.value || []).map(x => ({
          employee_id: Number(x.employee_id),
          employee_name: x.employee_name || '',
          ratio: _allocNum(allocRatiosRaw.value[Number(x.employee_id)]),
        }))
        await productTargetsApi.update(tid, { allocs })
      }
    }
    /* 写网格统一交给父级执行（emit('applied')），本组件不直接改 cross.rows */
    emit('applied', { extraQty: allocTotalNum() })
    // toast 必须按**实际写了什么**说 —— 说错就是让用户对"全期比例变没变"产生错误预期。
    toast(_periodPath
      ? (changed
        ? '已保存本期临时占比（**只影响本期**，没改商品目标档案），并把加单量回填到本行 —— 记得点「保存」'
        : `已把加单量回填到本行 —— 本商品本期按**各人报单量**自动分给 ${(allocRows.value || []).length} 人，记得点「保存」`)
      : (changed
        ? '已更新该商品的目标档案占比（全期生效），并把加单量回填到本行 —— 记得点「保存」'
        : '已把加单量回填到本行 —— 记得点「保存」'), 'ok')
    closeAlloc()
  } catch (e) {
    toast('应用失败：' + ((e && e.message) || '未知错误'), 'err')
  } finally {
    allocBusy.value = false
    props.loadPtGap()        // 比例/分配可能已变 ⇒ 刷新角标与悬停（只读；失败静默）
  }
}

/* v339：**清除本期临时占比** —— 回到自动判据（有档案按档案、无档案按报单量）。
   这是「改错了要能退回去」的**唯一**入口：没有它，用户只能把每个人手动敲回原值，
   而且**永远回不到"没设过"的状态**（`basis` 会一直是 override，界面也就一直说"你改过"，
   可他其实想撤销）。
   ⚠️ 只清占比、**不动加单量** —— 加单量是另一件事，仍随「保存汇总表」落库。 */
async function allocClearOverride() {
  const data = allocSetup.value
  if (!data || allocBusy.value) return
  const _pid = Number((data.product && data.product.id) || 0)
  const _periodId = _allocPid()
  if (!_pid || !_periodId) { toast('当前没有可分摊的期次', 'warn'); return }
  allocBusy.value = true
  try {
    // ratios 传空数组 = 清除（后端语义：空即撤销覆盖、回落到自动判据）
    await productTargetsApi.extraAllocOverride({
      periodId: _periodId, productId: _pid, ratios: [],
    })
    toast('已清除本期临时占比 —— 该商品恢复为自动判据（有目标按目标、没有则按本期报单量）', 'ok')
    closeAlloc()
  } catch (e) {
    toast('清除失败：' + ((e && e.message) || '未知错误'), 'err')
  } finally {
    allocBusy.value = false
    props.loadPtGap()
  }
}

onMounted(() => { loadAllocSetup() })
</script>

<template>
    <!-- v318：一键分摊弹窗（编辑态「加单(箱)」格的分摊按钮唤起）—— 预演台，不是第二份分摊算法 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="open" class="imp-overlay" @click="closeAlloc"></div></Transition>
      <Transition name="pop">
        <div v-if="open" class="imp-modal alloc-modal">
          <div class="imp-hd">
            <b>按比例分摊 · {{ (allocSetup && allocSetup.product && allocSetup.product.name) || '商品' }}</b>
            <button class="imp-x" @click="closeAlloc"><Icon name="close"/></button>
          </div>
          <div class="imp-body">
            <!-- v336：前置缺失必须**分开说**（两者成因与解法完全不同）──────────────
                 · `no_members` = **真的一条都分不出去**（无目标 **且** 本期没人报过）⇒ 必须点名；
                 · `no_target`（只是没有目标）**不再**是"分不出去" —— 会走 L2
                   （按本期各人报单量推导占比），所以这里只是**说明依据变了**，表格照常显示。
                 旧文案把两者混为一谈，会把人引去建一个他并不需要的目标。 -->
            <p v-if="allocSetup && allocFlags.no_members" class="imp-tip warn-text">
              该商品<b>本期没有人报过单，也没有启用目标</b>（或目标没填分解承接人）
              ⇒ 这笔加/减单<b>一个人都分不到</b>，保存后也不会有任何人的量被调整。
              请先让业务员在「报单」里报这个商品，或到「商品目标」页为它建目标并填分解比例。
            </p>
            <p v-else-if="allocSetup && allocFlags.no_target" class="imp-tip alloc-note">
              该商品在 <b>{{ (allocSetup.product && allocSetup.product.month) || '' }}</b> 没有启用目标
              ⇒ 本次按<b>各人本期报单量</b>推导占比来分摊（客观事实，<b>比例只读</b>）。
              要让比例可调，请到「商品目标」页为它建目标并填分解比例。
            </p>
            <template v-if="allocSetup && !allocFlags.no_members">
              <div class="alloc-top">
                <label>本期{{ allocTotalNum() >= 0 ? '加单' : '减单' }}总量</label>
                <input class="cell-input alloc-num" type="text" inputmode="decimal" :value="allocTotalRaw"
                       title="正数 = 加单，负数 = 减单；改完按回车或点别处即重新联动"
                       @input="onAllocTotalInput" @change="onAllocTotalCommit">
                <span class="alloc-unit">箱</span>
                <span v-if="Number(allocSetup.product && allocSetup.product.large_ratio) > 0" class="alloc-conv">
                  ≈ {{ fmt(Math.abs(allocTotalNum()) * Number(allocSetup.product.large_ratio)) }} {{ (allocSetup.product && allocSetup.product.unit) || '小单位' }}
                </span>
              </div>
              <p v-if="allocIsOverride" class="imp-tip alloc-note">
                ⓘ 占比是<b>本期临时设定</b>的<template v-if="allocSetup.override && allocSetup.override.operator"
                  >（{{ allocSetup.override.operator }} 设定）</template> —— 改动<b>只影响本期</b>，
                不会改商品目标档案。
              </p>
              <p v-else-if="allocIsDerived" class="imp-tip alloc-note">
                ⓘ 该商品本期没有目标 ⇒ 原本按<b>各人本期报单量</b>推导占比。
                在这里改动会存成<b>本期专用</b>占比（<b>只影响本期</b>、不改商品目标档案）；
                存下之后，业务员后来补报也不会再自动改变你定下的分法。
              </p>
              <p v-else class="imp-tip alloc-note">
                ⓘ 占比来自该商品的<b>目标档案</b>。在这里改动会<b>同时改写目标档案</b> ——
                该商品<b>本月所有期次</b>的加单分摊都会跟着变（不只是本期）。
              </p>
              <div class="alloc-tbl-wrap">
                <table class="alloc-tbl">
                  <thead>
                    <tr>
                      <th>{{ (allocIsDerived || allocIsOverride) ? '报单人' : '承接人' }}</th><th class="num">占比%</th><th class="num">本期报量(箱)</th>
                      <th class="num">加单(箱)</th><th class="num">定稿(箱)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <!-- 逐行顺序 = `product_target_alloc.sort_no`（与目标档案一致，改比例时按它整表回写） -->
                    <tr v-for="x in allocRows" :key="x.employee_id">
                      <td>{{ x.employee_name || ('员工' + x.employee_id) }}</td>
                      <td class="num">
                        <!-- 占比可否改 —— 🔴 v339 改了这条判据：旧版对「按报单量推导」**只读**，
                             而 L2 商品根本没有档案可写 ⇒ 用户**没有别的入口**，
                             「想按本月实际情况调整分法」这个需求完全无解。
                             现在可改：改动存成**本期专用**占比（不写档案、只影响本期）。 -->
                        <input class="cell-input alloc-mini" type="text" inputmode="decimal"
                               :readonly="!allocRatioEditable" :class="{ 'alloc-ro': !allocRatioEditable }"
                               :title="!allocRatioEditable ? '本期没有可分摊对象'
                                       : (allocIsOverride ? '本期临时占比：改动只影响本期，不会改商品目标档案'
                                       : (allocIsDerived ? '原本按各人本期报单量推导；改动会存成本期专用占比（只影响本期）'
                                       : '来自商品目标档案；改动会同时改写档案，影响本月所有期次'))"
                               :value="allocRatiosRaw[x.employee_id] != null ? allocRatiosRaw[x.employee_id] : x.ratio"
                               @input="onAllocRatioInput($event, x.employee_id)"
                               @change="onAllocRatioCommit($event, x.employee_id)">
                      </td>
                      <td class="num">{{ fmt(x.reported_box) }}</td>
                      <td class="num">
                        <!-- ⚠️ @focus/@blur 记「正在打字的是哪一格」：预演回来时**不回填这一格**，
                             否则用户敲到一半的数字会被后端的四舍五入值顶掉（"填了不算"）。 -->
                        <input class="cell-input alloc-mini" type="text" inputmode="decimal"
                               :value="allocAllocsRaw[x.employee_id] != null ? allocAllocsRaw[x.employee_id] : fmt(x.alloc_box)"
                               @focus="allocFocusEid = x.employee_id" @blur="allocFocusEid = 0"
                               @input="onAllocAllocInput($event, x.employee_id)"
                               @change="onAllocAllocCommit($event, x.employee_id)">
                      </td>
                      <td class="num" :class="{ 'alloc-neg': Number(x.final_box) < 0 }">{{ fmt(x.final_box) }}</td>
                    </tr>
                    <tr v-if="!allocRows.length">
                      <td colspan="5" class="alloc-empty">{{ allocBusy || allocPrev ? '计算中…' : (allocErr || '没有可分摊的承接人') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="alloc-sum">
                <span :class="allocRatioOk ? 'ok' : 'bad'">占比合计 {{ fmt(allocRatioTotal) }}%{{ allocRatioOk ? ' ✓' : ' ✗ 必须 = 100%' }}</span>
                <span v-if="allocSummary" :class="allocSummary.fully_applied ? 'ok' : 'bad'">
                  加单合计 {{ fmt(allocSummary.allocated) }}{{ allocSummary.fully_applied ? ' ✓' : (' ✗ 差 ' + fmt(allocSummary.unassigned)) }}
                </span>
                <span v-if="allocSetup.target">目标总量 {{ fmt(allocSetup.target.target_qty) }} 箱</span>
                <span v-else>本月无目标</span>
              </div>
              <p v-if="allocSummary && !allocSummary.fully_applied" class="imp-tip warn-text">
                分不满：经理填 {{ fmt(allocSummary.total_delta) }} 箱，实际分出 {{ fmt(allocSummary.allocated) }} 箱，缺口 {{ fmt(allocSummary.unassigned) }} 箱
                —— 其中「占比合计不足 100%」占 {{ fmt(allocSummary.ratio_gap) }} 箱、
                「减单时有人报量不够被夹到 0」占 {{ fmt(allocSummary.clip_gap) }} 箱。
                前者改占比即可，后者是报量事实、改占比无用。
              </p>
              <p v-if="allocErr" class="imp-tip warn-text">{{ allocErr }}</p>
            </template>
            <p v-else class="imp-tip">正在读取分摊依据…</p>
            <div class="alloc-actions">
              <!-- v339：L2（无目标）也能分摊之后，「**有没有目标**」不再是能不能操作的前提 ——
                   旧版两处 `!no_target` 把 L2 商品的「平均分配 / 恢复」**整对按钮藏掉了**。
                   现在唯一的前提是"本期有没有可分摊对象"（= no_members）。 -->
              <button v-if="allocSetup && !allocFlags.no_members"
                      class="btn btn-sm btn-ghost" @click="allocSplitEven">平均分配</button>
              <button v-if="allocSetup && !allocFlags.no_members && !allocIsOverride"
                      class="btn btn-sm btn-ghost"
                      :title="allocIsDerived ? '恢复为按各人本期报单量自动算' : '恢复为商品目标档案里的比例'"
                      @click="allocResetRatios">{{ allocIsDerived ? '恢复自动比例' : '恢复档案原比例' }}</button>
              <!-- v339：**撤销本期覆盖**的专用入口。没有它，用户改错了只能手动把每个人敲回原值 ——
                   而且**永远回不到"没设过"的状态**（`basis` 会一直是 override，界面也就一直说"你改过"）。 -->
              <button v-if="allocSetup && allocIsOverride"
                      class="btn btn-sm btn-ghost"
                      title="清除本期临时占比，恢复为自动判据（不改商品目标档案）"
                      @click="allocClearOverride">清除本期临时占比</button>
              <span class="alloc-spacer"></span>
              <button class="btn btn-ghost" @click="closeAlloc">取消</button>
              <!-- v335 门禁：两条写路都归 data/update ——
                   写档案 = PUT /api/product-targets/{tid}；v339 本期临时占比 = PUT .../extra-alloc/override -->
              <button class="btn btn-primary"
                      :disabled="allocBusy || allocPrev || !allocSetup || !!allocFlags.no_members || !allocRatioOk || !canDo('data', 'update')"
                      :title="!canDo('data', 'update') ? '当前角色没有分摊加单/减单的权限'
                              : (!allocRatioOk ? '占比合计必须等于 100% 才能保存'
                              : (allocIsOverride ? '保存本期临时占比（只影响本期），并把加单量回填到本行'
                              : (allocIsDerived ? '保存本期临时占比（只影响本期、不改商品目标档案），并把加单量回填到本行'
                              : '把占比写进商品目标档案（全期生效），并把加单量回填到本行')))"
                      @click="applyAlloc">{{ allocBusy ? '应用中…'
                        : ((allocIsOverride || allocIsDerived) ? '保存本期占比并回填' : '应用到汇总表') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
</template>

<style scoped>
.alloc-modal{width:min(720px,95vw)}
.alloc-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 8px}
.alloc-top label{font-size:13px;font-weight:600;color:var(--t1)}
.alloc-num{width:96px;text-align:right}
.alloc-unit{font-size:12px;color:var(--t3)}
.alloc-conv{font-size:12px;color:var(--t3)}
.alloc-note{background:var(--warn-amber-bg);border-radius:6px;padding:6px 8px;color:var(--warn-amber)}
.alloc-tbl-wrap{max-height:290px;overflow:auto;border:1px solid var(--bd);border-radius:4px;background:var(--bg)}
.alloc-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.alloc-tbl th{position:sticky;top:0;z-index:1;background:var(--bg3);color:var(--t2);font-weight:600;text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);white-space:nowrap}
.alloc-tbl td{padding:5px 8px;border-bottom:1px solid var(--bd);color:var(--t1)}
.alloc-tbl .num{text-align:right}
.alloc-mini{width:74px;text-align:right;padding:2px 5px;font-size:12.5px}
/* v336：占比「只读」态 —— 来源是本期报单量推导（客观事实），不是可配置的档案比例。
   视觉上必须一眼看出"这格改不了"，否则用户会反复点进去以为输入框坏了。 */
.alloc-mini.alloc-ro{background:var(--bg2);color:var(--t2);cursor:not-allowed;border-style:dashed}
.alloc-empty{text-align:center;color:var(--t3);padding:14px 0}
.alloc-neg{color:var(--danger-txt);font-weight:600}
.alloc-sum{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 0;font-size:12px;color:var(--t2)}
.alloc-sum .ok{color:var(--p-dark);font-weight:600}
.alloc-sum .bad{color:var(--danger-txt);font-weight:600}
.alloc-actions{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)}
.alloc-spacer{flex:1}
</style>