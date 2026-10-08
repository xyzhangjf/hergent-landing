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
   * 基础资料。`kind` = `all` | `warehouses` | `suppliers` | `customers` | `products` | `users`
   * （可逗号组合）。
   * 🔴 702 客户 / 473 商品，**必须带 keyword 搜**，别整表拉。
   * 🔴 `products[].order_unit` 是「报单单位」唯一权威来源，填数量前先判它。
   * 🔴 `users`（v403）= 单据「创建人」筛选下拉的选项，读**主库账号**。
   *    后端主库不可读时**不返回这个键** ⇒ 调用方要 `Array.isArray(d.users)` 判存在，
   *    不存在就把这一项藏起来。**不要**改用员工档案顶替：`hr_employees` 与 `users`
   *    是两套编号（实测 users id=2=张俊峰 / hr_employees id=2=王老板，id=7 才是张俊峰），
   *    同一个 id 会显示成另一个人 —— 选出来的单据归属是错的，而且不报错。
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
  /**
   * 采购单列表。
   * @param {object} p `{status, supplier_id, date_from, date_to, keyword, warehouse_id,
   *                     creator, only_marked, exclude_status, limit, offset}`
   *   · `keyword`        单号 / 供应商名 / 备注 模糊匹配
   *   · `creator`        创建人（用户 id）
   *   · `only_marked`    只看「已标记」
   *   · `exclude_status` 服务端排除的状态（逗号分隔）。
   *     🔴 侧栏「采购单 / 采购退货单」是**同一条 path + 不同 query**：排除必须在 SQL 里做。
   *        前端「先分页、再从当页过滤」会让每页少几行、`total` 对不上、翻页静默跳记录。
   * @returns `{orders, total, counts, summary, limit, offset}`
   *   · `counts`  按状态计数（**忽略 `status` 筛选、保留其它筛选**）⇒ 状态页签上的数字。
   *     键 = 各状态值 + `all`；某状态为 0 时**不会出现该键**，取值一律用 `counts[k] || 0`。
   *   · `summary` `{order_amount, received_amount, paid_amount, unpaid_amount, count}` —— 底部合计行。
   *   · 每行额外带 `creator_name`（创建人姓名，后端读主库解析，**可能为空串**）
   *     ＋ `has_items`（是否有明细行）。
   *     🔴 `has_items=false` 的行（历史导入单只落了表头）其「订单数量 / 入库金额」是
   *        **真没有**，界面必须显示 `—` 而不是 `0` —— 后者会被读成「入库了 0 元」。
   */
  listPurchases: (p = {}) => api(`/api/psi/purchase-orders${qs(p)}`),

  /**
   * 批量操作（对齐舟谱「批量操作 ▾」）。
   * @param {'approve'|'unapprove'|'cancel'|'print'|'mark'|'unmark'|'note'} op
   * @param {number[]} ids 单据 id
   * @param {object} [extra] `{mark}`（op=mark）/ `{note}`（op=note）
   * @returns `{op, op_label, requested, ok_count, fail_count, results[], counts?, mark?}`
   *   🔴 后端**逐单回报** `results[].{id, ok, reason?}`，从不回一个笼统的 success。
   *      「批量审核 20 张、实际成了 12 张」必须让用户看见 —— 所以这里**不能**只看 `ok_count`
   *      就弹"操作成功"，要把失败的那几张连同 `reason` 一并说出来。
   */
  batchPurchases: (op, ids, extra = {}) =>
    api('/api/psi/purchase-orders/batch', { method: 'POST', body: { op, ids, ...extra } }),

  /**
   * 单张「打印」计数（+1）。
   * 🔴 只记数、不生成文件 —— 真正的打印是浏览器 `window.print()`。落库是必须的：
   *    「打印数」是判断「这张单到底打没打给供应商」的依据，只在前端打印的话刷新即归 0。
   */
  printPurchase: (id) => api(`/api/psi/purchase-orders/${id}/print`, { method: 'POST' }),

  /**
   * 建采购单。
   * body: `{supplier_id, warehouse_id, note?, order_date?, expected_date?,
   *         items:[{product_id, quantity, unit_price, unit?, batch_no?, expiry_date?, production_date?}]}`
   *   · `order_date` 单据日期（`YYYY-MM-DD`，留空 = 建单当天）—— 用来补录昨天的到货单。
   *     ⚠️ v403 之前这个字段**不在后端模型里**，传了会被静默丢弃；现在真的落库。
   *   · `expected_date` 预计到货日期（同一批修复，此前也是被丢掉的）。
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

  /* ---- 详情页「货款 / 入库单」两个 tab（v404）---- */

  /**
   * 「货款」：订单信息 + 付款流水。
   * 返回 `{order: {...}, payments: [...]}`。
   *   · `order.ap_amount` / `ap_unpaid_amount` **可能是 `null`** —— 含义是「这张单没有应付记录」
   *     （舟谱导入的历史单没走过入库确认），界面必须显示 `—`，**不要当 0**。
   *   · `order.unpaid_amount`（未结）才是唯一口径：`max(0, received_amount − paid_amount)`。
   *   · `payments[].operator_name` 由后端解析（**界面不许印内部账号 id**）。
   */
  getPurchasePayments: (id) => api(`/api/psi/purchase-orders/${id}/payments`),

  /**
   * 登记一笔付款。body: `{amount, account?, note?}`。
   * 🔴 后端会拒的四种情况（都会返回 400 + 中文原因）：金额 ≤ 0、超过未结金额、
   *    会计期间已关闭、这张单没有应付记录。**不要在界面上替它判断后就静默不发** ——
   *    那道判据的唯一实现就在后端，前端再写一份必然漂移。
   */
  createPurchasePayment: (id, body) =>
    api(`/api/psi/purchase-orders/${id}/payments`, { method: 'POST', body }),

  /**
   * 「入库单」：这张单的到货入库明细。
   * 返回 `{empty, reason?, derived, head, items, summary}`。
   *   · `empty=true` ⇒ 只有一个 `reason`（人话，如「这张单还是草稿，没有入库单。」），
   *     **没有 `items`** ⇒ 界面走空态，不要渲染一张全 0 的表。
   *   · `head.inbound_no` 由源单号生成（`CD…` → `RK…`），是**展示用编号**。
   */
  getPurchaseInbound: (id) => api(`/api/psi/purchase-orders/${id}/inbound`),

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
