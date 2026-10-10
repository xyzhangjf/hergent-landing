<!--
  表头右侧的**列宽拖动手柄**（v444，配套 composables/useColResize.js）。

  为什么要单独成一个组件而不是在每个 `<th>` 里手写 `<span class="col-rsz" …>`：
  建单页的明细表有 12~13 列、退货表 9 列，手写等于把同一串
  `@mousedown.stop / @dblclick.stop / title` 抄十几遍 —— 而"抄多份 ⇒ 漏抄的
  那一份静默失效"正是本仓明令禁止的失效模式（手柄少写一个 `.stop` 会连带触发表头的
  点击行为）。收成一个组件后，每列只写 `col` 一个属性。

  🔴 交互约定（两条，都经过实测取舍）：
    · 拖动  —— `mousedown` 起手，move/up 挂在 document 上（手柄只有 7px 宽，
               鼠标拖出手柄就收不到事件 ⇒ 必须挂 document 才能跟手）。
    · 双击  —— 恢复该列到 CSS 默认宽。为什么不用列菜单里的「重置」按钮：
               列菜单（ColMenuPanel）是全站 16 页共用组件，为这一页的"重置列宽"
               去改它会波及全部；双击是表格列宽的通行手势且零波及。
-->
<script setup>
const props = defineProps({
  /** 列清单里登记的 key —— 未登记的 key 会被 useColResize 拒绝并留痕（防幽灵宽度） */
  col: { type: String, required: true },
  start: { type: Function, required: true },
  reset: { type: Function, required: true },
})
function onDown (e) { props.start(props.col, e) }
function onDbl () { props.reset(props.col) }
</script>

<template>
  <span class="col-rsz" title="拖动调整列宽（双击恢复默认宽度）"
        @mousedown.stop="onDown" @dblclick.stop="onDbl"></span>
</template>
