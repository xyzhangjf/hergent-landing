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
  // 2026-09-16：改名 / 改日期（仅 open 期次）。此前只有 create/close/delete ⇒
  // 名字打错只能「关闭→删除」，而删除会级联删掉该期全部报单/定稿/付款，不可恢复。
  updatePeriod: (pid, body) => api(`/api/forecast/periods/${pid}`, { method: 'PATCH', body }),
  // 2026-09-17：复制期次。`copyPeriod` = 新建一个期次并只带源期的**商品清单**；
  // `seedPeriod` = 把源期清单填入**已存在**的期次（空期次用，不必先删再建）。
  // 🔴 两者都刻意**不带**报单数量 / 加单 / 定稿 —— 加单与定稿的归属键是
  //    (period_start, period_end) 日期窗口而不是期次 id，带过来会让两期**共用同一份**。
  copyPeriod: (pid, body) => api(`/api/forecast/periods/${pid}/copy`, { method: 'POST', body }),
  seedPeriod: (pid, body) => api(`/api/forecast/periods/${pid}/seed`, { method: 'POST', body }),
  closePeriod: (pid) => api(`/api/forecast/periods/${pid}/close`, { method: 'POST' }),
  // v219：关闭（=定稿）此前是**单向**的，误点一次即永久锁死、无补救 ⇒ 重开是唯一补救路径。
  // ⚠️ 副作用必须让用户知道：重开后该期次重新出现在小程序 open 列表 ⇒ **销售又能报单了**。
  reopenPeriod: (pid) => api(`/api/forecast/periods/${pid}/reopen`, { method: 'POST' }),
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

/* ---- 对账工作流（⚠️ 页面已于 v197 撤下，本组接口暂留不删） ----
   三步向导页面（Reconciliation.vue）已移除，原因见 router/index.js 的注释。
   后端 /api/reconciliation/* 保留：重做方案要拿它做「存量入口」灰度，
   且客户历史对账记录还在库里。新代码请勿再基于本组的 customerMatch /
   customerConfirm 做增量 —— 它们输入的「客户声称金额」是人工口述的单一数字，
   无法承载三类场景（厂家 / 客户 / 银行）的格式差异。 */
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

/* ---- 货损核算（月度 · 期间流水口径 · 手工填报）----
   ⚠️ 与上面的 lossApi **不是一回事**：lossApi 是"配方驱动的批次效期预测"（扫库存算
   预计货损金额），本模块是"舟谱流水口径的期间实际货损核算"（算货损率）。别混用。

   阶段一（当前）：手工填报 + 主体维护 + 结账 + 叫法映射，全部已可用。
   阶段二（未实现）：importPreview / importExecute / importBatches —— 后端当前返回
     501 + 明确文案；调用方按 `err.status === 501` 走"下一阶段"提示分支。
     这三个方法**刻意现在就写好**：前端接线与后端路由位置先对齐，
     下一步只换后端实现，前端零改动。 */
export const lossAccountingApi = {
  bootstrap: (period = '') =>
    api(`/api/loss/accounting/bootstrap?period=${encodeURIComponent(period)}`),
  periods: () => api('/api/loss/accounting/periods'),
  summary: (period) =>
    api(`/api/loss/accounting/summary?period=${encodeURIComponent(period)}`),
  detail: (period, rowKind, subjectKey) =>
    api(`/api/loss/accounting/detail?period=${encodeURIComponent(period)}`
      + `&row_kind=${encodeURIComponent(rowKind)}`
      + `&subject_key=${encodeURIComponent(subjectKey)}`),
  health: (period) =>
    api(`/api/loss/accounting/health?period=${encodeURIComponent(period)}`),
  /* 跨期序列 —— 仪表盘的唯一数据源（月列表 / 柱状图 / 指标卡 / 各副图）。
     `from`/`to` 都是 `YYYY-MM`；不传 to 时后端默认到本月。
     ⚠️ **没有 pricing 入参**：计价口径是全期唯一的配置（见后端模块铁律①），
        传了也不会变数 —— 那种"切了没反应"的旋钮不接。 */
  trend: ({ from = '', to = '', limit = 0 } = {}) =>
    api('/api/loss/accounting/trend'
      + `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${limit}`),
  roles: () => api('/api/loss/accounting/roles'),
  renameRole: (role, body) =>
    api(`/api/loss/accounting/roles/${encodeURIComponent(role)}`, { method: 'PUT', body }),
  getConfig: () => api('/api/loss/accounting/config'),
  saveConfig: (body) => api('/api/loss/accounting/config', { method: 'PUT', body }),
  saveManual: (body) => api('/api/loss/accounting/manual', { method: 'PUT', body }),
  saveSubject: (body) => api('/api/loss/accounting/subjects', { method: 'PUT', body }),
  deleteSubject: (sid) => api(`/api/loss/accounting/subjects/${sid}`, { method: 'DELETE' }),
  recompute: (period) =>
    api('/api/loss/accounting/recompute', { method: 'POST', body: { period } }),
  close: (period) => api('/api/loss/accounting/close', { method: 'POST', body: { period } }),
  reopen: (period) => api('/api/loss/accounting/reopen', { method: 'POST', body: { period } }),
  importPreview: (body) =>
    api('/api/loss/accounting/import/preview', { method: 'POST', body }),
  importExecute: (body) =>
    api('/api/loss/accounting/import/execute', { method: 'POST', body }),
  importBatches: (period = '') =>
    api(`/api/loss/accounting/import/batches?period=${encodeURIComponent(period)}`),
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
  // 历史门店授权（在旧「员工档案 → 分配门店」配过、尚未纳入报单配置的门店）。
  // 2026-09-19 起员工档案入口已移除，写端只剩本页 —— 靠这个清单把「看得到、没处改」
  // 的那部分门店提示出来，补一条映射即收敛。
  legacyStores: () => api('/api/report-mappings/legacy-stores'),
  /* v216（2026-09-20）：**收回**一条历史门店授权（`employee_stores` 单行）。
     在此之前只有上面的 GET、没有写端 ⇒ 落在历史层的门店（如用户配的「一分利 / 一扫光」）
     变成「小程序看得到、后台改不掉」。与 GET 成对：GET 列出来，DELETE 收回去。 */
  revokeLegacyStore: (employeeId, storeId) =>
    api(`/api/report-mappings/legacy-stores/${employeeId}/${storeId}`, { method: 'DELETE' }),
  importFile: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api('/api/report-mappings/import', { method: 'POST', raw: true, body: fd })
  },
}

/* ---- 小程序员工账号与门店（老板配置） ---- */
export const staffAccountApi = {
  createAccount: (body) => api('/api/forecast-submissions/staff-accounts', { method: 'POST', body }),
  // 2026-09-19 收敛：`allStores` / `setStores` 已移除 —— 「报单人的门店」唯一配置入口
  // 是「预报订单管理 → 报单配置」（见 reportMappingApi）。后端两个接口仍保留
  // （未删，避免破坏兼容与脚本），但前端不再有第二入口。
}

/* ---- 报单汇总表（矩阵）：汇总 + 保存（原审批流 pending/approve/reject 已废弃，见决策 2026-08-27） ---- */
export const forecastApproveApi = {
  summary: (date = '', start = '', end = '', periodId = 0) => {
    const q = []
    if (date) q.push('date=' + date)
    if (start) q.push('start=' + start)
    if (end) q.push('end=' + end)
    if (periodId) q.push('period_id=' + periodId)
    return api('/api/forecast-submissions/summary' + (q.length ? '?' + q.join('&') : ''))
  },
  saveMatrix: (body) => api('/api/forecast-submissions/save-matrix', { method: 'POST', body }),
  /* v213：数量录入的**校验规格**（上限 + 五类文案）—— 与后端同一个来源
     （`server/db/queries/forecast_rules.py`）。Web 交叉表取它替掉写死的 `QTY_MAX=999999`，
     让「前端预检」与「后端门禁」用同一组判据、同一句文案（此前是四个口径各写一套）。 */
  validationSpec: () => api('/api/forecast-submissions/validation-spec'),
}

/* ---- 商品主档（Web 预报模块网格直编 / 粘贴） ---- */
export const productsApi = {
  grid: () => api('/api/products/grid'),
  /* v196：`opts` 透传 —— 改单保存那一步要单独给更长超时（默认 20 秒对"商品档案 + 数量矩阵"
     这一串写太紧：正常 0.2 秒就能回，长超时纯兜底；真慢下来时至少不会在 20 秒被硬掐断）。
     ⚠️ 默认值 `{}` ⇒ 既有两个调用方（ProductArchive 单行）行为一字不变。 */
  bulkUpsert: (rows, opts = {}) => api('/api/products/bulk-upsert', { method: 'POST', body: { rows }, ...opts }),
  // v157 存量商品批量补厂价：items = [{id, factory_price}] 或 [{barcode, factory_price}]（导出回填走条码）
  batchFactoryPrice: (items) => api('/api/products/batch-factory-price', { method: 'POST', body: { items } }),
  // v161 自定义列的值：批量写（合并写，值为空 = 删该键）。
  // 后端会按列注册表校验 key —— 未知列/系统列一律 400，绝不静默丢弃。
  extraValues: (items) => api('/api/products/extra-values', { method: 'POST', body: { items } }),
  // v158 厂价闸门（per-tenant 开关，**默认关闭**）：开启后两条上报路径都会拒收「没录厂价」的商品行。
  // 判据在后端 db.factory_price_verdict 一处；本接口只读写开关值 + 回报还有多少没补。
  factoryPriceGate: () => api('/api/forecast/factory-price-gate'),
  setFactoryPriceGate: (enabled) =>
    api('/api/forecast/factory-price-gate', { method: 'PUT', body: { enabled } }),
  // v184c 商品「修改记录」（字段级留痕：谁 · 何时 · 哪个字段 · 改前 → 改后）。
  //   后端**早就在写**（`product_update` 内部自动调 `log_product_changes`，落 `product_change_logs` 表，
  //   本租户已积累 414 条 / 覆盖 311 个商品），查询端点 `GET /api/products/{pid}/changes`
  //   与 `erp_db` 门面导出也都已存在 —— **唯独前端零入口**，于是「改了但查不到谁改的」。
  //   本方法只是把它接出来，零后端改动。
  changes: (pid) => api('/api/products/' + pid + '/changes'),
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

/* ---- v161 列注册表（**服务端权威**）----
   为什么要有它：在此之前"哪些列不可删"是前端 MASTER_COL_DEFS.deletable 说了算，
   自定义列的定义和值只存 localStorage（换设备即丢、不参与导入导出计算）。
   现在 system 段是服务端下发的**不可删除列**，custom 段是用户自建列（值走 products.extra-values）。 */
export const forecastColumnsApi = {
  list: () => api('/api/forecast/columns'),
  add: (col) => api('/api/forecast/columns', { method: 'POST', body: col }),
  update: (key, patch) => api('/api/forecast/columns/' + encodeURIComponent(key), { method: 'PUT', body: patch }),
  remove: (key) => api('/api/forecast/columns/' + encodeURIComponent(key), { method: 'DELETE' }),
}

/* ---- Excel 导入（FormData，走统一 api 封装） ---- */
export const importApi = {
  template: (category) => api(`/api/import/template/${category}`),
  /* v158 待补厂价清单导出（后端生成 xlsx，含「商品编号」列作导回钥匙）。
     为什么走后端而不在前端用 SheetJS 造：钥匙规则（编号优先/条码兜底、共码与无条码商品）
     必须在**唯一一处**实现，否则前端一份、后端一份 → 静默漂移（v158 实测两者的行为已经不一致）。 */
  factoryPriceTemplate: async ({ brand = '', category = '' } = {}) => {
    const token = localStorage.getItem('hergent_v2_token') || ''
    const csrf = localStorage.getItem('hergent_v2_csrf') || ''
    const tenant = localStorage.getItem('hergent_v2_tenant') || ''
    const qs = new URLSearchParams()
    if (brand) qs.set('brand', brand)
    if (category) qs.set('category', category)
    const url = '/api/import/factory-price-template' + (qs.toString() ? `?${qs}` : '')
    const res = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(tenant ? { 'X-Tenant-Id': String(tenant) } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.detail || d.message || '导出失败')
    }
    return res.blob()
  },
  /* v158 导回填好厂价的清单：按「商品编号」优先、条码兜底回写（只改 factory_price 一列）。 */
  factoryPriceApply: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api('/api/import/factory-price-apply', { method: 'POST', body: fd, timeout: 60000 })
  },
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

/* ---- 通知中心（P0-1a：把只写不读的 message_center 接出来）----
   briefing 是「今日该干什么」的收敛视图：按告警种类聚合，并回传 folded（被折叠的条数）。
   folded 必须展示，否则等于把 2 万条积压抹掉。 */
export const messagesApi = {
  list: ({ unreadOnly = false, limit = 30, offset = 0 } = {}) =>
    api(`/api/messages?unread_only=${unreadOnly ? 1 : 0}&limit=${limit}&offset=${offset}`),
  briefing: () => api('/api/messages/briefing'),
  markRead: (mid) => api(`/api/messages/${mid}/read`, { method: 'POST' }),
  markAllRead: () => api('/api/messages/read-all', { method: 'POST' }),
}

/* ---- v159 价格渠道（渠道是**数据**不是代码：客户自行配置，加一条渠道不用改代码）----
   取价的唯一实现在后端 db/queries/prices.py（resolve_report_channel / resolve_channel_price
   / resolve_channel_code）。**前端不得另算一份价** —— 试算接口走的就是模板生成同一个函数，
   保证「界面上看到的」＝「生成时用的」。 */
export const priceChannelApi = {
  list: () => api('/api/price-channels'),
  sources: () => api('/api/price-channels/sources'),
  create: (data) => api('/api/price-channels', { method: 'POST', body: data }),
  update: (cid, data) => api(`/api/price-channels/${cid}`, { method: 'PUT', body: data }),
  remove: (cid) => api(`/api/price-channels/${cid}`, { method: 'DELETE' }),
  setDefault: (cid) => api(`/api/price-channels/${cid}/default`, { method: 'PUT' }),
  matrix: (cid, { keyword = '', offset = 0, limit = 50 } = {}) =>
    api(`/api/price-channels/${cid}/matrix?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${limit}`),
  saveMatrix: (cid, items) =>
    api(`/api/price-channels/${cid}/matrix`, { method: 'POST', body: { items } }),
  summary: (cid) => api(`/api/price-channels/${cid}/summary`),
  /* 试算：商品 + 报单对象 → 取到哪个渠道的价、来源、是否缺失、缺了会怎么回退 */
  resolve: ({ productId, mappingId = 0, channelId = 0 }) =>
    api('/api/price-channels/resolve', {
      method: 'POST',
      body: { product_id: productId, mapping_id: mappingId, channel_id: channelId },
    }),
}

/* v228 客户专属价（后端表 `customer_prices`）—— 「客户 × 商品 → 小/中/大三档价」。
   与上面的「渠道价」互补：渠道价按渠道统一定价，专属价只对**某一个客户**生效、
   优先级更高（定价引擎第 4 层 `customer_specific`，见 domain/pricing_engine.py:501）。
   生产 `tenant_1` 已有 8024 行 / 518 客户 / 65 商品 —— 但此前**前端零界面**，
   这 8024 条在系统里「存在却看不见」，本模块就是把它接出来。

   🔴 保存时**只提交有值的档**：后端 `set_customer_price` 只覆盖传进去的列，
      提交 0 会把库里已有那一档清零（旧实现更狠 —— 整行 REPLACE，见其 docstring）。

   🔴 路径是 `/api/customer-prices`，**没有 `/crm` 段** ——
      `routers/crm.py` 的 `APIRouter(prefix="/api")` + `server.py:936 include_router(crm_router)`
      （无附加 prefix）⇒ 真实路径就是 `/api/customer-prices`。生产 openapi.json 亦如此。
      文件名叫 crm 只是代码组织，不进 URL。 */
export const custPriceApi = {
  list: ({ keyword = '', customerId = 0, productId = 0, onlyPriced = '', sort = 'customer',
           offset = 0, limit = 50 } = {}) => {
    const qs = new URLSearchParams({
      keyword, customer_id: customerId, product_id: productId,
      only_priced: onlyPriced, sort, offset, limit,
    })
    return api('/api/customer-prices?' + qs.toString())
  },
  /* 单行写入（后端一次一行）；调用方改多行时自行并发，回执按行归并。 */
  save: (row) => api('/api/customer-prices', { method: 'POST', body: row }),
  byCustomer: (cid) => api(`/api/customer-prices/${cid}`),
  templateUrl: () => '/api/import/template-file/customer_prices',
}

/* v160 租户业务参数 —— 舟谱模板的「业务员 / 部门 / 仓库」列、自提单号起始序号、
   商品名内嵌的下单主体清单。原先这些值硬编码在后端代码里、且是**一家客户的值**，
   多租户下会把别家公司与别人的人名写进模板。读写唯一实现见后端
   db/queries/business_profile.py，前端不做任何推导。 */
export const businessProfileApi = {
  get: () => api('/api/forecast/business-profile'),
  save: (data) => api('/api/forecast/business-profile', { method: 'PUT', body: data }),
}
