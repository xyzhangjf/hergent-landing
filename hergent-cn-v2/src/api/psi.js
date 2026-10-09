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
import { api, apiBlob } from './client.js'

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

  /**
   * **按商品聚合**的库存（v408 P1-1：新建采购单明细行的「可用库存 / 实际库存」两列）。
   *
   * @param {number[]} ids 商品 id。**必传且 ≤300**；不传 ⇒ 后端返回空（不是全表）。
   * @param {number} warehouseId 页面**当前所选**的仓库（口径已拍定：选哪个仓就看哪个仓）。
   *        传 0 = 全部仓（此时 `warehouse_name` 为空，界面要标成「全部仓」而不是留空）。
   *        ⚠️ `qs()` 会把 `0` 当空值**不发**这个参数 —— 后端 `warehouse_id` 默认值也是 0，
   *           两者语义**恰好一致**（不算 bug，但属于隐含耦合，改 `qs` 的空值规则时要一起看）。
   * @returns `{rows,warehouse_id,warehouse_name,requested,found,hint}`
   *   `rows[].{product_id, batch_rows, quantity, saleable_quantity, expired_quantity,
   *            no_expiry_quantity}`
   *
   * 🔴 三个口径，界面必须照着显示，否则会和舟谱对不上号：
   *    · `quantity`          = **实际库存**（全部批次，含已过期）
   *    · `saleable_quantity` = **可用库存**（只算可售批次，唯一源 = 后端 `SALEABLE_BATCH_COND`）
   *    · 差额 `expired_quantity` = 已过期、**须走报损**那部分
   *    舟谱的「可用」还扣被订单占用；本系统**没有占用/锁定概念**（销售单在 `deliver`
   *    时才扣库存）⇒ 我方「可用」= **可销售**。
   *
   * 🔴 **"没查到" 与 "是 0" 是两件事**：`rows` 里**没有**某个 id ⇒ 查过了、该商品
   *    在该仓真的是 0；只有**请求失败**（抛异常）才该显示 `—`。用失败去显示 0 就是编数。
   */
  stockByProduct: (ids = [], warehouseId = 0) =>
    api(`/api/psi/stock/by-product${qs({
      ids: (Array.isArray(ids) ? ids : []).filter(x => Number(x) > 0).join(','),
      warehouse_id: warehouseId,
    })}`),

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
   *
   * v408（P1-3）追加 3 个筛选参数（同样默认空 = 不筛）：
   *   · `source`           单据来源，**精确**匹配（取值 = `PO_SOURCE` 的键：`manual` / `zhoupu` / `ai`）。
   *     ⚠️ 后端是**等值**匹配不是 LIKE —— 传 `man` 不会命中 `manual`。
   *   · `print_state`      `'printed'`(打印数>0) / `'unprinted'`(=0)；其它值后端**不筛**。
   *   · `product_keyword`  按**明细商品名 / 条码**找单（后端 EXISTS 子查询 ⇒ 一行不会重复出现）。
   *   v414（P2-6）再追加 1 个：
   *   · `returnable`   传 `1` = 只看**进过货**的单（`received` / `partial` / `returned`）。
   *     退货建单页选「原采购单」时用它 —— 没入库的单没有货可退。
   *     ⚠️ 它只是**粗筛**：「这张单还能不能退、还能退多少」由 `returnPreview()` 逐行算余量，
   *        别在前端再判一次（那是第二份实现）。`returned`（部分退货后源单的状态）**在**列表里
   *        —— 只放 `received/partial` 会让「退第二批」时搜不到那张单（静默假否定）。
   *   🔴 没有 `approver`（审核人）参数：全系统从不记录采购单审核人 ——
   *      `purchase_order_approve(oid)` 连操作人入参都没有，`audit_time` 只存时间，
   *      `approval_history.approver_name` 那列采购单从不写（生产/本地均 0 行）。
   *      要支持它必须先做**留痕**（加列 + 两个 approve 调用方传操作人），不是加个 where。
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

  /**
   * P1-4 编辑一张尚未入库的采购单（draft / pending_approval / cancelled）。
   * 后端 `purchase_order_update` 会整单重写（表头 + 删旧明细重插），已入库的单返回 400 拒绝。
   */
  updatePurchase: (id, body) =>
    api(`/api/psi/purchase-orders/${id}`, { method: 'PUT', body }),

  /**
   * P1-1 供应商维度应付余额 / 预付余额（跨该供应商全部单据）。
   * 新建采购单选了供应商即调，让老板开单前就看到「这供应商我们还欠多少、预先付了多少」。
   */
  supplierBalance: (sid) => api(`/api/psi/suppliers/${sid}/balance`),

  getPurchase: (id) => api(`/api/psi/purchase-orders/${id}`),

  /** 确认 → **到货入库**：逐行 `batch_in`（记批次/效期）+ 应付 + 凭证 + 加权成本。 */
  confirmPurchase: (id) => api(`/api/psi/purchase-orders/${id}/confirm`, { method: 'POST' }),

  /** 分批到货（部分收货）。body: `{items:[{product_id, quantity}]}`；只调整总量、不落批次。 */
  receivePurchase: (id, body) =>
    api(`/api/psi/purchase-orders/${id}/receive`, { method: 'POST', body }),

  /* ---- 采购退货（v414 P2-6，详情页「转单为 → 采购退货」）------------------
     🔴 走 `/api/psi/...` 而**不是**既有的 `POST /api/purchase-returns`：
        那条归 `buying` 模块（业务员 / 会计 / 导购都持有）⇒ 用它等于把「进销存只给
        老板」的能力闸门当场作废；且它的错误分支写成 `return HTTPException(...)`，
        `return` 一个 HTTPException **不会被 FastAPI 当错误** ⇒ 客户端拿到 500
        而不是那句 detail（失败原因看不到）。
     ------------------------------------------------------------------- */

  /**
   * 可退预览：这张采购单每行还能退多少。
   * @returns `{order, can_return, reason, items, total_amount, note}`
   *   · `items[].{product_id, product_name, unit, base_unit, quantity, base_qty,
   *               received_qty, returned_qty, returnable_qty, unit_price,
   *               base_unit_price, amount}`
   *   🔴 四个数量字段（`base_qty` / `received_qty` / `returned_qty` / `returnable_qty`）
   *      **全是小单位** —— 其中 `received_qty` 是「已入库」，**不是**订单行上那个同名的
   *      原单位列（两者量纲不同，别串用）。
   *   🔴 `can_return=false` 时 `reason` **一定**有人话原因（如「这张单还没入库」），
   *      界面照显 —— 不许让用户对着一个点不动的按钮猜为什么。
   *   🔴 可退量在**后端**算（`received_qty × ratio` 那类折算不许在前端重写一遍：
   *      ratio 的来源列是混类型（空串），两端判定会相反 ⇒ 必然分岔）。
   *   ⚠️ `total_amount` 是**可退金额**；**没有**「可退总数量」这种字段 ——
   *      不同商品的小单位不同（袋 / 瓶 / 盒），跨商品求和是没有意义的伪指标。
   */
  returnPreview: (id) => api(`/api/psi/purchase-orders/${id}/return-preview`),

  /**
   * 落一张采购退货单（扣库存 + 冲应付 + 把源单标成「已退货」）。
   * @param {number} id 原采购单 id
   * @param {object} body `{reason?: string, items:[{product_id, product_name, quantity, unit_price}]}`
   *   🔴 `quantity` 与 `unit_price` 必须**成对**是小单位口径（数量折小单位、
   *      单价折「元 / 小单位」）—— 只折数量不折价，退货金额会差 ratio 倍，**且零报错**。
   *      `returnPreview()` 给的就是这一对口径的默认值，**不要**再乘 / 除一次。
   *   🔴 前端也会拦「数量 > 可退量」，但**唯一强制**在后端 —— 前端拦不住直接打接口的人，
   *      而退货是不可逆的库存动作。后端 400 的原样显示即可。
   */
  returnPurchase: (id, body) =>
    api(`/api/psi/purchase-orders/${id}/return`, { method: 'POST', body }),

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

  /**
   * 「查看日志」：这张单的操作日志（**只读派生视图**，不建表）。
   * 返回 `{order_no, status, entries, count, hint}`；
   * `entries[].{at, event, detail, operator, operator_name, source}`，按时间**倒序**（最新在上）。
   *
   * 🔴 只有 5 类动作**真的留了痕**：建单 / 审核 / 已入库 / 登记付款 / 采购退货。
   *    「订单修改」等动作没有任何痕迹 —— **不会出现**，界面要照 `hint` 说明，
   *    否则用户会把「没有修改记录」读成「这张单没人改过」。
   * 🔴 `operator_name` 在「审核」「已入库」上**恒为空串**（源头没记是谁做的：
   *    `audit_time` 只有时间、`batch_trace` 没有操作人列）⇒ 界面必须显示 `—`，
   *    **不许**用「创建人」顶替 —— 那是另一个事实。
   * 🔴 数据源**不是** `audit_logs`：那张表的 `module` 只有 `'auth'`（登录日志），
   *    按 `ref_id` 关联会把别人的**登录记录**印成采购单日志。
   *
   * v408（P1-6）`productId`：传了 = **只看这一行商品**的痕迹（入库 / 退货）。
   *   🔴 行级模式下**整单事件（建单 / 审核 / 付款）会被排除** —— 它们本来就没有
   *      "哪一行"这个维度。所以"空结果"是**正确结果**，界面要照 `hint` 换文案，
   *      否则用户把「这一行没有痕迹」读成「这张单没人动过」。
   *   ⚠️ `productId` 为 0 / 不传 = 整单日志（与 v408 之前**逐字相同**）。
   */
  getPurchaseLogs: (id, productId = 0) => api(
    `/api/psi/purchase-orders/${id}/logs` + (Number(productId) ? `?product_id=${Number(productId)}` : '')),

  /**
   * 详情页「上一条 / 下一条」+ 位置读数。
   *
   * 返回 `{id, prev_id, next_id, has_prev, has_next, pos, total}`。
   *
   * 🔴 **口径只有一条：全库 `id DESC` 顺序**（= 列表页默认视图的顺序）。
   *    它**不跟随**列表筛选 —— 所以界面必须把口径写出来（「按采购单顺序，不受列表筛选
   *    影响」）。把 `pos` 说成「当前筛选里的第几条」是**另一个事实**，不许混。
   * 🔴 `prev_id` / `next_id` 为 `0` 表示**到头了**（不是"第 0 条"）；
   *    判据用 `has_prev` / `has_next`，别用 id 非零来推。
   */
  getPurchaseNeighbors: (id) => api(`/api/psi/purchase-orders/${id}/neighbors`),

  /* ---- 采购单自定义字段（v415 P2-7）-------------------------------------
     🔴 「字段的定义」与「字段的值」是**两件事**，两条路不能混：
        · 定义（有哪些字段、叫什么、文本还是数字）= `/purchase-custom-fields` 四条；
        · 值（某张单上这个字段填了什么）= 建单时随单落库（`createPurchase` 的 `extra`）
          ＋ 事后补填走 `/purchase-orders/{id}/extra`。
        为什么值要有**两条路**：建单时必须与单据**同事务** —— 分两次写会出现「单建成了、
        自定义字段没了」的半截状态，而用户看到的是"保存成功"（静默半截）。
        建单之后再改才适合独立端点。
     🔴 全部走 `/api/psi` ⇒ 自动继承模块 `inventory` 的裁决（默认只有 boss/admin 持有）。
     🔴 **唯一实现不在本文件，也不在页面里** —— 定义层与校验层全在
        `server/db/queries/forecast_columns.py`（v161 为报单矩阵造的那个引擎，v415 扩到采购单域）。
        页面**不许**自己判「字段存不存在 / 是不是数字 / 名字有没有重复」——
        抄一份必然在边界上分岔（本仓反复出现的「同一规则抄多份」）。
     ⚠️ 所有失败都是 **400 + 人话**（`ValueError` 原文），`api()` 会抛成 `Error`
        ⇒ 页面**原样显示** `e.message`，不许 `catch {}` 吞掉。
     ------------------------------------------------------------------- */

  /**
   * 自定义字段**定义**清单。
   * @returns `{columns: {module, system, custom}}`
   *   · `custom[]` = `{key, label, type, sort_order, protected:false}`（`type` ∈ `text` / `number`）
   *   · `system`  对采购单作用域**恒为空数组** —— "哪些列不可删"的唯一源是前端 `PO_COLS`，
   *     在这里再登记一份就是同一个事实的第二份拷贝（见后端该模块 docstring ⑦）。
   *     ⚠️ 别把 `system` 当"采购单的系统列清单"用 —— 它是空的，不是"没有系统列"的反证。
   *   🔴 `key` 形如 `p_ab12cd34`（前缀 `p_`），**恒不由前端生成**：本地造 key 只活在这台
   *      浏览器，服务端引用不到，换设备后这一列连同它上面的数据一起消失。
   */
  listPurchaseCustomFields: () => api('/api/psi/purchase-custom-fields'),

  /**
   * 新增一个自定义字段。`type` 只支持 `text` / `number`（缺省 `text`）。
   * @returns `{success, column: {key,label,type,sort_order,protected}}`
   * ⚠️ 名字上限 12 字、整个租户上限 30 个字段 —— 判据全在后端，超限返回 400 原文。
   */
  addPurchaseCustomField: (label, type = 'text') =>
    api('/api/psi/purchase-custom-fields', { method: 'POST', body: { label, type } }),

  /** 改字段的显示名 / 顺序。系统字段只读（采购单作用域没有系统字段）。 */
  updatePurchaseCustomField: (key, body = {}) =>
    api(`/api/psi/purchase-custom-fields/${encodeURIComponent(key)}`, { method: 'PUT', body }),

  /**
   * 删除一个自定义字段，并**同事务**清掉所有采购单上该字段的值。
   * @returns `{success, key, label, purged_products}`
   *   🔴 `purged_products` 是 **products 时代的历史键名**，语义 = **被清掉该键的采购单张数**。
   *      界面必须把这个数字**如实报出来** —— 「删了字段、N 张单上的值也一起没了」是用户
   *      要知道的事；静默清掉就是数据损失而不告知。别按字面读成"被清理的商品数"。
   */
  deletePurchaseCustomField: (key) =>
    api(`/api/psi/purchase-custom-fields/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  /**
   * 写**一张**采购单的自定义字段值（详情页补填用）。
   * @param {number} id 采购单 id
   * @param {object} values `{字段key: 值}`；值传 `''` / 空白 = **清空该字段**
   *        （≠「没提交这个键」—— 前者会从 `extra_json` 里删掉该键，后者保持原值不动）。
   * @returns `{success, order_id, updated}`
   * ⚠️ 后端只回 `updated`（写入行数，单张单只能是 0 或 1），**不回新值** ——
   *    调用方想知道最新值要自己重拉详情（`getPurchase`）。
   * 🔴 后端把「编号非法 / 单据不存在」也做成 **400**（而不是静默 success），因为
   *    那种情况下这次调用**什么都没改**，回 success 就是"静默假成功"。
   */
  setPurchaseExtra: (id, values) =>
    api(`/api/psi/purchase-orders/${id}/extra`, { method: 'POST', body: { values } }),

  /* ---- 附件（v408 P1-8）-----------------------------------------------
     🔴 走 `/api/psi/...` 而**不是**既有的通用端点 `/api/attachments`：那套只做登录校验、
        不校验这张单归谁 ⇒ 任意登录用户传别人的 `ref_id` 就能列/下/删别人的附件。
        这里四个端点后端都带归属校验（`_doc_owner_ok`）。
     ⚠️ 上传是 **JSON + base64**（不是 multipart）：后端沿用既有 `/api/attachments` 的
        契约，且 `upload_security` 要拿到完整字节做文件头嗅探。
        base64 比原文件大约 1/3 ⇒ 20MB 上限的附件请求体约 27MB，前端要先按 `max_mb` 预检，
        别让用户等半天才收到 400。
     ------------------------------------------------------------------- */
  /** 附件列表。返回 `{items, count, max_mb}`；`items[]` 带 `operator_name`（上传人姓名）。 */
  getPurchaseAttachments: (id) => api(`/api/psi/purchase-orders/${id}/attachments`),

  /**
   * 上传一个附件。
   * @param {number} id 采购单 id
   * @param {string} filename 原始文件名（**同名会被后端拒绝** —— 磁盘名按名字拼，同名会覆盖旧文件）
   * @param {string} dataB64 文件内容的 base64（**不含** `data:...;base64,` 前缀）
   */
  uploadPurchaseAttachment: (id, filename, dataB64) => api(
    `/api/psi/purchase-orders/${id}/attachments`,
    { method: 'POST', body: { filename, data_b64: dataB64 }, timeout: 120000 }),

  /** 删除一个附件（后端会判断是否还有别的行引用同一文件，再决定删不删盘上文件）。 */
  deletePurchaseAttachment: (id, aid) => api(
    `/api/psi/purchase-orders/${id}/attachments/${aid}`, { method: 'DELETE' }),

  /**
   * 下载附件 —— 走 `apiBlob`（**带 Bearer**），不能 `<a href>`。
   * @returns {Promise<Blob>}
   */
  downloadPurchaseAttachment: (id, aid) => apiBlob(
    `/api/psi/purchase-orders/${id}/attachments/${aid}/download`),

  /* ---- 采购结算单（v408 P1-9）-------------------------------------------
     🔴 它与三样既有东西都**不是一回事**，别串用：
       · `receivables(type='ap',ref_type='purchase')` = 每张采购单一行**应付台账**；
       · `ap_invoices`                                = 供应商**发票**（票）；
       · `payment_batches`                            = **付款批次**（付钱）。
     结算单 = 一个供应商 + 一段时间，把若干已入库采购单（应付）＋退货单（冲减）
     汇总成一张**对账单**。🔴 **它不碰钱**：只到「已确认」，付款仍走 `recordPurchasePayment`。 */
  /** 结算单列表。`{supplier_id, status, limit, offset}`；`status` 空串 = 全部。 */
  listSettlements: (p = {}) => api(`/api/psi/purchase-settlements${qs(p)}`),

  /** 新建结算单（草稿）。`{supplier_id, period_from, period_to, note}`。 */
  createSettlement: (body) => api('/api/psi/purchase-settlements', { method: 'POST', body }),

  /**
   * 候选单据（还没结算过的已入库采购单 + 退货单）。
   * ⚠️ `taken=true` 的行**要显示出来**（已经进过别的结算单），不是隐藏 ——
   *    隐藏会让人以为「这段时间没有单据」。
   */
  settlementCandidates: (p = {}) => api(`/api/psi/purchase-settlements/candidates${qs(p)}`),

  getSettlement: (id) => api(`/api/psi/purchase-settlements/${id}`),

  /** 往草稿结算单里加单据。返回带 `skipped[]`（每条带具体原因）⇒ 界面必须原样显示。 */
  addSettlementItems: (id, refs) => api(
    `/api/psi/purchase-settlements/${id}/items`, { method: 'POST', body: { refs } }),

  deleteSettlementItem: (id, iid) => api(
    `/api/psi/purchase-settlements/${id}/items/${iid}`, { method: 'DELETE' }),

  /** 其它调整（可正可负：运费补差 / 返利抵扣 / 抹零）。 */
  setSettlementAdjust: (id, amount, note = '') => api(
    `/api/psi/purchase-settlements/${id}/adjust`, { method: 'POST', body: { amount, note } }),

  confirmSettlement: (id) => api(`/api/psi/purchase-settlements/${id}/confirm`, { method: 'POST' }),

  /** 作废 —— 占用随之释放，单据可重新进别的结算单。 */
  voidSettlement: (id, note = '') => api(
    `/api/psi/purchase-settlements/${id}/void`, { method: 'POST', body: { note } }),

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
