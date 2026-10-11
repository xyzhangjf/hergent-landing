<template>
  <SaleDocForm :type="DOC_TYPE" />
</template>

<script setup>
/* 新建车销订单（v449 独立页面）。
   ------------------------------------------------------------
   🔴 与「新建自提订单」的**唯一真实差异**：表单头多一格「送货司机」
      （`hasDriver: true` ⇒ 内核里多渲染一格 + 提交时多带 `driver_id`）。
      对着舟谱「创建车销订单」截图核过：那边是 `*客户 / *业务员 / *部门 / *销售仓 /
      单据日期 / 送货司机`，自提那张没有「送货司机」。
   🔴 出货方式 = `vehicle_sale`，由配置写死并**真的提交**。
      拆分前这一格是表单里一个可选下拉，而 `create_sale` **根本不传 `order_type`**
      ⇒ 选什么都没落库，生产 `vehicle_sale` 一张都没有（v449 才修的两处之一）。
   ⚠️ 路由：`/inventory/sale/vehicle/new`。 */
import SaleDocForm from './SaleDocForm.vue'
import { SALE_DOC_TYPES } from './docTypes.js'

const DOC_TYPE = SALE_DOC_TYPES.VEHICLE_SALE_ORDER
</script>
