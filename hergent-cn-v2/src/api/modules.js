/* ============================================================
   modules.js — 领域 API 封装
   对接 hergent-erp 后端真实接口
   ============================================================ */
import { api } from './client.js'

/* ---- Dashboard / 工作台 ---- */
export const dashboardApi = {
  todayProfit: () => api('/api/dashboard/today-profit'),
  recentActions: (limit = 8) => api(`/api/dashboard/recent-actions?limit=${limit}`),
}

/* ---- 近效期 / 货损 ---- */
export const expiryApi = {
  scan: (warehouseId = 0) => api(`/api/batch/expiry-scan?warehouse_id=${warehouseId}`),
  nearExpiryList: () => api('/api/inventory/near-expiry'),
}

/* ---- 预报订货 ---- */
export const forecastApi = {
  periods: () => api('/api/forecast/periods'),
  orderBoard: () => api('/api/forecast/order-board'),
  createPeriod: (body) => api('/api/forecast/periods', { method: 'POST', body }),
  closePeriod: (pid) => api(`/api/forecast/periods/${pid}/close`, { method: 'POST' }),
  deletePeriod: (pid) => api(`/api/forecast/periods/${pid}`, { method: 'DELETE' }),
  periodOrders: (periodId) => api(`/api/forecast/orders/${periodId}`),
  submitOrder: (body) => api('/api/forecast/orders', { method: 'POST', body }),
  reviewOrder: (oid, body) => api(`/api/forecast/orders/${oid}/review`, { method: 'POST', body }),
  confirmOrder: (oid) => api(`/api/forecast/orders/${oid}/confirm`, { method: 'POST' }),
  template: (periodId) => api(`/api/forecast/template/${periodId}`),
  accuracy: () => api('/api/forecast/accuracy'),
  payBalance: () => api('/api/forecast/payments/balance'),
  payBalanceSave: (body) => api('/api/forecast/payments/balance', { method: 'POST', body }),
  payCompute: (body) => api('/api/forecast/payments/compute', { method: 'POST', body }),
  payConfirm: (body) => api('/api/forecast/payments/confirm', { method: 'POST', body }),
  zhoupuTemplate: (body) => api('/api/forecast/zhoupu-template', { method: 'POST', body }),
  // 舟谱订单导入模板附件下载（确定性生成不依赖 LLM）：tid=zhoupu-pickup/transfer/all；窗口=当前期次 order_start~order_end
  zhoupuGenerate: async (tid, { start, end }) => {
    const token = localStorage.getItem('hergent_v2_token') || ''
    const csrf = localStorage.getItem('hergent_v2_csrf') || ''
    const res = await fetch(`/api/forecast/import-templates/${tid}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({ start, end }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.detail || d.message || '生成失败')
    }
    const blob = await res.blob()
    let fname = ''
    const cd = res.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i)
    if (m) fname = decodeURIComponent(m[1])
    else { const m2 = cd.match(/filename="?([^";]+)"?/i); if (m2) fname = m2[1] }
    let warnings = ''
    try { warnings = decodeURIComponent(res.headers.get('X-Template-Warnings') || '') } catch (e) { warnings = '' }
    return { blob, fname, rows: res.headers.get('X-Template-Rows') || '', warnings }
  },
  rebateGap: (body) => api('/api/forecast/rebate-gap', { method: 'POST', body }),
  push: (body) => api('/api/forecast/push', { method: 'POST', body }),
  // P8-2 实时库存临期/缺货预警
  realtimeWarn: (periodId = 0) => api(`/api/forecast/realtime-warn?period_id=${periodId}`),
  // P8-3 预测准确率（按期次）
  accuracyByPeriod: (periodId = 0) => api(`/api/forecast/accuracy?period_id=${periodId}`),
  // P9-4 审批流状态机
  submissionGet: (periodId = 0) => api(`/api/forecast/submission?period_id=${periodId}`),
  submissionPost: (body) => api('/api/forecast/submission', { method: 'POST', body }),
  // P9-5 云端共享批注
  notesGet: (periodId = 0) => api(`/api/forecast/notes?period_id=${periodId}`),
  notesPut: (body) => api('/api/forecast/notes', { method: 'PUT', body }),
  // P9-6 改动留痕审计
  auditGet: (periodId = 0) => api(`/api/forecast/audit?period_id=${periodId}`),
  auditPost: (body) => api('/api/forecast/audit', { method: 'POST', body }),
  // P10-7 配方行业模板库
  recipeTemplatesGet: () => api('/api/forecast/recipe-templates'),
  recipeTemplatesPut: (body) => api('/api/forecast/recipe-templates', { method: 'PUT', body }),
  // P10-8 经营看板 BI 聚合
  biSummary: (periodId = 0) => api(`/api/forecast/bi?period_id=${periodId}`),
  // P10-9 连接器回写（适配器，带降级）
  connectorWriteback: (body) => api('/api/forecast/connector-writeback', { method: 'POST', body }),
  // P11-1 数据缺口补录
  dataGapsGet: () => api('/api/forecast/data-gaps'),
  dataGapSave: (body) => api('/api/forecast/data-gaps', { method: 'POST', body }),
  // P11-2 安全库存 AI 建议
  safetySuggest: (ids = '') => api(`/api/forecast/safety-suggest?ids=${encodeURIComponent(ids)}`),
  // P12-4 偏差归因复盘
  varianceGet: (periodId = 0) => api(`/api/forecast/variance?period_id=${periodId}`),
  varianceAttrGet: (periodId = 0) => api(`/api/forecast/variance-attr?period_id=${periodId}`),
  varianceAttrPut: (body) => api('/api/forecast/variance-attr', { method: 'PUT', body }),
  // P12-5 自然语言改单
  nlEdit: (body) => api('/api/forecast/nl-edit', { method: 'POST', body }),
  // P13-8 供应商 PO 聚合
  supplierPo: (body) => api('/api/forecast/supplier-po', { method: 'POST', body }),
  // P14-1/2 时间序列预测 + 置信区间
  tsForecast: (ids = '', periodId = 0) => api(`/api/forecast/ts-forecast?ids=${encodeURIComponent(ids)}&period_id=${periodId}`),
  // P14-3 节假日/促销日历因子
  calendarFactorsGet: () => api('/api/forecast/calendar-factors'),
  calendarFactorsPut: (body) => api('/api/forecast/calendar-factors', { method: 'PUT', body }),
  // P14-4 滞销/临期反向预警
  slowMovers: () => api('/api/forecast/slow-movers'),
  // P15-5 采购单直发（持久化 + 推送）
  purchaseOrderCreate: (body) => api('/api/forecast/purchase-order', { method: 'POST', body }),
  purchaseOrdersList: () => api('/api/forecast/purchase-orders'),
  purchaseOrderPush: (body) => api('/api/forecast/purchase-order/push', { method: 'POST', body }),
  // P15-6 异常自愈闭环
  interventionsGet: () => api('/api/forecast/interventions'),
  interventionsPost: (body) => api('/api/forecast/interventions', { method: 'POST', body }),
  // P15-7 Hermes 深度联动
  hermesAnalyze: (body) => api('/api/forecast/hermes-analyze', { method: 'POST', body }),
  // P16-8 配方市场
  recipeMarketGet: () => api('/api/forecast/recipe-market'),
  recipeMarketPublish: (body) => api('/api/forecast/recipe-market', { method: 'POST', body }),
  recipeMarketAdopt: (body) => api('/api/forecast/recipe-market/adopt', { method: 'POST', body }),
  // P16-9 数据健康分
  dataHealth: () => api('/api/forecast/data-health'),
}

/* ---- 智能审核大脑 ---- */
export const auditApi = {
  searchProducts: (q = '', limit = 50) => api(`/api/forecast-audit/products?q=${encodeURIComponent(q)}&limit=${limit}`),
  setAlias: (pid, alias) => api(`/api/products/${pid}/alias`, { method: 'PUT', body: { alias } }),
  compute: (items, opts = {}) => api('/api/forecast-audit/compute', {
    method: 'POST',
    body: { items, ...opts }
  }),
  rebateSummary: () => api('/api/forecast-audit/rebate-summary'),
  save: (body) => api('/api/forecast-audit/save', { method: 'POST', body }),
  orders: () => api('/api/forecast-audit/orders'),
  auditPeriod: (body) => api('/api/forecast-audit/audit-period', { method: 'POST', body }),
  adoptAudit: (body) => api('/api/forecast-audit/audit-period/adopt', { method: 'POST', body }),
}

/* ---- 返利规则 ----
 * v112 R5：list 默认含停用（停用/启用三态生命周期管理需要看到已停用规则并恢复）；
 * delete 支持 hard=1 物理删除（前端"删除"按钮明确物理删，停用走 update is_active=0）。
 */
export const rebateApi = {
  list: (includeInactive = 1) => api('/api/rebate-rules?include_inactive=' + (includeInactive ? 1 : 0)),
  get: (id) => api(`/api/rebate-rules/${id}`),
  create: (body) => api('/api/rebate-rules', { method: 'POST', body }),
  update: (id, body) => api(`/api/rebate-rules/${id}`, { method: 'PUT', body }),
  delete: (id, hard = 0) => api(`/api/rebate-rules/${id}` + (hard ? '?hard=1' : ''), { method: 'DELETE' }),
  validate: (body) => api('/api/rebate-rules/validate', { method: 'POST', body }),
  simulate: (body) => api('/api/rebate-rules/simulate', { method: 'POST', body }),
  conflicts: () => api('/api/rebate-rules/conflicts'),
  // v113：批量试算（算法唯一留在后端，前端只渲染 steps[] / tiers[]）
  simulateBatch: (body) => api('/api/rebate-rules/simulate-batch', { method: 'POST', body }),
  // v113：枚举元信息（计法 / 舍入等下拉候选）
  meta: () => api('/api/rebate-rules/meta'),
}

/* ---- 年度返利合同（v113：计法 / 舍入 / 算式链） ---- */
export const rebateContractApi = {
  list: () => api('/api/rebate-contracts'),
  create: (body) => api('/api/rebate-contracts', { method: 'POST', body }),
  update: (id, body) => api(`/api/rebate-contracts/${id}`, { method: 'PUT', body }),
  remove: (id) => api(`/api/rebate-contracts/${id}`, { method: 'DELETE' }),
  months: (id) => api(`/api/rebate-contracts/${id}/months`),
  saveMonths: (id, months) => api(`/api/rebate-contracts/${id}/months`, { method: 'PUT', body: { months } }),
  tiers: (id) => api(`/api/rebate-contracts/${id}/tiers`),
  saveTiers: (id, tiers) => api(`/api/rebate-contracts/${id}/tiers`, { method: 'PUT', body: { tiers } }),
  overview: (id) => api(`/api/rebate-contracts/${id}/overview`),
  accruals: (id) => api(`/api/rebate-contracts/${id}/accruals`),
  accrue: (id, month) => api(`/api/rebate-contracts/${id}/accrue`, { method: 'POST', body: { month } }),
  // v113：合同算式链（透明化面板 / 试算器）
  calcDetail: (id, params = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
    }
    const qs = q.toString()
    return api(`/api/rebate-contracts/${id}/calc-detail` + (qs ? '?' + qs : ''))
  },
  // v113：合同 What-if 试算（用合同快照算，不落库）
  simulate: (body) => api('/api/rebate-contracts/simulate', { method: 'POST', body }),
}

/* ---- 今日要务 ---- */
export const todayApi = {
  get: () => api('/api/today'),
  refresh: () => api('/api/today/refresh', { method: 'POST' }),
}

/* ---- 对账工作流 ---- */
export const reconciliationApi = {
  customers: () => api('/api/reconciliation/customers'),
  customerData: (cid) => api(`/api/reconciliation/customer/${cid}`),
  customerMatch: (body) => api('/api/reconciliation/customer-match', { method: 'POST', body }),
  customerConfirm: (body) => api('/api/reconciliation/customer-confirm', { method: 'POST', body }),
}

/* ---- 催收跟进（Logistify AR Agent 式闭环） ---- */
export const collectionsApi = {
  queue: (params = '') => api(`/api/collections/queue${params}`),
  rebuild: () => api('/api/collections/rebuild', { method: 'POST', body: {} }),
  action: (fid, body) => api(`/api/collections/${fid}/action`, { method: 'POST', body }),
  summary: () => api('/api/collections/summary'),
}

/* ---- 货损工作流（模板 + 中文表单 + 配方存储） ---- */
export const lossApi = {
  getRecipe: () => api('/api/loss/recipe'),
  saveRecipe: (recipe) => api('/api/loss/recipe', { method: 'PUT', body: recipe }),
  run: (recipe = {}) => api('/api/loss/run', { method: 'POST', body: recipe }),
}

/* ---- 算工资工作流（模板 + 中文表单 + 配方存储） ---- */
export const payrollApi = {
  getRecipe: () => api('/api/payroll-workflow/recipe'),
  saveRecipe: (recipe) => api('/api/payroll-workflow/recipe', { method: 'PUT', body: recipe }),
  run: (body = {}) => api('/api/payroll-workflow/run', { method: 'POST', body }),
  confirm: (month = '') => api('/api/payroll/confirm', { method: 'POST', body: { month } }),
  history: (month = '') => api(`/api/payroll-workflow/history?month=${month}`),
}

/* ---- AI 留痕记录（货损/工资工作流共用） ---- */
export const adviceApi = {
  list: (limit = 30) => api(`/api/payroll-workflow/advice?limit=${limit}`),
  confirm: (aid, decision) => api(`/api/payroll-workflow/advice/${aid}/confirm`, { method: 'POST', body: { decision } }),
}

/* ---- 工作流插件清单（B2B 按需开通） ---- */
export const workflowApi = {
  list: (enabledOnly = 0) => api(`/api/workflows?enabled_only=${enabledOnly}`),
  toggle: (key, enabled) => api(`/api/workflows/${key}`, { method: 'PUT', body: { enabled } }),
}

/* ---- AI 对话框文件上传（Excel/CSV 解析成文本，图片存盘） ---- */
export const chatAttachmentApi = {
  upload: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api('/api/chat-attachment', { method: 'POST', raw: true, body: fd })
  },
}

/* ---- AI 技能库（Hermes 技能列表：预置 + AI 自进化） ---- */
export const aiSkillsApi = {
  list: () => api('/api/ai/skills'),
}

/* ---- 员工档案（数据补录） ---- */
export const employeeApi = {
  list: (params) => {
    const qs = params
      ? Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : ''
    return api('/api/employees' + (qs ? `?${qs}` : ''))
  },
  create: (body) => api('/api/employees', { method: 'POST', body }),
  update: (eid, body) => api(`/api/employees/${eid}`, { method: 'PUT', body }),
  toggle: (eid, isActive) => api(`/api/employees/${eid}/toggle`, { method: 'POST', body: { is_active: isActive } }),
}

/* ---- 报单配置（v109）：消化全称↔简称与一人报多对象多单型 ---- */
export const reportMappingApi = {
  list: (params) => {
    const qs = params
      ? Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : ''
    return api('/api/report-mappings' + (qs ? `?${qs}` : ''))
  },
  create: (body) => api('/api/report-mappings', { method: 'POST', body }),
  update: (mid, body) => api(`/api/report-mappings/${mid}`, { method: 'PUT', body }),
  toggle: (mid, isActive) => api(`/api/report-mappings/${mid}/toggle`, { method: 'POST', body: { is_active: isActive } }),
  health: () => api('/api/report-mappings/health'),
  importFile: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api('/api/report-mappings/import', { method: 'POST', raw: true, body: fd })
  },
}

/* ---- 小程序员工账号与门店（老板配置） ---- */
export const staffAccountApi = {
  createAccount: (body) => api('/api/forecast-submissions/staff-accounts', { method: 'POST', body }),
  allStores: () => api('/api/forecast-submissions/all-stores'),
  setStores: (eid, storeIds) => api(`/api/forecast-submissions/staff/${eid}/stores`, { method: 'PUT', body: { store_ids: storeIds } }),
}

/* ---- 报单汇总表（矩阵）：汇总 + 保存（原审批流 pending/approve/reject 已废弃，见决策 2026-08-27） ---- */
export const forecastApproveApi = {
  summary: (date = '', start = '', end = '') => {
    const q = []
    if (date) q.push('date=' + date)
    if (start) q.push('start=' + start)
    if (end) q.push('end=' + end)
    return api('/api/forecast-submissions/summary' + (q.length ? '?' + q.join('&') : ''))
  },
  saveMatrix: (body) => api('/api/forecast-submissions/save-matrix', { method: 'POST', body }),
}

/* ---- 商品主档（Web 预报模块网格直编 / 粘贴） ---- */
export const productsApi = {
  grid: () => api('/api/products/grid'),
  bulkUpsert: (rows) => api('/api/products/bulk-upsert', { method: 'POST', body: { rows } }),
}

/* ---- 预报建议配方（后端就绪；前端 localStorage 兜底，随租户配方下发） ---- */
export const forecastRecipeApi = {
  get: () => api('/api/forecast/recipe'),
  save: (recipes) => api('/api/forecast/recipe', { method: 'PUT', body: { recipes } }),
}

/* ---- 列方案云端（后端就绪；随租户配方下发，前端 localStorage 兜底） ---- */
export const columnSchemeApi = {
  list: () => api('/api/forecast/column-schemes'),
  save: (schemes) => api('/api/forecast/column-schemes', { method: 'PUT', body: { schemes } }),
}

/* ---- Excel 导入（FormData，走统一 api 封装） ---- */
export const importApi = {
  template: (category) => api(`/api/import/template/${category}`),
  templateFile: async (category) => {
    const token = localStorage.getItem('hergent_v2_token') || ''
    const csrf = localStorage.getItem('hergent_v2_csrf') || ''
    const res = await fetch(`/api/import/template-file/${category}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.detail || d.message || '下载失败')
    }
    return res.blob()
  },
  smartParse: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api('/api/import/smart-parse', { method: 'POST', raw: true, body: fd })
  },
  oneShot: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api('/api/import/one-shot', { method: 'POST', raw: true, body: fd })
  },
  preview: (file, category) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('category', category)
    return api('/api/import/preview', { method: 'POST', raw: true, body: fd })
  },
  execute: (file, category, mapping, extra = {}) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('category', category)
    fd.append('mapping', JSON.stringify(mapping || {}))
    fd.append('check_dupes', '1')
    for (const k of Object.keys(extra || {})) if (extra[k] != null) fd.append(k, extra[k])
    return api('/api/import/execute', { method: 'POST', raw: true, body: fd })
  },
}
