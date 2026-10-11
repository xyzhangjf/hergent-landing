<template>
  <SaleDocForm :type="DOC_TYPE" />
</template>

<script setup>
/* 新建车销退单（v449 独立页面）。
   ------------------------------------------------------------
   🔴 它是 4 种销售单据里**字段最多**的一种：客户 + 退货仓库 + 送货司机 +
      单据日期 + 备注；明细是「商品 / 数量 / 单位 / 退货价 / 金额」。
      对着舟谱「创建车销退单」截图核过：`*客户 / *业务员 / *部门 / *退货仓 /
      单据日期 / 送货司机`，明细首列是 `*退货价(折后价)`。
   🔴 退货运单**不挂原销售单**（老板 2026-10-11 口径）⇒ 与自提退单共用同一条内核
      与同一个提交通道，差别只有 `order_type=vehicle_sale` 与「送货司机」那一格。
   ⚠️ 路由：`/inventory/sale/vehicle/return/new`。
   ⚠️ 已知问题（与本页无关、但会被用户看到）：侧栏「车销退单」点进列表后
      **表是空的** —— 销售退货单列表按 `sale_orders.status='returned'` 筛，
      而全仓没有任何写入方会写这个状态（退货实际落在 `return_orders` 表）。
      v449 未动它（属列表页的缺陷，已登记），但**新退单是能建成的**。 */
import SaleDocForm from './SaleDocForm.vue'
import { SALE_DOC_TYPES } from './docTypes.js'

const DOC_TYPE = SALE_DOC_TYPES.VEHICLE_SALE_RETURN
</script>
