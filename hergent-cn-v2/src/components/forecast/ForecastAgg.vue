<script setup>
/* v655：把预报网格里「随每格数量变化而重算」的聚合值（合计/箱/金额/零报单/缺规格行数…）
   从 Forecast.vue 父模板移进本组件，由本组件内部算值并廉价重渲染。
   父模板只传 cross（一个稳定的引用），**不再**在父 render effect 里读这些会随格变化的值
   ⇒ 改一格时父组件整模板不再重渲染（v654 已把行拆成子组件，本步补上「表尾 + 汇总条」）。

   口径严格对齐原模板：
   - grand.* / colTotals 直接读 cross（与 recomputeTotals 写入的值同源）
   - editTotal* / foot.* 用 calc 纯函数（rowSum/rowBoxes/amountValue…）逐行累加，
     与父组件原 computed 用 rowSumOf 算出的值完全一致，只是不订阅全表 rowSumArr。
   - 格式化：fmt / fmtBox 与父模板一致；金额列只在「汇总条/es-txt」带 ¥（脚注列不带）。
*/
import { computed, inject } from 'vue'
import { FC_ROW_CTX } from './rowCtx.js'
import { fmt, fmtBox } from '../../utils/forecast/format.js'
import {
  rowSum, rowBoxes, rowExtraQty, rowFinalQty, amountValue, boxMissing,
} from '../../utils/forecast/calc.js'

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
const liveRows = computed(() => cross.value.rows.filter(r => !r._deleted))

// 缺规格行数（原 boxMissingRows.length）
const boxMissLen = computed(() => {
  const rows = liveRows.value
  let n = 0
  for (const r of rows) if (boxMissing(r)) n++
  return n
})

const val = computed(() => {
  const c = cross.value
  const rows = liveRows.value
  const units = c.units
  switch (props.kind) {
    case 'zeroReportCount':
      return rows.filter(r => rowSum(r) <= 0).length
    case 'grandQty':    return c.grand.qty
    case 'grandBoxes':  return c.grand.boxes
    case 'grandAmountFoot': return c.grand.amount
    case 'grandAmountBar':  return c.grand.amount
    case 'grandSku':    return c.grand.sku
    case 'reportedUnits':  return c.reportedUnits
    case 'colTotal':
      return c.colTotals[(props.ci - 1) - visN.value] || ''
    case 'viewExtraQty': return rows.reduce((s, r) => s + rowExtraQty(r), 0)
    case 'viewFinalQty': return rows.reduce((s, r) => s + rowFinalQty(r), 0)
    case 'editTotalQty':   return rows.reduce((s, r) => s + rowSum(r), 0)
    case 'editTotalBoxes': return rows.reduce((s, r) => s + rowBoxes(r), 0)
    case 'editTotalAmount':return rows.reduce((s, r) => s + (amountValue(r) || 0), 0)
    case 'editExtraQty':   return rows.reduce((s, r) => s + (Number(r.extraQty) || 0), 0)
    case 'editFinalQty':   return rows.reduce((s, r) => s + rowFinalQty(r), 0)
    case 'footUnitSum': {
      const u = units[props.ui]
      const name = u && u.name
      if (!name) return 0
      return rows.reduce((s, r) => s + (Number(r.qtyByUnit[name]) || 0), 0)
    }
    case 'footQty':     return rows.reduce((s, r) => s + rowSum(r), 0)
    case 'footAmount':  return rows.reduce((s, r) => s + (amountValue(r) || 0), 0)
    case 'footSuggest': return rows.reduce((s, r) => s + (Number(r.suggest) || 0), 0)
    case 'footMaster': {
      // 与父组件原 foot.masterSum[c.key] 逐字一致：活跃行上按列 key 累加 parseFloat(r[c.key])
      const k = props.ck
      if (!k) return 0
      let s = 0
      for (const r of rows) s += (parseFloat(r[k]) || 0)
      return s
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
