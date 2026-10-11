<template>
  <SaleDocForm :type="DOC_TYPE" />
</template>

<script setup>
/* 新建自提退单（v449 独立页面）。
   ------------------------------------------------------------
   🔴 这一页承载的是**老板 2026-10-11 的口径变更**：「退货单不需要选原销售单，
      退货仓库要可以指定」。拆分前它长在 `/inventory/sale/new?kind=return`，
      整页被「原销售单 + 可退预览 + 只读客户 / 仓库」占掉，明细不能自己挑商品。
      现在它是「退货登记」：客户 + 退货仓库 + 自己填的明细 ⇒ 与订单**同一个表单形态**，
      差异只剩「仓库叫退货仓库」「价格叫退货价」「多一格退货原因」。
   ⚠️ 提交通道 = `POST /api/psi/sale-return-orders`（v449 新端点，不挂原单）。
      老通道 `POST /api/psi/sale-orders/{oid}/return`（挂原单、有可退上限）
      **保留未动** —— 销售单详情页的「转单为退货」还走它，两条并存、语义不同。
   ⚠️ 路由：`/inventory/sale/self-pickup/return/new`。
   🔴 已知差距：`return_orders` 表**没有部门列** ⇒ 这一页不摆「部门」
      （摆一个填了不落库的框就是假入口）。详见 `docTypes.js` 的「已知差距」。 */
import SaleDocForm from './SaleDocForm.vue'
import { SALE_DOC_TYPES } from './docTypes.js'

const DOC_TYPE = SALE_DOC_TYPES.SELF_PICKUP_RETURN
</script>
