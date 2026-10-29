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

  /* ================= P2 · 静态盘点单（复用既有 /api/stock-freezes，v108） =================
     🔴 与 P1 的「盘点单」**不是同一个引擎**，两张表、两套语义，别合并：
        · `stock_freezes`（本组）= **冻结快照 + 状态标识**。创建时把当前库存拍成明细，
          盘点期间以快照为计数基准，可随时释放。**它不改库存**。
        · `wh_stock_takes`（P1）= **录数 + 差异落库存**。
        ⚠️ 两者**无数据联动**：在本页「释放」不会去动任何盘点期次，反之亦然。
          这不是疏漏，是既有设计（冻结单 docstring 明写「不强制阻止出库」）——
          页面口径说明里要写清，否则仓管会以为解冻 = 完成盘点。

     ⚠️ 端点形状（实测 2026-10-11，tenant 1）：
        · `GET /list` → `{success, data:[…]}`（`_list()` 归一）；**无 scope 参数** ⇒ 整仓/部分按 `scope` 本地筛。
        · `GET /{fid}` → `{success, data:{…, items:[…]}}`
        · `POST /create` → `{success, id}`；`scope='partial'` 必须给 `product_ids`，
          否则**后端直接删单返回 `success:false`**（不报错、不建单）。
        · `POST /{fid}/release` → `{success}`（仅 `active` 生效，已释放的再点无副作用）。 */
  freezeList: (limit = 200) => api(`/api/stock-freezes/list${qs({ limit })}`).then(_list),
  /* 🔴 `api()` **已经**剥掉一层 `{success,data}`（见 client.js:248）⇒ 这里**不能**再 `.data`
     一次，否则永远得到 `undefined`（v465h 探针实测：点「查看」恒报「冻结单不存在」）。
     本方法契约 = 「给冻结单对象，或给 null」，故按 `id` 判真身而不是按信封字段。 */
  freezeGet: (fid) => api(`/api/stock-freezes/${fid}`).then(d => (d && d.id ? d : null)),
  freezeCreate: (body) => api('/api/stock-freezes/create', { method: 'POST', body }),
  freezeRelease: (fid) => api(`/api/stock-freezes/${fid}/release`, { method: 'POST' }),

  /* ================= P2 · 组合单 / 拆分单（复用既有 /api/assembly，v108） =================
     `type` = 'assemble'（组件→组合品）| 'disassemble'（组合品→组件）。
     "组合单"与"拆分单"是**同一张表两个方向**（`kit_orders.type`）⇒ 一个页面参数化两次。

     ⚠️ 端点形状（实测 2026-10-11）：
        · `GET /list` → `{success, data:[…]}`；**无 type 参数** ⇒ 两个页面各按 `type` 本地筛。
        · `GET /{aid}` → `{success, data:{…, items:[…]}}`；`items[].is_input` 1=被消耗、0=被产出。
        · `POST /create` → `{success, id}`（`items` 后端会**丢掉 quantity≤0 的行**，静默）
        · `POST /{aid}/confirm` → **执行**：真扣真加库存，返回 `{success, id, total_cost}`；
          非 draft 返回 `success:false`（前端 `api()` 会在 200 里看到 success:false ⇒ 必须自己查）。
        · `POST /{aid}/void` → 仅 draft 可作废。
        ⚠️ 后端的 `GET /summary`（按 type 聚合单数/总成本）**刻意不封装**：本组页面的
           KPI 与表格必须读**同一个数组**（一次拉全 + 本地计数），接服务端汇总会让
           「KPI 说 5 单、表里 3 行」成为结构上可能的事。要接就得把列表也改成服务端分页。

     ✅ **批次缺陷已修（v465i，2026-10-11）**：`_asm_apply_inventory` 的扣减侧改走共享原语
        `gross_deduct`（指定批次只扣该批 / 未指定按效期 / 不足**抛异常**），
        `assembly_confirm` 捕获后 `success:false` + 整单回滚 —— 不再有「静默夹 0 的幽灵行」。
        修之前的症状（多批次下扣不动且不报错）已在页面口径里改写，别再照旧文案提示用户。 */
  kitList: (limit = 200) => api(`/api/assembly/list${qs({ limit })}`).then(_list),
  /* 同 `freezeGet`：`api()` 已剥一层 `{success,data}`，不能再剥（v465h 探针实测）。 */
  kitGet: (aid) => api(`/api/assembly/${aid}`).then(d => (d && d.id ? d : null)),
  kitCreate: (body) => api('/api/assembly/create', { method: 'POST', body }),
  /* 确认执行：库存真变动。返回 `{success, id, total_cost}`（**没有** data 信封，且
     status 非 draft 时是 200 + `success:false` ⇒ 调用方必须判 `r.success`）。 */
  kitConfirm: (aid) => api(`/api/assembly/${aid}/confirm`, { method: 'POST' }),
  kitVoid: (aid) => api(`/api/assembly/${aid}/void`, { method: 'POST' }),

  /* ================= P2 · 损益单 = 报损单（复用既有 /api/wastage，v92） =================
     🔴 **不是** `/api/loss/*` —— 那是 AI 货损**核算域**（`/api/loss/recipe` 返回算法配方
        `threshold_days/pricing/near_loss_pct`），**没有单据列表**。真正的报损单在
        `domain/wastage_tracker.py` + `wastage_orders`，路由内联在 `server.py`
        （4075–4121），前缀 `/api/wastage` → 模块 `stock`。

     🔴🔴 **`create` 是一次性生效的库存+账务动作，没有"提交后待审"**：
        `create_wastage_order()` **立即** `inventory_adjust(-qty)` 扣库存，
        并**直接落 `status='approved'` + 过账 GL 分录**（`wastage_tracker.py:151`）。
        ⇒ 页面上「新建报损单」必须二次确认 + 显著提示；撤销走 `reject`（恢复库存 + 冲销分录）。
        类型→科目映射后端已内置（`expired/damaged`→6401 主营业务成本、`transport`→6601 销售费用、
        `quality/theft/other`→6602 管理费用）⇒ 前端**不许**再抄一份。

     ⚠️ `GET /list` 返回 `{orders, total}`（**不是** data/items）⇒ 本层归一成数组，
        `total` 单独用 `wastageTotal()`（同一次请求里拿，别发两次）。
     ℹ️ `/api/wastage/summary` 与 `/api/wastage/suggest-from-expiry` 曾因 `/api/wastage/{wid}`
        注册在前而恒 422，v465i 已重排路由修好；**但本层仍不封装** —— KPI 与表格必须读
        **同一个数组**（一次拉全 + 本地计数），接服务端汇总会让「KPI 说 5 单、表里 3 行」
        成为结构上可能的事（同上方 assembly `/summary` 的口径）。 */
  /** 返回 `{orders, total}` 的**原始**形状（列表页要同时用 orders 与 total）。 */
  wastageListRaw: (params) => api(`/api/wastage/list${qs(params)}`),
  wastageList: (params) => api(`/api/wastage/list${qs(params)}`).then(d => (d && d.orders) || []),
  wastageGet: (wid) => api(`/api/wastage/${wid}`),
  /* body `{type, warehouse_id, items:[{product_id, quantity, cost_price, batch_no, reason_code, note}], note}`
     ⇒ `{wastage_id, order_no, total_loss, item_count}`（**无** data 信封）。 */
  wastageCreate: (body) => api('/api/wastage/create', { method: 'POST', body }),
  wastageReject: (wid) => api(`/api/wastage/${wid}/reject`, { method: 'POST' }),
  /** 报损类型 → 中文标签（口径与后端 `WASTAGE_TYPES` 一致；**不含科目**，科目由后端落账） */
  wastageTypes: () => ([
    { v: 'expired',   t: '过期报损' },
    { v: 'damaged',   t: '破损报损' },
    { v: 'transport', t: '运输损耗' },
    { v: 'quality',   t: '质量问题' },
    { v: 'theft',     t: '丢失' },
    { v: 'other',     t: '其他' },
  ]),

  /* ================= P3 · 配送作业（全部接既有端点，后端零改动） =================
     🔴 **上一轮盘点说「P3 后端不存在」是错的**，本段是纠错后的事实（2026-10-12 重盘）：
        · 判据错在哪：① 用了失效的 `grep "A\|B"`（BSD grep 不认 `\|`）⇒ 本地明明有却 grep 不到；
          ② 拿「未认证 401」当存在性判据 —— 全局中间件对**不存在**的路径同样返 401 ⇒ 零判别力。
        · 真实情况：配送能力 8 个端点**早已在 `routers/vehicles.py`（prefix `/api`）与
          `routers/delivery.py`（prefix `/api/delivery`）**，且都已 `include_router`。
          本地 `server/erp_db.py` 与生产 md5 完全一致 —— 能力一直在，是**我检索错了**。

     🔴 模块归属（`server.py::_PATH_MODULE_MAP`，**首个 startswith 命中即停**）：
        · `/api/delivery*`  → **sales**（字典里只有 `/api/delivery` 这个键，
          故 `/api/delivery-tasks` / `/api/delivery-routes` / `/api/delivery-stops/*` 全落 sales）
        · `/api/vehicles`   → **stock**
        · `/api/sale-orders`→ sales
        ⇒ 三页的主数据都在 sales，车辆在 stock。`BIZ_ROLES` 五类角色
          （admin/boss/accountant/sales/supervisor）**同时持有 sales 与 stock**
          （`core.py::_DEFAULT_PERMS` 逐个核过）⇒ 不会出现「入口看得见、取数 403」的假入口。
          ⚠️ `driver` 角色**只有 stock、没有 sales** ⇒ 它不在 BIZ_ROLES 里、进不了仓配页，符合预期。

     ⚠️ 既有实现的两条口径（页面必须照实说，别替后端圆）：
        ① `get_delivery_tasks()` 的 SQL **硬编码 `delivery_status='assigned'`** ⇒
           「配送单」页只能看到**已分车的当日任务**，看不到历史已送达/已签收的单。
           要历史就得走 `/api/sale-orders`（`SELECT so.*` 含全部 delivery_* 列）本地筛 ——
           本层两个方法都提供，页面按「今日待配送 / 全部」切换时**各用各的**，不混。
        ② `assign_vehicle()`（分车：写 vehicle_id + driver_id + 'assigned'）**没有 HTTP 端点**
           ⇒ 本层**不提供**分车方法。前端只能在销售单侧完成分车，本页只读 + 改状态。
           这是真缺口，登记在 docs/仓配模块开发规范.md，不擅自补后端。 */

  /* —— 司机任务看板 —— `/api/delivery/board?date=` → 原样返回聚合结果（**不是**数组） */
  boardGet: (date = '') => api(`/api/delivery/board${qs({ date })}`),
  /* —— 配送任务（= `sale_orders` 里 delivery_status='assigned' 且 order_date=当天）——
     返回 **裸数组**（`erp_db.get_delivery_tasks` 直接 return list，无信封）。 */
  taskList: (date = '') => api(`/api/delivery-tasks${qs({ date })}`).then(_list),
  /* —— 配送状态流转：`assigned` 已分车 / `delivered` 已送达 / `signed` 已签收 / `failed` 配送失败
     （后端白名单校验，其它值 400）。id 是 **sale_orders.id**。 */
  taskSetStatus: (id, status) => api(`/api/delivery/${id}/status`, { method: 'POST', body: { status } }),
  /* —— 历史/全部配送单：销售单列表（`SELECT so.*` ⇒ 含 driver_id / vehicle_id / delivery_status），
     `{orders, total}` 信封 ⇒ 两个方法分开，页面别发两次请求。 */
  saleOrdersRaw: (params) => api(`/api/sale-orders${qs(params)}`),
  saleOrders: (params) => api(`/api/sale-orders${qs(params)}`).then(d => (d && d.orders) || []),

  /* —— 线路设置（`delivery_routes` + `delivery_stops`）—— */
  routeList: (date = '', status = '') => api(`/api/delivery-routes${qs({ date, status })}`).then(_list),
  /* body `{name, vehicle_id(>0 必填), driver, date, stops:[{name,address,order_ids:[]}], notes}`
     ⇒ `{success, id}`。⚠️ Pydantic 校验 `name` 非空、`vehicle_id>0` ⇒ 前端必须先挡。 */
  routeCreate: (body) => api('/api/delivery-routes', { method: 'POST', body }),
  /* 优化排序：停靠点 ≥3 且有 lat/lng ⇒ 最近邻；否则按地址字符串排序；≤2 个点直接返回
     `{optimized:false}`。**返回体随分支变**（有/无 `method`、`stops`）⇒ 页面按字段判，不按形状判。 */
  routeOptimize: (rid) => api(`/api/delivery-routes/${rid}/optimize`, { method: 'POST' }),
  /* 停靠点状态：`delivered` 会写 delivered_at；当某路线**全部**停靠点都 delivered ⇒
     路线自动置 `completed`（`erp_db.delivery_stop_update`）。 */
  stopUpdate: (sid, status = 'delivered', note = '') =>
    api(`/api/delivery-stops/${sid}/update`, { method: 'POST', body: { status, note } }),

  /* —— 车辆档案（`vehicles`，归 stock）——
     ⚠️ 线上 `vehicles` 表 **0 行**，而建线路**必填 vehicle_id>0** ⇒ 线路设置页必须能建车，
        否则「新建线路」永远点不动。
     🔴 列表**复用 P0 已有的 `vehicles()`**（`/api/vehicles` 返回裸数组），这里**不**再加一份
        —— 同一端点两个封装必然漂移（本项目明令禁止）。 */
  /* body `{name(必填), plate, type, driver, phone}` ⇒ `{success, id}` */
  vehicleCreate: (body) => api('/api/vehicles', { method: 'POST', body }),

  /* 配送状态 → 中文标签 + 徽标色类（口径与后端白名单一致，前端不自行发挥）。
     ⚠️ 色类用**本前端**的 `badge-blue/green/red`（`styles/variables.css:556`），
        不是旧前端 `static/` 的 `bg-info/bg-ok/bg-danger` —— 抄旧的那套在这里是空样式。 */
  deliveryStatuses: () => ([
    { v: 'assigned',  t: '已分车', cls: 'badge-blue' },
    { v: 'delivered', t: '已送达', cls: 'badge-green' },
    { v: 'signed',    t: '已签收', cls: 'badge-green' },
    { v: 'failed',    t: '配送失败', cls: 'badge-red' },
  ]),

  /* ================= ④ 仓配闭环 W1：拣货波次（/api/picking，归 stock） =================
     🔴 生成波次即按小单位预留（auto_reserve），预留不足整体回滚并 400（前端要拦截报错）。
        `pickWaveCreate` 返回 `{success, wave_id, wave_no, order_count, item_count, reserved}`。
        ⚠️ `pickWaveList` 用 `_list()` 归一（后端 `{items,total}`）；`pickWaveDetail` 返回
        波次对象（含 `items` 逐行：product_id/quantity/bin_location/picked_qty/status）。 */
  pickWaveList: (p = {}) => api(`/api/picking/waves${qs(p)}`).then(_list),
  pickWaveDetail: (id) => api(`/api/picking/waves/${id}`),
  /* body `{warehouse_id, order_ids:[], picker_id}`；order_ids 空 = 聚合该仓全部 pickable 单 */
  pickWaveCreate: (body) => api('/api/picking/waves', { method: 'POST', body }),
  pickWaveComplete: (id) => api(`/api/picking/waves/${id}/complete`, { method: 'POST' }),
  /* 作废波次：释放该波次各订单的预留（防可用量虚低），返回 `{success, released_orders}` */
  pickWaveCancel: (id) => api(`/api/picking/waves/${id}/cancel`, { method: 'POST' }),
  /* 记录某拣货明细行已拣数量（部分拣货也允许）body `{picked_qty}` */
  pickItem: (itemId, pickedQty) =>
    api(`/api/picking/waves/items/${itemId}/pick`, { method: 'POST', body: { picked_qty: pickedQty } }),

  /* ================= ④ 仓配闭环 W3：库位管理（/api/wh/locations，归 stock） =================
     `inventory.location_id` 把每行(lot)指向一个正式库位（替代 free-text bin_location）。
     🔴 列表用 `_list()` 归一（后端 `{items,total}`）；每项 `{id, warehouse_id, code, name, zone, remark}`。 */
  locationList: (p = {}) => api(`/api/wh/locations${qs(p)}`).then(_list),
  /* body `{warehouse_id, code, name, zone, remark}` ⇒ `{success, id}` */
  locationCreate: (body) => api('/api/wh/locations', { method: 'POST', body }),
  /* body `{code, name, zone, remark}` ⇒ `{success, id}` */
  locationUpdate: (id, body) => api(`/api/wh/locations/${id}`, { method: 'PUT', body }),
  locationDelete: (id) => api(`/api/wh/locations/${id}`, { method: 'DELETE' }),
  /* 把若干 inventory 行指向库位 body `{inventory_ids:[], location_id}` ⇒ `{success, updated}` */
  locationAssign: (body) => api('/api/wh/locations/assign', { method: 'POST', body }),

  /* ================= ④ 仓配闭环 W2：库存预留（/api/inventory/reserve|release|availability，归 stock） =================
     🔴 预留是 W1 波次生成时的副作用（auto_reserve），本组方法主要供「手工预留 / 释放 / 查可用」。
        `available = actual - reserved`；actual 实时取 SUM(inventory.quantity)，不依赖余额表新鲜度。
        ⚠️ `reserveStock` 超额时后端抛 400 ⇒ api() 抛 Error，调用方必须显示，别吞。 */
  reserveStock: (body) => api('/api/inventory/reserve', { method: 'POST', body }),
  releaseReserve: (body) => api('/api/inventory/release', { method: 'POST', body }),
  availability: (productId, warehouseId = 1) =>
    api(`/api/inventory/availability${qs({ product_id: productId, warehouse_id: warehouseId })}`),
}
