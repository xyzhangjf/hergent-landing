/* ============================================================
   psi.js — 进销存（PSI）API 封装
   ------------------------------------------------------------
   后端：`server/routers/psi.py`（前缀 `/api/psi`，v391 薄壳 15 端点）。
   🔴 为什么**不**直接复用 `/api/purchase-orders`、`/api/sale-orders`、`/api/inventory`：
      那三个路径分别归后端模块 `buying` / `sales` / `stock`，而业务员 / 会计 / 导购 /
      司机都持有它们 ⇒ 直接复用等于**把「进销存只给老板」的闸门当场作废**。
      走 `/api/psi` 时后端按模块 `inventory` 裁决（`_DEFAULT_PERMS` 里只 boss/admin 有）。

   🔴 三条使用纪律（与后端薄壳一一对应）：
     1. **不要在前端重抄业务规则**。信用额度校验 / 审批阈值 / 促销 / 批次留痕都在后端
        （信用校验在 `routers/sales.py::create_sale` 体内，**不在 db 层**）⇒ 前端只管传参、
        显示后端返回的失败原因。前端再写一份 = 同一规则两个实现，必然漂移。
     2. **单位以商品档案为准**（`refs().products[].order_unit`）。进销存**永不落大单位**。
     3. **失败必须显式**：`api()` 会把后端 detail 抛成 `Error`，页面要显示它，
        不许 `catch {}` 吞掉（恒空恒 0 零报错 = 静默失效）。

   ⚠️ `api()` 契约（见 `api/client.js`）：成功返回 `data.data`（无该字段则返回整包）；
      失败抛 `Error`，并挂 `err.status` / `err.payload`。
   ============================================================ */
import { api } from './client.js'

/* 拼查询串：空串 / null / undefined / false / 0 一律**不发**（= 后端默认值 = 不限）。
   🔴 用 URLSearchParams 而不是手拼 —— `keyword` 里出现 `&`、`#`、中文时手拼必坏。 */
function qs(params) {
  const p = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false || v === 0) return
    p.append(k, String(v))
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const psiApi = {
  /* ---- 自检 ---- */
  /** 能力自检：返回 `{ok,module,label,status,user_id,role}`。用于页面顶部闸门状态条。 */
  meta: () => api('/api/psi/meta'),

  /* ---- 基础资料（建单下拉） ---- */
  /**
   * 四类基础资料。`kind` = `all` | `warehouses` | `suppliers` | `customers` | `products`（可逗号组合）。
   * 🔴 702 客户 / 473 商品，**必须带 keyword 搜**，别整表拉。
   * 🔴 `products[].order_unit` 是「报单单位」唯一权威来源，填数量前先判它。
   */
  refs: (kind = 'all', keyword = '', limit = 200) =>
    api(`/api/psi/refs${qs({ kind, keyword, limit })}`),

  /* ---- 库存（只读投影） ---- */
  /**
   * 批次级库存，**默认按到期日升序**（低温奶先出最早到期；无到期日排最后）。
   * @param {object} p `{keyword, brand, warehouse_id, expiring_within_days, only_saleable, limit, offset}`
   * @returns `{rows,total,limit,offset,order}`；每行带 `expiry_days_left` / `expiry_status` / `saleable`
   */
  stock: (p = {}) => api(`/api/psi/stock${qs(p)}`),

  /** 工作台 4 个 KPI。返回含 `empty_hint`（全 0 时的引导文案）与 `thresholds`。 */
  stockSummary: (warehouseId = 0) =>
    api(`/api/psi/stock/summary${qs({ warehouse_id: warehouseId })}`),

  /** 临期清单（未满 days 天到期）。 */
  stockExpiring: (days = 30) => api(`/api/psi/stock/expiring${qs({ days })}`),

  /* ---- 采购 ---- */
  /** @param {object} p `{status, supplier_id, date_from, date_to, limit, offset}` */
  listPurchases: (p = {}) => api(`/api/psi/purchase-orders${qs(p)}`),

  /**
   * 建采购单。
   * body: `{supplier_id, warehouse_id, note?, expected_date?, items:[{product_id, quantity, unit_price, unit?, batch_no?, expiry_date?, production_date?}]}`
   * 🔴 `batch_no` / `expiry_date` 是低温奶效期的**唯一登记时机**（v392 起真的会落库）：
   *    入库时 `purchase_order_confirm` 逐行读这两列交给 `batch_in`。
   *    `expiry_date` 必须是 `YYYY-MM-DD`，否则后端 400（原因：脏日期会让 SQLite 的
   *    `date()` 静默变 NULL ⇒ 排序与临期档位全错且零报错）。
   */
  createPurchase: (body) => api('/api/psi/purchase-orders', { method: 'POST', body }),

  getPurchase: (id) => api(`/api/psi/purchase-orders/${id}`),

  /** 确认 → **到货入库**：逐行 `batch_in`（记批次/效期）+ 应付 + 凭证 + 加权成本。 */
  confirmPurchase: (id) => api(`/api/psi/purchase-orders/${id}/confirm`, { method: 'POST' }),

  /** 分批到货（部分收货）。body: `{items:[{product_id, quantity}]}`；只调整总量、不落批次。 */
  receivePurchase: (id, body) =>
    api(`/api/psi/purchase-orders/${id}/receive`, { method: 'POST', body }),

  /* ---- 销售 ---- */
  /**
   * @param {object} p `{status, customer_id, date_from, date_to, operator_id, driver_id, order_type}`
   *   `order_type` = 出货方式：`self_pickup` 自提 / `transfer` 调拨 / `vehicle_sale` 车销（空 = 全部）
   */
  listSales: (p = {}) => api(`/api/psi/sale-orders${qs(p)}`),

  /**
   * 建销售单。**信用额度校验交后端**（在 `routers/sales.py::create_sale` 体内），
   * 前端不重复实现；后端返回 `error` 时 `api()` 会抛错，页面照显其 detail。
   */
  createSale: (body) => api('/api/psi/sale-orders', { method: 'POST', body }),

  getSale: (id) => api(`/api/psi/sale-orders/${id}`),

  /** 发货 —— 后端按 **FEFO**（最早到期先出）扣减，缺货则报错。 */
  deliverSale: (id) => api(`/api/psi/sale-orders/${id}/deliver`, { method: 'POST' }),

  /** 签收 —— 后端生成应收（AR）并按账期算到期日。 */
  signSale: (id) => api(`/api/psi/sale-orders/${id}/sign`, { method: 'POST' }),
}

export default psiApi
