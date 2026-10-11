<template>
  <SaleDocForm :type="DOC_TYPE" />
</template>

<script setup>
/* 新建自提订单（v449 独立页面）。
   ------------------------------------------------------------
   为什么这个文件这么短：老板拍板的拆法是「**薄页面 + 配置化内核**」——
   页面壳子（模板 / 校验 / 提交 / 列设置）**只有一份**，在 `SaleDocForm.vue`；
   每个单据类型一个薄文件，各自只回答「我是哪一种」。
   7 个类型 = 7 个入口 = 7 条 URL，但内核只有 3 个。
   🔴 页面里**不写**任何文案 / 字段标签 / 字段开关 —— 那些全在 `docTypes.js`。
      在这里再写一遍就是第二份真相，改一处漏一处。
   🔴 **不要**在这里加 `onMounted` 拉数据 / 传 props —— 内核自己会做。
   ⚠️ 路由：`/inventory/sale/self-pickup/new`（见 `docTypes.js::DOC_PATHS`）。
      拆分前的 `/inventory/sale/new?type=self_pickup&kind=order` 由路由**重定向**
      到这里，不是删掉 —— 旧书签与列表页按钮还在用那条地址。 */
import SaleDocForm from './SaleDocForm.vue'
import { SALE_DOC_TYPES } from './docTypes.js'

const DOC_TYPE = SALE_DOC_TYPES.SELF_PICKUP_ORDER
</script>
