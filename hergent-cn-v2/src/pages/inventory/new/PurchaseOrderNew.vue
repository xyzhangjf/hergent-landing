<template>
  <PurchaseOrderForm :type="DOC_TYPE" />
</template>

<script setup>
/* 新建采购订单（v449 独立页面）。
   ------------------------------------------------------------
   本页 = 7 个新页面里最「厚」的一个，但页面文件本身仍然是薄的：全部内容在
   `PurchaseOrderForm.vue`（自 v448 的 `InvPurchaseNew.vue` **逐段搬移**而来，
   样式块与订单模式模板逐字节保留 ⇒ §R 视觉基准零漂移）。
   🔴 它同时承接三个入口，靠 URL query 区分（这是**同一张单据**的不同来源，
      不是三种单据，所以不拆页）：
        · 无 query            → 新建
        · `?copy=<oid>`       → 复制那张单（商品 / 价格带出，批次与到期日重填）
        · `?edit=<oid>`       → 编辑那张单（只有草稿 / 待审批 / 已取消可编辑）
   ⚠️ 退货**不在**这里了 —— 已独立成 `PurchaseReturnNew.vue`。
      拆分前的 `/inventory/purchase/new?kind=return` 由路由 `beforeEnter` 改道，
      `from_po` 等 query 会原样带走（见 `router/index.js` 里那段注释）。
   ⚠️ 路由：`/inventory/purchase/new`（**路径没变** —— 它是列表页、工作台、
      详情页「复制 / 编辑」三处都在用的地址，改路径等于让这些入口静默 404）。 */
import PurchaseOrderForm from './PurchaseOrderForm.vue'
import { PURCHASE_DOC_TYPES } from './docTypes.js'

const DOC_TYPE = PURCHASE_DOC_TYPES.PURCHASE_ORDER
</script>
