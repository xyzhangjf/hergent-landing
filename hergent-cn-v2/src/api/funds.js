/* ============================================================
   funds.js — 资金管理（Funds）API 封装
   ------------------------------------------------------------
   后端 = 资金管理域 `server/funds_api.py`（router prefix = `/api/funds`）。
   全部走既有已映射前缀 `/api/funds`，不新增权限域（前端可见性在
   `pages.js::PAGE_RULES` 里用 `module:'funds'` + 窄名单 `ADMIN_ROLES+accountant`
   表达，与「设置 › 权限」里的「资金管理」开关同源）。

   ⚠️ 契约同 `client.js`：`api()` 成功返回 `data.data`（无该字段则返回整包）；
      失败抛 `Error`（挂 `err.status`）。页面必须显示错误，不许 `catch {}` 吞掉。
   ============================================================ */
import { api } from './client.js'

function qs(params) {
  const p = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false || v === 0) return
    p.append(k, String(v))
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const fundsApi = {
  /* —— 元信息：单据类型 → 中文名/前缀/对方类型 —— */
  meta: () => api('/api/funds/meta'),

  /* —— 资金账户 —— */
  accounts: () => api('/api/funds/accounts'),
  createAccount: (data) => api('/api/funds/accounts', { method: 'POST', body: data }),
  updateAccount: (id, data) => api(`/api/funds/accounts/${id}`, { method: 'PUT', body: data }),

  /* —— 单据 —— */
  docs: (params) => api(`/api/funds/docs${qs(params)}`),
  doc: (id) => api(`/api/funds/docs/${id}`),
  createDoc: (data) => api('/api/funds/docs', { method: 'POST', body: data }),
  updateDoc: (id, data) => api(`/api/funds/docs/${id}`, { method: 'PUT', body: data }),
  postDoc: (id) => api(`/api/funds/docs/${id}/post`, { method: 'POST' }),
  voidDoc: (id) => api(`/api/funds/docs/${id}/void`, { method: 'POST' }),

  /* —— 余额 / 流水 —— */
  balance: () => api('/api/funds/balance'),
  flow: (params) => api(`/api/funds/flow${qs(params)}`),

  /* —— 对账 —— */
  customerStatement: (params) => api(`/api/funds/statements/customer${qs(params)}`),
  supplierStatement: (params) => api(`/api/funds/statements/supplier${qs(params)}`),

  /* —— 成本 —— */
  costQuery: (params) => api(`/api/funds/cost/query${qs(params)}`),
  costSummary: () => api('/api/funds/cost/summary'),
  costAbnormal: () => api('/api/funds/cost/abnormal'),

  /* —— 其他报表 —— */
  staffDebt: () => api('/api/funds/staff-debt'),
  bankReconcile: (params) => api(`/api/funds/bank-reconcile${qs(params)}`),
}
