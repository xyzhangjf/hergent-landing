<script setup>
/* v655：把预报网格里「随每格数量变化而重算」的聚合值（合计/箱/金额/零报单/缺规格行数…）
   从 Forecast.vue 父模板移进本组件，由本组件内部算值并廉价重渲染。
   父模板只传 cross（一个稳定的引用），**不再**在父 render effect 里读这些会随格变化的值
   ⇒ 改一格时父组件整模板不再重渲染（v654 已把行拆成子组件，本步补上「表尾 + 汇总条」）。

   v656：本组件**不再自行全表扫描**。v655 版每个 Agg 实例各自对 liveRows  reduce 一遍
   （21 个 footUnitSum + ~13 个 footMaster + qty/boxes/amount… ≈ 40 个实例），
   改一格 = 40 遍全表扫描，实测是停手后 ~60ms flush 的主因。
   现在统一读父组件 `aggTotals`（一遍算完所有槽位，经 rowCtx 下发）：
   - 槽位口径与 v655 版逐字一致（同函数同行序同累加顺序）⇒ 显示值不变；
   - Vue 3.5「computed 值不变不通知」：只有自己槽位变了的实例才重渲染；
   - grand.* / colTotal 仍直读 cross（那是 recomputeTotals 写入的值，非本组件派生）。
   🔴 新增 kind 时同步 Forecast.vue 的 aggTotals 槽位定义 —— 同一份口径，别写两遍。 */
import { computed, inject } from 'vue'
import { FC_ROW_CTX } from './rowCtx.js'
import { fmt, fmtBox } from '../../utils/forecast/format.js'

const props = defineProps({
  kind: { type: String, required: true },
  ui: { type: Number, default: -1 },   // foot.unitSum[ui]
  ci: { type: Number, default: -1 },   // colTotals 下标（只读脚注 qty 列）
  ck: { type: String, default: '' },   // foot.masterSum[ck]（编辑表尾主列 Σ）
})

const ctx = inject(FC_ROW_CTX)
if (!ctx) throw new Error('[ForecastAgg] 缺少 FC_ROW_CTX 注入')

const cross = computed(() => ctx.cross)
const visN = computed(() => ctx.visibleCols.length)

// 缺规格行数（原 boxMissingRows.length；v656 起读 aggTotals.boxMiss 槽）
const boxMissLen = computed(() => ctx.aggTotals.boxMiss)

const val = computed(() => {
  const c = cross.value
  const t = ctx.aggTotals
  switch (props.kind) {
    case 'zeroReportCount': return t.zero
    case 'grandQty':    return c.grand.qty
    case 'grandBoxes':  return c.grand.boxes
    case 'grandAmountFoot': return c.grand.amount
    case 'grandAmountBar':  return c.grand.amount
    case 'grandSku':    return c.grand.sku
    case 'reportedUnits':  return c.reportedUnits
    case 'colTotal':
      return c.colTotals[(props.ci - 1) - visN.value] || ''
    case 'viewExtraQty': return t.viewExtra
    case 'viewFinalQty': return t.finalQty
    case 'editTotalQty':   return t.qty
    case 'editTotalBoxes': return t.boxes
    case 'editTotalAmount':return t.amount
    case 'editExtraQty':   return t.editExtra
    case 'editFinalQty':   return t.finalQty
    case 'footUnitSum': {
      const u = c.units[props.ui]
      const name = u && u.name
      if (!name) return 0
      return t.unitSum[name] || 0
    }
    case 'footQty':     return t.qty
    case 'footAmount':  return t.amount
    case 'footSuggest': return t.suggest
    case 'footMaster': {
      // 与父组件原 foot.masterSum[c.key] 逐字一致：活跃行上按列 key 累加 parseFloat(r[c.key])
      const k = props.ck
      if (!k) return 0
      return t.masterSum[k] || 0
    }
    default: return ''
  }
})

const disp = computed(() => {
  const v = val.value
  switch (props.kind) {
    case 'colTotal':
    case 'zeroReportCount':
    case 'grandSku':
    case 'reportedUnits':
      return String(v)
    case 'grandBoxes':
    case 'editTotalBoxes':
      return fmtBox(v)
    case 'grandAmountBar':
    case 'editTotalAmount':
      return '¥' + fmt(v)
    case 'grandAmountFoot':
      return fmt(v)
    default: // grandQty / view*/edit*/foot* 数值类
      return fmt(v)
  }
})
</script>

<template>
  <!-- 🔴 v655：boxMissSpan 必须**整段条件渲染** —— v654 原模板是
       `<span v-if="boxMissingRows.length" class="box-miss">…</span>`（无缺失规格行时 0 个节点）。
       早期版本外层 span 无条件渲染 ⇒ 渲染指纹多一个空 span（forecast-style-snapshot 实测抓到），
       虽视觉 inert，但「0 差异」标准下必须消除。其余 kind 走 disp 文本分支。 -->
  <span v-if="kind === 'boxMissSpan' && boxMissLen" class="box-miss">（缺规格 {{ boxMissLen }} 行未计入）</span>
  <template v-else-if="kind !== 'boxMissSpan'">{{ disp }}</template>
</template>

<style scoped>
/* 🔴 v655：box-miss 原属父组件 scoped 样式，移入本组件（其父容器已无该规则可命中）。
   与父组件 .box-miss 规则逐字一致，保证渲染指纹 0 差异。 */
.box-miss {
  margin-left: 4px;
  font-size: 11px;
  font-weight: 400;
  color: var(--war);
}
</style>
