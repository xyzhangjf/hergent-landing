/* ============================================================
   docTypes.js — 进销存建单页「单据类型 → 页面配置」**唯一来源**（v449）
   ------------------------------------------------------------
   背景：v448 之前，7 种单据挤在 **2 个组件** 里靠 URL 的 `?kind=` / `?type=` 分流
        （`InvPurchaseNew.vue` 2191 行 / `InvSaleNew.vue` 1028 行）。
        老板 2026-10-11 拍板：「为每一种不同类型的单据分别建立独立的页面，
        而不是继续共用同一页面」⇒ 拆成 **7 个独立页面**。

   🔴 拆法（老板拍板 C①「薄页面 + 配置化内核」）：
        · **页面**（`PurchaseOrderNew.vue` 等 7 个薄文件）只做一件事：把自己的
          类型键交给内核 —— `<SaleDocForm type="self_pickup_order" />`。
          为什么不让每个页面自己写一份模板：7 份模板 = 同一条规则抄 7 份，
          改一处漏六处（本仓反复付学费的那类）。
        · **内核**（`SaleDocForm` / `PurchaseOrderForm` / `PurchaseReturnForm` /
          `TransferDocForm`）承载模板与逻辑，差异**全部**来自本文件的配置。
        · **本文件**是差异的唯一落点：同一个字段名只在这里有一个值。

   🔴 三层「不许抄」纪律：
        1. 页面里**不写**任何文案 / 字段标签 —— 一律 `cfg.xxx`。
        2. 内核里**不写** `if (type === 'vehicle_sale_order')` 这种分支 ——
           类型差异只能表现为「配置里有没有那一项」（如 `hasDriver`）。
        3. 本文件里**不写**业务规则（可退上限 / 信用额度 / 库存校验）——
           那些的唯一实现在后端。这里只有「怎么显示」与「提交到哪条端点」。

   ⚠️ 与 `/api/psi/refs` 的耦合：`departments` / `users` 由后端按需返回，
      读不到时**不返回该键**（不是空数组）⇒ 调用方判 `Array.isArray()`。

   🔴 **已知差距（登记在案，本轮有意不做）**，写在这里是为了别让后来人以为是漏抄：
      1. **销售退单没有「部门」**。舟谱的退货单表单头有 `*部门`，我方
         `return_orders` 表**没有这一列**（v449 只补了 `warehouse_id` /
         `order_type` / `driver_id` / `note`）⇒ 放一个填了不落库的输入框
         就是**假入口**。要补得先加列 + 打通 `return_order_create` 与
         `POST /api/psi/sale-return-orders`。`hasDept=false` 就是这条。
      2. **调拨没有「搬运费」**。舟谱调拨单头有 `*搬运费`，`transfer_orders`
         表无此列（见下方调拨配置的注释）。
      3. **明细行的条码 / 实际售价 / 各档库存列**：舟谱每张单都有，我方
         建单页的明细只有「商品 / 数量 / 单位 / 价格 / 金额」+ 采购侧的批次与
         库存两列。差额是**取舍**（§R 基准里一行 31.8px 放不下 ≈10 列），
         不是遗漏。真要加，走《进销存建单页开发规范》§R 的列登记流程。
   ============================================================ */

/* 单据类型键 —— 用具名常量而不是散落的裸字符串：
   页面 props 里拼错一个字母，`saleDocConfig()` 会走 fallback（见下），
   页面照样渲染、**不报错**，只是标题变成了默认那一种。常量能挡掉一半。 */
export const SALE_DOC_TYPES = {
  SELF_PICKUP_ORDER: 'self_pickup_order',
  SELF_PICKUP_RETURN: 'self_pickup_return',
  VEHICLE_SALE_ORDER: 'vehicle_sale_order',
  VEHICLE_SALE_RETURN: 'vehicle_sale_return',
}

export const PURCHASE_DOC_TYPES = {
  PURCHASE_ORDER: 'purchase_order',
  PURCHASE_RETURN: 'purchase_return',
}

export const TRANSFER_DOC_TYPES = {
  TRANSFER_ORDER: 'transfer_order',
}

/* ---------------------------------------------------------------------------
   路径表 —— 7 条独立路径的**唯一来源**。
   路由（`router/index.js`）、侧栏入口（`Shell.vue`）、旧路径重定向三处都从这里取，
   否则同一个路径字符串会抄三份、改一处漏两处（旧链接静默 404）。
   🔴 `legacy` = 拆分前的那条共用路径（`/inventory/sale/new?type=…&kind=…`）。
      保留它做重定向，是为了**不弄坏已存在的深链**：浏览器书签、列表页
      「新建」按钮（`InvSaleList.vue`）、进销存工作台按钮都在用。
   --------------------------------------------------------------------------- */
export const DOC_PATHS = {
  purchaseOrder:  '/inventory/purchase/new',
  purchaseReturn: '/inventory/purchase/return/new',
  selfPickupOrder:  '/inventory/sale/self-pickup/new',
  selfPickupReturn: '/inventory/sale/self-pickup/return/new',
  vehicleSaleOrder:  '/inventory/sale/vehicle/new',
  vehicleSaleReturn: '/inventory/sale/vehicle/return/new',
  transferOrder: '/inventory/transfer/new',
  /* 拆分前的那条共用路径 —— 只用于「旧链接 → 新页面」的重定向，不再承载页面。 */
  legacySaleNew: '/inventory/sale/new',
}

/* ---------------------------------------------------------------------------
   销售侧 4 种
   ---------------------------------------------------------------------------
   🔴 四种类型的**真实差异**（对着舟谱建单页截图逐项核过，见
      `~/Documents/舟谱截图/进销存其它几个类型截图/`）：
        · 车销（订单 / 退单）表单头多一个「送货司机」；自提没有。
        · 仓库那格的标签分两类：订单 = `销售仓库`，退单 = `退货仓库`。
          ⚠️ 舟谱自己在「销售仓库」(自提) 与「销售仓」(车销) 上不一致 ——
             同一个字段不该有两个名字，我方**统一**为「销售仓库」。这是**故意**的
             偏离，不是漏抄。
        · 价格列标签：订单 = `销售价`，退单 = `退货价`（舟谱还带 `(新阶价)` /
          `(折后价)` 后缀，那是**价格档位**的口径，我方由后端按客户专属价自动套用，
             界面上不摆档位后缀 —— 摆上去会让老板以为要自己挑档）。
        · 退单多一个「退货原因」（舟谱没有这一格；我方 v441 起就有，是给
          「为什么退」留痕用的，留着）。
   --------------------------------------------------------------------------- */
const SALE_CFG = {
  [SALE_DOC_TYPES.SELF_PICKUP_ORDER]: {
    title: '新建自提订单',
    shortTitle: '自提订单',
    /* 🔴 v458：原 `sub` / `hint` / `tip` 三条内联说明（「客户到仓提货…」「客户与仓库必填…」
       「数量按报单单位…」）已移除，仅保留业务逻辑，界面更简洁。 */
    whLabel: '销售仓库',
    priceLabel: '销售价',
    tblTitle: '商品明细',
    saveLabel: '保存订单',
    isReturn: false,
    hasDriver: false,
    /* 部门：**订单有、退单没有**，见文件头「已知差距」。 */
    hasDept: true,
    orderType: 'self_pickup',
    idemSalt: 'sale-pickup',
    listPath: '/inventory/sale',
    listQuery: { type: 'self_pickup', kind: 'order' },
  },
  [SALE_DOC_TYPES.SELF_PICKUP_RETURN]: {
    title: '新建自提退单',
    shortTitle: '自提退单',
    /* 🔴 v459：原 sub/hint/tip 三条内联说明已移除，仅保留业务逻辑，界面更简洁。 */
    whLabel: '退货仓库',
    priceLabel: '退货价',
    tblTitle: '退货明细',
    saveLabel: '保存退货单',
    isReturn: true,
    hasDriver: false,
    hasDept: false,
    orderType: 'self_pickup',
    idemSalt: 'sale-pickup-ret',
    listPath: '/inventory/sale',
    listQuery: { type: 'self_pickup', kind: 'return' },
  },
  [SALE_DOC_TYPES.VEHICLE_SALE_ORDER]: {
    title: '新建车销订单',
    shortTitle: '车销订单',
    /* 🔴 v459：原 sub/hint 两条内联说明已移除（tip 已于 v458 清掉），仅保留业务逻辑。 */
    whLabel: '销售仓库',
    priceLabel: '销售价',
    tblTitle: '商品明细',
    saveLabel: '保存订单',
    isReturn: false,
    hasDriver: true,
    hasDept: true,
    orderType: 'vehicle_sale',
    idemSalt: 'sale-vehicle',
    listPath: '/inventory/sale',
    listQuery: { type: 'vehicle_sale', kind: 'order' },
  },
  [SALE_DOC_TYPES.VEHICLE_SALE_RETURN]: {
    title: '新建车销退单',
    shortTitle: '车销退单',
    /* 🔴 v459：原 sub/hint/tip 三条内联说明已移除，仅保留业务逻辑，界面更简洁。 */
    whLabel: '退货仓库',
    priceLabel: '退货价',
    tblTitle: '退货明细',
    saveLabel: '保存退货单',
    isReturn: true,
    hasDriver: true,
    hasDept: false,
    orderType: 'vehicle_sale',
    idemSalt: 'sale-vehicle-ret',
    listPath: '/inventory/sale',
    listQuery: { type: 'vehicle_sale', kind: 'return' },
  },
}

/* ---------------------------------------------------------------------------
   采购侧 2 种
   ---------------------------------------------------------------------------
   舟谱「创建采购退货订单」截图逐项核过：表单头 = `*供应商` / `*经办人` /
   `*部门` / `*仓库` / 单据日期 / 备注，明细列 = 商品名称 / 单位 / 参考成本价 /
   `*采购进价` / `*订单数量` / 期望生产日期 / `*订单金额` / 各类库存。
   🔴 **采购订单的仓库标签仍叫「入库仓库」**（不是舟谱的「仓库」）：本系统的
      采购动作叫「确认**入库**」，标签与动作同名是 2026-10-07 老板拍板的全站口径
      （见 `constants/psiLabels.js` 文件头），不退。
   --------------------------------------------------------------------------- */
const PURCHASE_CFG = {
  [PURCHASE_DOC_TYPES.PURCHASE_ORDER]: {
    title: '新建采购订单',
    /* 同一条 path 上的另外两个「来源」标题 / 副标题（`?copy=` / `?edit=`）。
       🔴 与 `title` 放在一起，是因为它们**只差一个词**；拆到别处必然有人改了
          `title` 忘改 `copyTitle`，出现「复制采购单」+「向供应商下单…」这种
          自相矛盾的组合。 */
    copyTitle: '复制采购单',
    editTitle: '编辑采购单',
    shortTitle: '采购订单',
    /* 🔴 v459：原 copySub/editSub/sub/hint/tip 五条内联说明已移除，复制/编辑模式不再显示副标题（界面更简洁，业务逻辑不变）。 */
    partnerLabel: '供应商',
    whLabel: '入库仓库',
    priceLabel: '采购价',
    tblTitle: '商品明细',
    saveLabel: '保存订单',
    isReturn: false,
    listPath: '/inventory/purchase',
    listQuery: { kind: 'order' },
  },
  [PURCHASE_DOC_TYPES.PURCHASE_RETURN]: {
    title: '创建采购退货订单',
    /* ⚠️ 退货单**没有**「复制 / 编辑」入口（列表页不给这两个动作、也没有
       `?copy=` / `?edit=` 的读法）⇒ 这里直接沿用 title 作兜底，
       免得有人后来加了入口却拿到 `undefined` 标题（空白 h2）。
       🔴 v458：原 `sub` / `copySub` / `editSub` / `hint` / `tip` 五条内联说明
       （「把货退回供应商…」「退货不用挑原采购单…」「小单位填写…」）已移除，
       仅保留业务逻辑，界面更简洁。小单位口径的口径说明见 `PurchaseReturnForm` 的 `onPick` 注释。 */
    copyTitle: '创建采购退货订单',
    editTitle: '创建采购退货订单',
    shortTitle: '采购退货单',
    partnerLabel: '供应商',
    whLabel: '退货仓库',
    priceLabel: '退货价',
    tblTitle: '退货明细',
    saveLabel: '保存退货单',
    isReturn: true,
    listPath: '/inventory/purchase',
    listQuery: { kind: 'return' },
  },
}

/* ---------------------------------------------------------------------------
   调拨（1 种，且**没有**退单）
   ---------------------------------------------------------------------------
   🔴 老板 2026-10-11 口径：**调拨不需要调拨退单** —— 舟谱也没有这个类型。
      所以这里只有一种配置；`TRANSFER_DOC_TYPES` 保留成对象是为了与上面两组
      同构（调用方不必为「只有一种」写特例）。
   🔴 调拨**必须**是双仓：`sale_orders` 只有一个 `warehouse_id`，表达不了
      「调出 → 调入」⇒ 走 `transfer_orders`（`from_warehouse_id` / `to_warehouse_id`）。
      这也是拆分前 `?type=transfer` 那个入口**名不副实**的根源：它建出来的是
      一张 `order_type='transfer'` 的销售单，只有**一个**仓库。

   舟谱「创建调拨订单」截图：表单头 = `*调出仓` / `*调入仓` / 单据日期 / 司机 /
   `*搬运费` / `*经办人` / 备注；明细列 = 商品名称 / 条码 / 单位 / `*订单数量` /
   订单数量(混合) / 可用库存(调出仓) / 可用库存(调入仓) / 实际库存(调出仓) /
   实际库存(调入仓) / 备注。
   ⚠️ 我方**没有**「搬运费」这一列（`transfer_orders` 表无此列）⇒ 不放这一格
      （放一个填了不落库的输入框就是假入口）。这是**已知差距**，不是漏抄；
      要补得先加列 + 决定分摊口径（属于成本核算，另立项）。
   --------------------------------------------------------------------------- */
const TRANSFER_CFG = {
  [TRANSFER_DOC_TYPES.TRANSFER_ORDER]: {
    title: '新建调拨单',
    shortTitle: '调拨单',
    /* 🔴 v459：原 sub/hint/tip 三条内联说明已移除（TransferDocForm 的 hint/tip 已补 v-if 隐藏）。 */
    tblTitle: '调拨明细',
    saveLabel: '保存调拨单',
    idemSalt: 'transfer',
    listPath: '/inventory/transfer',
  },
}

/* ---------------------------------------------------------------------------
   取配置 —— 三个 `xxxDocConfig()` 是页面拿到配置的**唯一入口**
   ---------------------------------------------------------------------------
   🔴 未知类型键**不抛异常**，而是回落到该组的第一个类型 + 一条控制台警告。
      为什么：抛异常会让整页白屏（错误边界把整个进销存壳子也一起拆掉），
      而「页面白屏」比「页面出来了但标题不对」难排查得多。回落 + 警告 =
      症状可见（标题明显不对）且线索明确（控制台指名道姓）。
   ⚠️ `console.warn` 是**故意的**：这一层不该静默。
   --------------------------------------------------------------------------- */
function pick (table, key, groupName, fallbackKey) {
  const hit = table[key]
  if (hit) return hit
  console.warn(
    `[inventory] 未知单据类型 「${key}」（${groupName}）—— 已回落到「${fallbackKey}」。`
    + ` 合法取值：${Object.keys(table).join(' / ')}`)
  return table[fallbackKey]
}

/** 销售侧配置。`type` 取 `SALE_DOC_TYPES` 里的值。 */
export function saleDocConfig (type) {
  return pick(SALE_CFG, type, '销售建单', SALE_DOC_TYPES.SELF_PICKUP_ORDER)
}

/** 采购侧配置。`type` 取 `PURCHASE_DOC_TYPES` 里的值。 */
export function purchaseDocConfig (type) {
  return pick(PURCHASE_CFG, type, '采购建单', PURCHASE_DOC_TYPES.PURCHASE_ORDER)
}

/** 调拨配置。`type` 取 `TRANSFER_DOC_TYPES` 里的值。 */
export function transferDocConfig (type) {
  return pick(TRANSFER_CFG, type, '调拨建单', TRANSFER_DOC_TYPES.TRANSFER_ORDER)
}

/* ---------------------------------------------------------------------------
   「旧共用路径」→「新独立路径」的重定向表（供路由的 `redirect` 用）
   ---------------------------------------------------------------------------
   🔴 为什么要有这一层：旧链接**已经在生产里**（书签 / 列表页按钮 / 工作台按钮 /
      别人贴过来的地址）。拆页面时把旧路径直接删掉 = 那些入口全部静默 404，
      而用户只会说「点了新建没反应」。
   🔴 未知 `type` 一律落**自提订单**（与拆分前 `InvSaleNew.vue` 的兜底一致：
      不把脏 query 传下去，也不为了让脏值有去处而猜一个别的类型）。
   ⚠️ **不要把 `transfer` 也塞进销售侧那张表** —— 它现在走的是另一张表
      （`transfer_orders`），不是 `sale_orders` 的一个 `order_type`。
   --------------------------------------------------------------------------- */
const LEGACY_SALE_ROUTES = {
  'self_pickup|order':  DOC_PATHS.selfPickupOrder,
  'self_pickup|return': DOC_PATHS.selfPickupReturn,
  'vehicle_sale|order':  DOC_PATHS.vehicleSaleOrder,
  'vehicle_sale|return': DOC_PATHS.vehicleSaleReturn,
  'transfer|order': DOC_PATHS.transferOrder,
  /* `transfer|return` **不给**落点 —— 调拨没有退单（老板拍板）。
     落到调拨建单页会把「退单」这个不存在的概念悄悄变成建一张调拨单。 */
}

/**
 * 把 `?type=&kind=` 解析成新的独立路径。
 * @param {string} type `self_pickup` | `vehicle_sale` | `transfer` | 空（空 = 自提）
 * @param {string} kind `order` | `return` | 空（空 = 订单）
 * @returns {string} 新路径；调拨退单 / 未知组合落自提订单
 */
export function legacySalePath (type, kind) {
  const t = String(type || '').trim() || 'self_pickup'
  const k = String(kind || '').trim() || 'order'
  const hit = LEGACY_SALE_ROUTES[`${t}|${k}`]
  if (hit) return hit
  console.warn(
    `[inventory] 旧链接的 ?type=${t}&kind=${k} 没有对应页面（调拨没有退单）`
    + ` —— 已转到「新建自提订单」。`)
  return DOC_PATHS.selfPickupOrder
}

/** 采购旧路径解析：`?kind=return` → 采购退货单，其余 → 采购订单。 */
export function legacyPurchasePath (kind) {
  return String(kind || '').trim() === 'return'
    ? DOC_PATHS.purchaseReturn
    : DOC_PATHS.purchaseOrder
}
