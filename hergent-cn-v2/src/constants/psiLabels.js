/* ============================================================
   psiLabels.js — 进销存的「英文枚举 → 中文」词表（**唯一来源**）
   ------------------------------------------------------------
   🔴 立场：**界面上一律不出现英文枚举**。使用者是不懂英文的经销商老板；
      `received` / `partial` / `self_pickup` 这类值只许出现在代码与接口里。

   🔴 词表**不是拍脑袋**：每条都对着后端 DB 的 CHECK 约束或写入口的字面量核过 ——
      · purchase_orders.status  CHECK ∈ draft / pending_approval / confirmed /
        received / partial / returned / cancelled        （erp_db.py:1804）
      · sale_orders.status      CHECK ∈ draft / confirmed / delivered / signed /
        rejected / returned / cancelled                   （erp_db.py:1806）
      · delivery_status         取值域 = routers/delivery.py 的输入校验：
        ''（未派车）/ assigned / dispatched / delivered / signed / failed
      · order_type              写入口实测只写 self_pickup / transfer
        （routers/zhoupu_documents.py）；产品手册另记 vehicle_sale，一并登记。
      · 效期档位                词表与 `db/queries/inventory.py` 同源（`psi.py` 的 /stock
        就是从那里导入的）。⇒ 前端**只做标签**，阈值一律用接口返回的 `thresholds`，
        **不在前端写死 30 / 90**（写死就成第二份实现，必漂移）。

   ✅ **全站口径已定（2026-10-07 老板拍板）：统一用「已入库 / 部分入库」**，本表**不动**；
      旧壳（erp.hergent.cn）已在同批改成同一口径（`hergent-erp/static/app.js`：采购详情徽标
      ＋ 采购列表徽标）。理由：进销存整条链是「采购 → **入库** → 销售 → **出库**」，
      页内按钮也叫「确认入库」⇒ **徽标与动作同名**。
      ⚠️ 旧壳原先动作叫「确认入库」、徽标却叫「已收货」—— **它本身就自相矛盾**，
         所以这次统一是「修矛盾」，不是「迁就新前端」。
   ============================================================ */

/* ---- 采购单状态 ---- */
export const PO_STATUS = {
  draft:            { text: '草稿',     tag: 'info' },
  pending_approval: { text: '待审批',   tag: 'warn' },
  confirmed:        { text: '已确认',   tag: 'info' },
  received:         { text: '已入库',   tag: 'ok' },
  partial:          { text: '部分入库', tag: 'warn' },
  returned:         { text: '已退货',   tag: 'bad' },
  cancelled:        { text: '已取消',   tag: '' },
}

/* ---- 销售单状态 ---- */
export const SO_STATUS = {
  draft:     { text: '草稿',   tag: 'info' },
  confirmed: { text: '已确认', tag: 'info' },
  delivered: { text: '已发货', tag: 'warn' },
  signed:    { text: '已签收', tag: 'ok' },
  rejected:  { text: '已驳回', tag: 'bad' },
  returned:  { text: '已退货', tag: 'bad' },
  cancelled: { text: '已取消', tag: '' },
}

/* ---- 配送状态（`sale_orders.delivery_status`）---- */
export const DELIVERY_STATUS = {
  '':         { text: '未发货',   tag: '' },
  assigned:   { text: '已派车',   tag: 'info' },
  dispatched: { text: '已发车',   tag: 'warn' },
  delivered:  { text: '已送达',   tag: 'ok' },
  signed:     { text: '已签收',   tag: 'ok' },
  failed:     { text: '配送失败', tag: 'bad' },
}

/* ---- 出货方式（`sale_orders.order_type`）---- */
export const ORDER_TYPE = {
  self_pickup:  { text: '自提' },
  transfer:     { text: '调拨' },
  vehicle_sale: { text: '车销' },
}

/* 销售列表「出货方式」筛选下拉：空值 = 全部（后端空串即不过滤） */
export const ORDER_TYPE_OPTIONS = [
  { value: '', text: '全部方式' },
  ...Object.entries(ORDER_TYPE).map(([value, v]) => ({ value, text: v.text })),
]

/* ---- 效期档位（后端 `/api/psi/stock` 的 `expiry_status`）---- */
export const EXPIRY_STATUS = {
  expired:  { text: '已过期',   tag: 'bad' },
  critical: { text: '临期',     tag: 'bad' },
  warning:  { text: '近效期',   tag: 'warn' },
  ok:       { text: '正常',     tag: 'ok' },
  none:     { text: '无到期日', tag: 'warn' },
  unknown:  { text: '日期异常', tag: 'bad' },
}

/* ---- 单据来源（`purchase_orders.source`）----
   取值域对着**写入口**核过（v408）：
     · `purchase.py:344`        → `'manual'`（新前端界面手工建单）
     · `zhoupu_documents.py:751`→ `'zhoupu'`（舟谱导入；生产 79 张历史单走这条，未走 confirm）
     · `hermes_core.py:543`     → `'ai'`（AI 副驾代建）
     · `''`                     → v403 之前建的存量单，**没有来源标注**
   🔴 空值**不猜成「手工」** —— 那是把「不知道」写成事实。显示为 `—`（与 has_items 的口径纪律同源）。 */
export const PO_SOURCE = {
  manual: { text: '手工录入', tag: 'info' },
  zhoupu: { text: '舟谱导入', tag: 'warn' },
  ai:     { text: 'AI 代建',  tag: 'ok' },
}

/* 列表「单据来源」筛选项：空值 = 全部（后端空串即不过滤）
   🔴 `__none__` 是**哨兵**（不是真实来源值）= 只看「未标注来源」的单。
      为什么必须有这一项：生产 81 张采购单的 `source` **全部是空串**（v403 之前建的存量单，
      被 `ADD COLUMN … DEFAULT ''` 填成空）。只给「手工录入 / 舟谱导入 / AI 代建」三项的话，
      老板选「舟谱导入」会得到**空列表且零提示**，读成「没有舟谱导入的单」——
      而实际有 79~81 张。宁可多一个「未标注来源」，也不要一个会骗人的空结果。
      后端同名哨兵在 `db/queries/purchases.py::purchase_order_list`（两处必须同时改）。 */
export const PO_SOURCE_OPTIONS = [
  { value: '', text: '全部来源' },
  ...Object.entries(PO_SOURCE).map(([value, v]) => ({ value, text: v.text })),
  { value: '__none__', text: '未标注来源' },
]

/* ---- 采购结算单状态（`purchase_settlements.status`，v408 P1-9 新增实体）----
   取值域与后端 `db/queries/purchases.py::SETTLEMENT_STATUS` **同一份口径**：
   draft / confirmed / void。改一处必须改另一处。
   ⚠️ `void` 的中文是「已作废」不是「已取消」：结算单作废后**占用随之释放**、单据能重新
      进别的结算单，这与「取消」（什么都没发生过）不是一回事，混用词会让人以为单据被退回。 */
export const SETTLEMENT_STATUS = {
  draft:     { text: '草稿',   tag: 'info' },
  confirmed: { text: '已确认', tag: 'ok' },
  void:      { text: '已作废', tag: 'bad' },
}
export const SETTLEMENT_STATUS_OPTIONS = [
  { value: '', text: '全部状态' },
  ...Object.entries(SETTLEMENT_STATUS).map(([value, v]) => ({ value, text: v.text })),
]

/* ---- 结算明细的单据类型（`purchase_settlement_items.ref_type`）---- */
export const SETTLEMENT_REF_TYPE = {
  purchase:        { text: '采购入库', tag: 'info' },
  purchase_return: { text: '采购退货', tag: 'bad' },
}

/* ---- 取值 ---- */
/**
 * 取中文标签。未知值**不静默留空** —— 回落到 `fallback`（默认「未知」）。
 * @param {object} map 上面任意一张词表
 * @param {*} value 后端返回值
 * @param {string} [fallback='未知']
 */
export function textOf(map, value, fallback = '未知') {
  const k = value === null || value === undefined ? '' : String(value)
  return Object.prototype.hasOwnProperty.call(map, k) ? map[k].text : fallback
}

/**
 * 取 `.tag` 修饰类（`ok` / `warn` / `bad` / `info` / 「无修饰 = 中性」）。
 * 供 `<span class="tag" :class="tagOf(...)">` 使用。
 */
export function tagOf(map, value) {
  const k = value === null || value === undefined ? '' : String(value)
  return Object.prototype.hasOwnProperty.call(map, k) ? (map[k].tag || '') : ''
}

/* ---- 金额显示（**唯一实现**）-------------------------------------------------
   🔴 v392b（2026-10-07，上线后真机验收抓到）：本函数原先被**七个页面各抄了一份**，
      唯独 `InvPurchaseNew.vue` 漏抄 ⇒ 模板里 `¥{{ fmtMoney(...) }}` 在运行期抛
      `TypeError: fmtMoney is not a function` ⇒ 整页被 ErrorBoundary 兜底替换
      （连带父容器的页签一起消失），而**构建、类型、路由探针全部是绿的**。
      ⇒ 收敂到这里：一条规则只有一个实现，页面只 import。
   ⚠️ 语义：两位小数 + 千分位。`null/''/undefined` 一律当 0（旧实现如此，逐字保持）。 */
export function fmtMoney(n) {
  return Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/* ---- 复用的说明文案（避免同一句话在多个页面各写一份）----
   ⚠️ 写法受 `hergent-ui-copy-guard` 约束：不讲实现细节（版本号 / 表名 / 内部流程名）、
      不复述眼前已有的按钮或表头。只保留「用户不看就会做错事」的信息。 */
export const PSI_NOTES = {
  /** 单位口径 —— 与后端 `refs._meta.note` 同口径。
      v409（P2-1）改写：三档全给之后，单位**由用户在下拉里选**（不再是"只能按报单单位填"），
      换算与入库折算都是系统的事。旧文案「按报单单位填写」会把新的三档下拉说成不可用。
      ⚠️ 用户视角：只说"选一个单位、换算不用你算"，不提 `base_ratio` / 量纲 / 后端。 */
  unit: '选一个单位下单就行，换算和入库折算都由系统按商品档案算，不用自己乘。',
  /** 效期口径 —— 回答「为什么要填」 */
  expiry: '登记到期日之后，临期预警和「先出最早到期」才会自动生效。',
  /** 库存为空的引导 */
  stockEmpty: '这个仓还没有任何库存。库存要靠采购单到货入库才会产生。',
  /** 有库存但没有到期日 */
  stockNoExpiry: '现有库存里还有没登记到期日的批次 —— 临期预警和「先出最早到期」对它们不生效。',
  /** 入库动作的后果预告（写实际影响，不写内部步骤） */
  confirmIn: '确认后这一单的货会入库，批次号和到期日按明细登记，同时生成应付账款。这一步不可撤销。',
}
