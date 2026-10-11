/* ============================================================
   fundLabels.js —— 资金管理「词表 + 单据元信息」唯一源
   ------------------------------------------------------------
   页面不各自 hardcode 单据中文名 / 对方类型 / 是否需要明细行。
   引擎 FundsDoc.vue 与所有报表页都从这里取，改一处全站一致
   （对齐 UI-SPEC §8 + 仓配规范「词表唯一源」纪律）。
   ============================================================ */

/* 单据类型 → 元信息
   partyType: 对方类型（customer/supplier/internal/none）
   partyLabel: 对方下拉/输入框标签
   itemMode: 明细行模式（null / 'settle' 源单核销 / 'cost' 商品成本）
   dir: 资金方向（in 收 / out 付 / transfer 调拨 / cost 成本） */
export const FUND_DOC_META = {
  receipt:          { label: '收款单',     partyType: 'customer', partyLabel: '客户',   itemMode: null,      dir: 'in' },
  'customer-fee':   { label: '客户费用单', partyType: 'customer', partyLabel: '客户',   itemMode: null,      dir: 'in' },
  'advance-receipt':{ label: '预收款单',   partyType: 'customer', partyLabel: '客户',   itemMode: null,      dir: 'in' },
  writeoff:         { label: '核销单',     partyType: 'customer', partyLabel: '客户',   itemMode: 'settle',  dir: 'in' },
  'sales-settle':   { label: '销货结算单', partyType: 'customer', partyLabel: '客户',   itemMode: 'settle',  dir: 'in' },
  'return-settle':  { label: '退货结算单', partyType: 'customer', partyLabel: '客户',   itemMode: 'settle',  dir: 'in' },
  'other-receivable':{ label: '其他应收单', partyType: 'customer', partyLabel: '客户',  itemMode: null,      dir: 'in' },
  payment:          { label: '付款单',     partyType: 'supplier', partyLabel: '供应商', itemMode: null,      dir: 'out' },
  'supplier-fee':   { label: '供应商费用单', partyType: 'supplier', partyLabel: '供应商', itemMode: null,    dir: 'out' },
  'advance-payment':{ label: '预付款单',   partyType: 'supplier', partyLabel: '供应商', itemMode: null,      dir: 'out' },
  'purchase-settle':{ label: '采购结算单', partyType: 'supplier', partyLabel: '供应商', itemMode: 'settle',  dir: 'out' },
  'internal-fee':   { label: '内部费用单', partyType: 'internal', partyLabel: '员工',   itemMode: null,      dir: 'out' },
  'internal-income':{ label: '内部收入单', partyType: 'internal', partyLabel: '员工',   itemMode: null,      dir: 'in' },
  transfer:         { label: '资金调拨单', partyType: 'none',     partyLabel: '',       itemMode: null,      dir: 'transfer' },
  'in-cost':        { label: '入库核算单', partyType: 'supplier', partyLabel: '供应商', itemMode: 'cost',    dir: 'cost' },
  'out-cost':       { label: '出库核算单', partyType: 'customer', partyLabel: '客户',   itemMode: 'cost',    dir: 'cost' },
  'cost-adjust':    { label: '成本调价单', partyType: 'none',     partyLabel: '',       itemMode: 'cost',    dir: 'cost' }
}

/* 单据类型 → 中文名（列表/详情通用） */
export function fundDocLabel(t) {
  return (FUND_DOC_META[t] && FUND_DOC_META[t].label) || t || '单据'
}

/* 状态中文 + 徽标修饰类（全局 .tag 的 ok/warn/bad/info） */
export const FUND_DOC_STATUS = {
  draft:  { label: '草稿',   tag: 'info' },
  posted: { label: '已过账', tag: 'ok' },
  void:   { label: '已作废', tag: 'bad' }
}
export function fundStatusText(s) {
  return (FUND_DOC_STATUS[s] && FUND_DOC_STATUS[s].label) || '未知'
}
export function fundStatusTag(s) {
  return (FUND_DOC_STATUS[s] && FUND_DOC_STATUS[s].tag) || ''
}

/* 明细行模式 → 列定义（引擎复用） */
export const FUND_ITEM_COLS = {
  settle: [
    { key: 'ref_no',  label: '源单号', placeholder: '如 XS20261011-001', type: 'text' },
    { key: 'amount',  label: '金额',   placeholder: '0.00', type: 'num' }
  ],
  cost: [
    { key: 'product_name', label: '商品', placeholder: '商品名称', type: 'text' },
    { key: 'qty',          label: '数量', placeholder: '0',     type: 'num' },
    { key: 'cost',         label: '单位成本', placeholder: '0.00', type: 'num' }
  ]
}
