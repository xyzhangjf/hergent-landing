<template>
  <!-- 其它入库单 —— 薄壳：全部实现（列表 / KPI / 筛选 / 新建 / 过账 / 作废）在 `EntryList.vue`。
       🔴 为什么还要单独一个文件：`router/index.js` 需要**一条真实路由 + 一个组件**，
          且 `pages.js` 按**路径**登记可见性（`/wh/other-in` 与 `/wh/other-out` 各一行）。
          壳里**只留 `direction`**，不复制任何业务逻辑 —— 两个方向的差异全在内核里区分。 -->
  <EntryList direction="in" />
</template>

<script setup>
import EntryList from './EntryList.vue'
</script>
