<script setup>
/* ---- v655：编辑网格的**表头单元格**（一列一个 `<th>`）----
   诉求：父模板原先在表头 `<th>` 上直接读 `isCurColHd(ci)`（内部读 `selected`），
   而聚焦换格会 `selected.value = {r,c}` ⇒ 父组件 render effect 订阅 `selected`
   ⇒ 每聚焦一格父整模板重渲染一次（连带 295 行 vnode 重建）。
   把 `<th>` 连同选区判据（sel-col / cur-col-hd / aria-*）下沉到本组件，从 ctx 读
   ⇒ 聚焦换格只重渲染「新旧当前列」这两个表头格，父组件 0 次重渲染。

   🔴 为什么抽的是**编辑网格**表头（Forecast.vue 的 `.edit-tbl`），不是只读网格：
      只读网格表头（view 态）不读 isCurColHd，且编辑态下只读网格根本不挂载（0 行）。
   🔴 样式：根级规则（.th / .qty-th / .frozen / .sel-col / .cur-col-hd）经「子组件根
      继承父 scope id」+ Forecast.vue 的 :deep 规则继续生效；本文件只自备原 Forecast.vue 里
      **非 :deep 的后代**规则（.cust-hd / .col-resizer / .col-del）—— 根级元素拿不到父 scope，
      这些后代规则若不在此复制会静默丢失（手柄 / 客户名框 / 删除按钮的外观全没）。 */
import { inject } from 'vue'
import Icon from '../Icon.vue'
import { FC_ROW_CTX } from './rowCtx.js'

const props = defineProps({
  ci:   { type: Number, required: true },   // 该列在整个网格里的列号（含左侧主列）
  kind: { type: String, required: true },   // 'master'（主列） | 'unit'（客户/期次列）
  col:  { type: Object, default: null },    // kind==='master' 时的列定义（含 key/cls/fixed/label）
  unit: { type: Object, default: null },    // kind==='unit' 时的客户列（含 name/role）
  ui:   { type: Number, default: -1 },      // unit 在 cross.units 里的下标
})

const ctx = inject(FC_ROW_CTX)
if (!ctx) throw new Error('[ForecastHeadCell] 缺少 FC_ROW_CTX 注入')

/* 右键菜单：主列 openHdrCtx(e, key, 'master')；客户列 openHdrCtx(e, name, 'qty', ui)。
   与原 Forecast.vue 表头两条 `<th>` 上的 `@contextmenu.prevent` 逐字等价。 */
function onCtx (e) {
  if (props.kind === 'master') ctx.openHdrCtx(e, props.col.key, 'master')
  else ctx.openHdrCtx(e, props.unit.name, 'qty', props.ui)
}
</script>

<template>
  <th scope="col"
      :class="kind === 'master'
        ? ['th', col.cls, { frozen: col.fixed || col.key === ctx.frozenExtra, 'sel-col': ctx.inColSpan(ci), 'cur-col-hd': ctx.isCurColHd(ci) }]
        : ['qty-th', { 'sel-col': ctx.inColSpan(ci), 'cur-col-hd': ctx.isCurColHd(ci) }]"
      :aria-current="ctx.isCurColHd(ci) ? 'true' : null"
      :aria-selected="ctx.inColSpan(ci) ? 'true' : null"
      :style="kind === 'master' ? (col.fixed ? 'left:' + ctx.frozenLeftOf(col.key) : (col.key === ctx.frozenExtra ? 'left:' + ctx.frozenRight() : '')) : ''"
      @mousedown="ctx.onHeadDown(ci, $event)"
      @mouseover="ctx.onHeadOver(ci)"
      @contextmenu.prevent="onCtx($event)">
    <template v-if="kind === 'master'">
      <div class="th-in">
        <span>{{ col.label }}</span>
      </div>
      <!-- v705：列头漏斗（改单态只给主档列 —— 客户列头已有输入框 + ✕，52px 里再塞一个
           就点到别的东西了；客户列筛选走右键「筛选…」，面板是同一份）。与 view 态表头共用
           cfHas/cfGet/quickOpenColFilter（经 rowCtx 下发），口径零变化。 -->
      <button class="th-funnel" :class="{ on: ctx.cfHas(col.key, 'master') }"
              :title="ctx.cfHas(col.key, 'master') ? '已筛选：' + ctx.cfText(ctx.cfGet(col.key, 'master')) + '（点击修改）' : '筛选此列'"
              @mousedown.stop.prevent @click.stop="ctx.quickOpenColFilter($event, col.key, 'master')"><Icon name="filter"/></button>
      <!-- v654：表头悬停「＋」= 快捷插入列（改单态直接弹列名输入）。
           ⚠️ `@mousedown.stop.prevent` 必须 —— 否则会先触发 `onHeadDown` 把整列铺成列选区。 -->
      <button class="th-qa" :title="ctx.qaTitle(col.label, col.key)"
              @mousedown.stop.prevent @click.stop="ctx.quickAddCol($event, col.key, 'master')"><Icon name="plus"/></button>
      <span class="col-resizer" @mousedown.stop.prevent="ctx.startResize($event, col.key)" @click.stop></span>
    </template>
    <template v-else>
      <div class="cust-hd">
        <input :value="unit.name" class="cell-input cell-cust" @change="ctx.renameCol(ui, $event.target.value)" :title="unit.role || '报单单元'">
        <button class="col-del" @click="ctx.delCol(ui)" title="删除该客户列"><Icon name="close"/></button>
      </div>
      <span class="col-resizer" @mousedown.stop.prevent="ctx.startResize($event, unit.name)" @click.stop></span>
    </template>
  </th>
</template>

<style scoped>
/* 原 Forecast.vue 里**非 :deep 的后代**规则副本（根级元素继承不到父 scope ⇒ 必须自备）。
   逐字复制，不重写，避免列宽手柄 / 客户名输入框 / 删除按钮外观漂移。 */
.cust-hd{display:flex;align-items:center;gap:4px}
.col-resizer{position:absolute;top:0;right:-3px;width:9px;height:100%;cursor:col-resize;z-index:5;touch-action:none}
.col-resizer::after{content:'';position:absolute;right:3px;top:8%;height:84%;width:2px;border-radius:2px;background:var(--resizer-bg)}
.col-resizer:hover::after,.col-resizer.active::after{background:var(--p)}
.col-del{border:none;background:none;color:var(--t3);font-size:11px;cursor:pointer;padding:2px;border-radius:var(--radius-sm);flex-shrink:0;display:inline-flex;align-items:center;justify-content:center}
.col-del:hover{color:var(--dan);background:var(--dan-bg)}
</style>
