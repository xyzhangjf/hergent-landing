/* ============================================================
   wh.js — 仓配管理（Warehouse & Distribution）API 封装
   ------------------------------------------------------------
   v465c（P0）→ v465e（P1）。**全部落在既有已映射前缀**，只新增一个：
    · /api/expiry/forecast          → stock（v465c 补映射，见 server.py）
    · /api/vehicles                 → stock
    · /api/vehicle-stock/{id}       → stock
    · /api/inventory/low-stock      → stock（P0 新增只读端点）
    · /api/inbound                  → stock（**P1 才补映射**；后端 5 端点早已存在）
    · /api/wh/*                     → stock（P1 新模块，见 routers/wh.py；含自建盘点 /wh/stocktake）
    · /api/wms/*                    → stock（出入库策略，复用既有）
    · /api/warehouses               → stock
    · /api/products                 → data
    · /api/contacts                 → data

   🔴 为什么基础资料走 `/api/products` 与 `/api/contacts` 而**不是** `/api/psi/refs`：
      `/api/psi` 归模块 `inventory`，而 `inventory` 当前**只有 boss/admin 持有**
      （v380 闸门）⇒ 会计 / 业务员 / 主管一进仓配页就 403 = 本项目定义的**假入口**。
      而 `/api/products` 与 `/api/contacts` 归 `data`，`BIZ_ROLES`
      （admin/boss/accountant/sales/supervisor）**五类人全部持有**
      ⇒ 与 `/wh/*` 的前端可见性（`pages.js` 里 `roles: BIZ_ROLES`）同域。
      ⚠️ 客户下拉**不能**走 `/api/customers`（归 `crm`）—— `accountant` 与 `supervisor`
         都不持 `crm`（已核 `core._DEFAULT_PERMS`）⇒ 会造出
         「业务员能开这一页、会计一开客户下拉就 403」的**局部假入口**。
         `/api/contacts?type=customer` 与它同源同表，但归 `data` ⇒ 人人都能用。

   ⚠️ 契约同 `client.js`：`api()` 成功返回 `data.data`（无该字段则返回整包）；
      失败抛 `Error`（挂 `err.status`）。页面必须显示错误，不许 `catch {}` 吞掉。
   收数归一：下面每个函数都把「信封形状」抹平成调用方真正要的东西
   （数组 / 对象），页面里**不许**再写 `d.data || d.items || d` 那套兜底 ——
   兜底抄多份必然漂移，漏抄那份就是静默空表。
   ============================================================ */
import { api } from './client.js'

/* 拼查询串：空串 / null / undefined / false / 0 一律不发（= 后端默认 = 不限）。
   用 URLSearchParams 而非手拼 —— 关键词含 `&`/`#`/中文时手拼必坏。 */
function qs(params) {
  const p = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false || v === 0) return
    p.append(k, String(v))
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** 列表信封归一：后端 `{items,total}` / 裸数组 / `{success,data:[]}` 三种都吃。 */
function _list(d) {
  if (Array.isArray(d)) return d
  if (d && Array.isArray(d.items)) return d.items
  if (d && Array.isArray(d.data)) return d.data
  return []
}

export const whApi = {
  /* ================= P0 · 库存查询（只读） ================= */
  /* 效期预警表：红区（≤30 天）/ 黄区（31–60 天），后端已按阈值分好组 */
  expiryForecast: () => api('/api/expiry/forecast'),
  /* 车辆列表（司机任务 / 车辆库存的选车下拉） */
  vehicles: () => api('/api/vehicles'),
  /* 单车在车库存 */
  vehicleStock: (vehicleId) => api(`/api/vehicle-stock/${vehicleId}`),
  /* 库存预警：低于安全库存的在售商品（severity: ''|'out'|'low'） */
  lowStock: (params) => api(`/api/inventory/low-stock${qs(params)}`),

  /* ================= P1 · 基础资料（建单下拉） =================
     🔴 商品 473 / 客户 700+ ⇒ 组件内**本地模糊搜索**，所以这里一次拉全（limit 给足）。
        `/api/products` 的默认 limit 是 **20**，必须显式传，否则下拉里只有 20 个商品。 */
  products: (limit = 800) => api(`/api/products${qs({ limit })}`).then(_list),
  suppliers: (limit = 500) => api(`/api/contacts${qs({ type: 'supplier', limit })}`).then(_list),
  customers: (limit = 800) => api(`/api/contacts${qs({ type: 'customer', limit })}`).then(_list),
  /* `/api/warehouses` 直接返回裸数组（`db.get_warehouses_full()`） */
  warehouses: () => api('/api/warehouses').then(_list),

  /* ================= P1 · 入库单（复用既有 /api/inbound） =================
     🔴 后端 5 个端点**早就存在**，只是从未登记进 `_PATH_MODULE_MAP`
        ⇒ 一直 403（旧前端那页实际是坏的）。P1 只补映射，未复制实现。 */
  inboundList: (p = {}) => api(`/api/inbound${qs(p)}`).then(_list),
  inboundGet: (id) => api(`/api/inbound/${id}`),
  /* body `{supplier_id, warehouse_id, remark, items:[{product_id,quantity,batch_no,expiry_date,cost}]}`
     ⇒ 返回 `{success, id, order_no}`（**没有** data 信封）。 */
  inboundCreate: (body) => api('/api/inbound', { method: 'POST', body }),
  /* 确认收货：逐行 `batch_in` 落批次号 + 到期日；已收货的再点会 400。 */
  inboundReceive: (id) => api(`/api/inbound/${id}/receive`, { method: 'POST' }),
  /* 取消：仅 draft 可取消（已收货的会 400）。 */
  inboundCancel: (id) => api(`/api/inbound/${id}`, { method: 'DELETE' }),

  /* ================= P1 · 出库单（新增 /api/wh/outbound） =================
     🔴 与「销售出库」是两回事：本单据**无来源单、不产生应收**，
        纯仓库侧的物料出门（样品 / 内部领用 / 非销售客户）。

     ⚠️ 后端有 `GET /outbound/summary`（全表状态计数），本层**刻意不封装**：
        列表页的 KPI 与表格读的是**同一个数组**（一次拉全 + 本地筛选），
        同源 ⇒ 结构上不可能出现「KPI 说 3 张待出库、表里只有 2 行」这类打架。
        若哪天要接服务端计数，必须把列表也改成服务端筛选/分页（两条人口径要一致），
        不能只换 KPI 那一侧。 */
  outboundList: (p = {}) => api(`/api/wh/outbound${qs(p)}`).then(_list),
  outboundGet: (oid) => api(`/api/wh/outbound/${oid}`),
  /* body `{customer_id, warehouse_id, remark, items:[…]}` ⇒ `{success, id, order_no}` */
  outboundCreate: (body) => api('/api/wh/outbound', { method: 'POST', body }),
  /* 过账出库：FEFO 扣减（**过期批次不可售**）。库存不足 ⇒ 400 且**整单不落**。 */
  outboundIssue: (oid) => api(`/api/wh/outbound/${oid}/issue`, { method: 'POST' }),
  outboundCancel: (oid) => api(`/api/wh/outbound/${oid}`, { method: 'DELETE' }),

  /* ================= P1 · 其它出入库单（新增 /api/wh/entries） =================
     `direction` = 'in'（其它入库）| 'out'（其它出库）。
     ⚠️ 同出库单：后端的 `/entries/summary` 刻意不封装（理由见上）。 */
  entryReasons: (direction) => api(`/api/wh/entries/reasons${qs({ direction })}`).then(_list),
  entryList: (p = {}) => api(`/api/wh/entries${qs(p)}`).then(_list),
  entryGet: (eid) => api(`/api/wh/entries/${eid}`),
  /* body `{direction, warehouse_id, reason, remark, items:[…]}` ⇒ `{success, id, entry_no}` */
  entryCreate: (body) => api('/api/wh/entries', { method: 'POST', body }),
  /* 过账：in → `batch_in`（落批次+效期）；out → 自建 `_gross_deduct`（逐批扣、**不过滤效期**，
     所以过期奶报得掉 —— 这正是与「出库单」的语义分界）。
     🔴 为什么 out 不用 `db/queries/inventory.py::inventory_adjust`：它是**批次盲**的
        （`SELECT ... WHERE product_id=? AND warehouse_id=?` 用 `.fetchone()` 只取一条）
        ⇒ 多批次时既会误报「库存不足」、又可能扣错批次。该缺陷被 18 处调用共享，
        修它是一次系统性变更，不在本轮范围 ⇒ 本模块自带正确实现（见 wh.py::_gross_deduct）。 */
  entryPost: (eid) => api(`/api/wh/entries/${eid}/post`, { method: 'POST' }),
  entryCancel: (eid) => api(`/api/wh/entries/${eid}`, { method: 'DELETE' }),

  /* ================= P1 · 盘点单（自建 /api/wh/stocktake，**不复用** legacy） =================
     🔴 为什么不复用 legacy `/api/stock-take*`（本轮的方案修正）：
        动手前读了 `db/queries/inventory.py::stock_take_*` 并在只读生产快照上实测，
        发现 legacy 引擎在**批次级 inventory** 下必然算错三处：
          ① `start` 按 inventory 行（=批次行）建明细；
          ② `update` 的 WHERE **只有 product_id** ⇒ 一次录入改掉该商品所有批次行；
          ③ `finalize` 逐行 adjust ⇒ 同一商品按批次数**放大 N 倍**。
        ⇒ 改为自建 `wh_stock_takes` + `/api/wh/stocktake`，legacy 一个字符不改（旧前端仍在用）。
        完整论证见 `server/db/queries/wh.py` 模块 docstring 与 `routers/wh.py` 头部。

     ⚠️ 本引擎按 `(商品, 仓库)` 聚合 —— 同一商品在多个仓库是**多行**，
        所以录数必须带 `warehouse_id`（缺省 1 是后端兜底，不是"可以不传"）。 */
  stocktakeList: (limit = 50) => api(`/api/wh/stocktake${qs({ limit })}`).then(_list),
  /* 开新一期：快照当前账面 → 返回 `{success, id, take_no, item_count}` */
  stocktakeStart: () => api('/api/wh/stocktake', { method: 'POST' }),
  stocktakeGet: (tid) => api(`/api/wh/stocktake/${tid}`),
  /* body `{product_id, warehouse_id, actual_qty}` ⇒ upsert（快照里没有的 (商品,仓库) 会补一行） */
  stocktakeUpdate: (tid, productId, warehouseId, actualQty) =>
    api(`/api/wh/stocktake/${tid}/update`, {
      method: 'POST',
      body: { product_id: productId, warehouse_id: warehouseId, actual_qty: actualQty },
    }),
  /* 完成盘点：差异落库存（盘盈 batch_in / 盘亏逐批扣）。任一行落不下 ⇒ 整期不落。 */
  stocktakeFinalize: (tid) => api(`/api/wh/stocktake/${tid}/finalize`, { method: 'POST' }),

  /* ================= P1 · 出入库策略（复用 /api/wms/*，只读） ================= */
  wmsReplenNeeded: (warehouseId) => api(`/api/wms/replenishment/needed${qs({ warehouse_id: warehouseId })}`).then(_list),
  wmsCrossDock: (warehouseId) => api(`/api/wms/cross-dock${qs({ warehouse_id: warehouseId })}`),
  /* 上架建议：`{product_id, abc_class, velocity_zone, recommended_bin_code, recommended_zone, score, reason}`
     或 `{"error":"仓库无可用库位"}` —— **error 不是异常**，是业务答复，页面要照原样显示。 */
  wmsPutaway: (productId, warehouseId) =>
    api(`/api/wms/putaway-strategy${qs({ product_id: productId, warehouse_id: warehouseId })}`),
  wmsPickPath: (waveId) => api(`/api/wms/pick-path${qs({ wave_id: waveId })}`),
}
