<template>
  <TransferDocForm :type="DOC_TYPE" />
</template>

<script setup>
/* 新建调拨单（v449 独立页面）。
   ------------------------------------------------------------
   🔴 这一页是 7 个新页里**唯一走了另一条数据通道**的：
      拆分前「调拨」是销售建单页的一个 `?type=transfer`，建出来的是
      一张 `sale_orders` 单 —— 而 `sale_orders` 只有**一个** `warehouse_id`，
      「调出 → 调入」根本表达不了 ⇒ 那一格填的仓既不是调出仓也不是调入仓。
      现在走 `transfer_orders`（`from_warehouse_id` / `to_warehouse_id` 两列），
      接口是 `POST /api/psi/transfer-orders`（v449 新端点，归 `inventory` 模块，
      **不是** `/api/inventory/transfer-orders` —— 那条归 `stock` 模块，
      业务员 / 会计 / 导购 / 司机都持有，用它等于把进销存只给老板的闸门作废）。
   🔴 调拨**没有退单**（老板 2026-10-11 口径，舟谱也没有这个类型）⇒ 只有这一页。
   ⚠️ 路由：`/inventory/transfer/new`。拆分前的
      `/inventory/sale/new?type=transfer&kind=order` 由路由重定向到这里。
   ⚠️ 已知差距：调拨单**没有列表页**（`transfer_orders` 只有接口、没有页面在读）
      ⇒ 「仅保存草稿」之后离开本页，那张草稿在界面上找不回来。
      详见 `TransferDocForm.vue` 文件头。 */
import TransferDocForm from './TransferDocForm.vue'
import { TRANSFER_DOC_TYPES } from './docTypes.js'

const DOC_TYPE = TRANSFER_DOC_TYPES.TRANSFER_ORDER
</script>
