<template>
  <PurchaseReturnForm :type="DOC_TYPE" />
</template>

<script setup>
/* 新建采购退货单（v449 独立页面）。
   ------------------------------------------------------------
   🔴 这一页承载**老板 2026-10-11 的口径变更**：「退货单不需要选原采购单，
      退货仓库要可以指定」。拆分前它长在 `/inventory/purchase/new?kind=return`，
      整页被「原采购单 + 可退预览 + 只读供应商 / 仓库」占掉，明细不能自己挑商品。
      现在默认形态是「退货登记」：供应商 + 退货仓库 + 自己填的明细。
   🔴 但**另一条通道没删**：带 `?from_po=<oid>` 进来时，页面切回「挂原单」形态
      （可退预览 + 服务端上限 + 二次确认），走
      `POST /api/psi/purchase-orders/{oid}/return`。
      为什么不能并掉：那条通道的「退货数量 ≤ 可退量」是**后端**在拦
      （`psi_purchase_return` 用可退预览重算），并到新通道等于悄悄削弱一道护栏。
      两种模式的完整对照表在 `PurchaseReturnForm.vue` 的文件头。
   ⚠️ 路由：`/inventory/purchase/return/new`。
      拆分前的 `?kind=return`（含 `from_po`）由路由 `beforeEnter` 改道到本页。
   🔴 已知差距：`purchase_returns` 表没有部门 / 经办人列 ⇒ 本页不摆这两格。
      详见 `docTypes.js` 的「已知差距」。 */
import PurchaseReturnForm from './PurchaseReturnForm.vue'
import { PURCHASE_DOC_TYPES } from './docTypes.js'

const DOC_TYPE = PURCHASE_DOC_TYPES.PURCHASE_RETURN
</script>
