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
  setAlias: (pid, alias) => api(`/api/products/${pid}/alias`, { method: 'PUT', body: { alias } }),
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
    return _formPost('/api/chat-attachment', fd)
  },
}

/* ---- AI 技能库（Hermes 技能列表：预置 + AI 自进化） ---- */
export const aiSkillsApi = {
  list: () => api('/api/ai/skills'),
}

/* ---- 员工档案（数据补录） ---- */
export const employeeApi = {
  list: () => api('/api/employees'),
  create: (body) => api('/api/employees', { method: 'POST', body }),
  update: (eid, body) => api(`/api/employees/${eid}`, { method: 'PUT', body }),
}

/* ---- 小程序员工账号与门店（老板配置） ---- */
export const staffAccountApi = {
  createAccount: (body) => api('/api/forecast-submissions/staff-accounts', { method: 'POST', body }),
  allStores: () => api('/api/forecast-submissions/all-stores'),
  setStores: (eid, storeIds) => api(`/api/forecast-submissions/staff/${eid}/stores`, { method: 'PUT', body: { store_ids: storeIds } }),
}

/* ---- 员工预报审批流 ---- */
export const forecastApproveApi = {
  pending: () => api('/api/forecast-submissions/pending'),
  approve: (sid) => api(`/api/forecast-submissions/${sid}/approve`, { method: 'POST', body: {} }),
  reject: (sid, reason) => api(`/api/forecast-submissions/${sid}/reject`, { method: 'POST', body: { reason } }),
  summary: (date = '') => api(`/api/forecast-submissions/summary${date ? '?date=' + date : ''}`),
}

/* ---- Excel 导入（FormData，不走 JSON api 封装） ---- */
import { auth } from './client.js'
export const importApi = {
  template: (category) => api(`/api/import/template/${category}`),
  smartParse: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return _formPost('/api/import/smart-parse', fd)
  },
  oneShot: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return _formPost('/api/import/one-shot', fd)
  },
  preview: (file, category) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('category', category)
    return _formPost('/api/import/preview', fd)
  },
  execute: (file, category, mapping) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('category', category)
    fd.append('mapping', JSON.stringify(mapping || {}))
    fd.append('check_dupes', '1')
    return _formPost('/api/import/execute', fd)
  },
}

async function _formPost(path, fd) {
  const csrf = localStorage.getItem('hergent_v2_csrf') || ''
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: fd,
  })
  if (res.status === 401) { auth.token = ''; window.location.hash = '#/login'; throw new Error('登录已过期') }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || data.message || `请求失败 (${res.status})`)
  return data
}
