<template>
  <!-- 其它出库单 —— 薄壳：与 `OtherIn.vue` 同构，只把 `direction` 换成 `out`。
       🔴 出库方向的内核**不过滤效期**（过期批次也能出账），这正是「报损」能成立的前提 ——
          见 `EntryList.vue` 文件头与 `db/queries/wh.py::wh_entry_post` 的注释。 -->
  <EntryList direction="out" />
</template>

<script setup>
import EntryList from './EntryList.vue'
</script>
