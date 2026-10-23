<script setup>
/* v655：把数量格候选 datalist 从父模板下沉到本组件。
   原实现里父模板读 `qtyOptKey`（datalist 的 `:key` + `v-if`）和 `qtyCellOptions`（`<option v-for>`），
   使父组件 render effect 订阅这两个随换格变化的 ref ⇒ 改一格/换格时父整模板重渲染。
   本组件从 FC_ROW_CTX 注入这两个值，父模板只放一个 <ForecastQtyOptions/> 自闭合标签，不再订阅。

   渲染语义与原 datalist 逐字一致：
   - 查看态（editMode 关）不渲染；没有任何数量格聚焦（qtyOptKey 空）不渲染。
   - `:key="qtyOptKey"` 强制换格时销毁重建节点（避免 input.list 惰性沿用旧候选）。
   - 单全局 id="opt-qty"，与各数量格的 `list="opt-qty"` 对应。
*/
import { computed, inject } from 'vue'
import { FC_ROW_CTX } from './rowCtx.js'

const ctx = inject(FC_ROW_CTX)
if (!ctx) throw new Error('[ForecastQtyOptions] 缺少 FC_ROW_CTX 注入')

const editMode = computed(() => ctx.editMode)
const qtyOptKey = computed(() => ctx.qtyOptKey)
const qtyCellOptions = computed(() => ctx.qtyCellOptions)
</script>

<template>
  <datalist v-if="editMode && qtyOptKey" id="opt-qty" :key="qtyOptKey">
    <option v-for="o in qtyCellOptions" :key="o.v" :value="o.v" :label="o.l"></option>
  </datalist>
</template>
