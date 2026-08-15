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
  createPeriod: (body) => api('/api/forecast/periods', { method: 'POST', body }),
  closePeriod: (pid) => api(`/api/forecast/periods/${pid}/close`, { method: 'POST' }),
  periodOrders: (periodId) => api(`/api/forecast/orders/${periodId}`),
  submitOrder: (body) => api('/api/forecast/orders', { method: 'POST', body }),
  reviewOrder: (oid, body) => api(`/api/forecast/orders/${oid}/review`, { method: 'POST', body }),
  confirmOrder: (oid) => api(`/api/forecast/orders/${oid}/confirm`, { method: 'POST' }),
  template: (periodId) => api(`/api/forecast/template/${periodId}`),
  accuracy: () => api('/api/forecast/accuracy'),
}

/* ---- 智能审核大脑 ---- */
export const auditApi = {
  searchProducts: (q = '', limit = 50) => api(`/api/forecast-audit/products?q=${encodeURIComponent(q)}&limit=${limit}`),
  compute: (items, opts = {}) => api('/api/forecast-audit/compute', {
    method: 'POST',
    body: { items, ...opts }
  }),
  rebateSummary: () => api('/api/forecast-audit/rebate-summary'),
  save: (body) => api('/api/forecast-audit/save', { method: 'POST', body }),
  orders: () => api('/api/forecast-audit/orders'),
}

/* ---- 返利规则 ---- */
export const rebateApi = {
  list: () => api('/api/rebate-rules'),
  get: (id) => api(`/api/rebate-rules/${id}`),
  create: (body) => api('/api/rebate-rules', { method: 'POST', body }),
  update: (id, body) => api(`/api/rebate-rules/${id}`, { method: 'PUT', body }),
  delete: (id) => api(`/api/rebate-rules/${id}`, { method: 'DELETE' }),
  validate: (body) => api('/api/rebate-rules/validate', { method: 'POST', body }),
  simulate: (body) => api('/api/rebate-rules/simulate', { method: 'POST', body }),
  conflicts: () => api('/api/rebate-rules/conflicts'),
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
