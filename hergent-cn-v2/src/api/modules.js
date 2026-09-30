/* ============================================================
   modules.js — 领域 API 封装
   对接 hergent-erp 后端真实接口
   ============================================================ */
import { api } from './client.js'

/* ---- Dashboard / 工作台 ---- */
export const dashboardApi = {
  todayProfit: () => api('/api/dashboard/today-profit'),
  recentActions: (limit = 8) => api(`/api/dashboard/recent-actions?limit=${limit}`),
  /* v259 补货建议：复用既有后端口径 `需补 = 安全库存 - 现有库存 - 在途`，
     不新造算法；后端自带 reason 字段做口径披露。 */
  replenishment: (warehouseId = 1, limit = 20) =>
    api(`/api/ai/replenishment?warehouse_id=${warehouseId}&limit=${limit}`),
}

/* ---- 近效期 / 货损 ---- */
export const expiryApi = {
  scan: (warehouseId = 0) => api(`/api/batch/expiry-scan?warehouse_id=${warehouseId}`),
  nearExpiryList: () => api('/api/inventory/near-expiry'),
}

/* ---- 预报订货 ---- */
/* ---- 报单自动化（v242，租户级契约）----
   后端存储**复用** rebate_target_rules 的四列，但前端**只认这套契约**：
   将来后端把四列物理搬到独立租户级表，本文件与页面零改动。
   见 outputs/报单自动化实现-2026-09-22/01-立项包-PRD-风险评估-技术方案.md */
export const autoPeriodApi = {
  get: () => api('/api/forecast/auto-period'),
  save: (body) => api('/api/forecast/auto-period', { method: 'PUT', body }),
}

export const forecastApi = {
  periods: () => api('/api/forecast/periods'),
  orderBoard: () => api('/api/forecast/order-board'),
  createPeriod: (body) => api('/api/forecast/periods', { method: 'POST', body }),
  // 2026-09-16：改名 / 改日期（仅 open 期次）。此前只有 create/close/delete ⇒
  // 名字打错只能「关闭→删除」，而删除会级联删掉该期全部报单/定稿/付款，不可恢复。
  updatePeriod: (pid, body) => api(`/api/forecast/periods/${pid}`, { method: 'PATCH', body }),
  // 2026-09-17：复制期次。`copyPeriod` = 新建一个期次并只带源期的**商品清单**；
  // `seedPeriod` = 把源期清单填入**已存在**的期次（空期次用，不必先删再建）。
  // 🔴 两者都刻意**不带**报单数量 / 加单 / 定稿 —— 带过来会让两期**共用同一份**。
  //    （v319 订正：原文写「归属键是 (period_start, period_end) 日期窗口」—— **已过时**。
  //      加单分配自 v279 起归属键就是 `period_id`；定稿更是从来就挂在期次状态上。
  //      结论不变（仍不带），但那句旧理由会误导后来者以为窗口是键，故予更正。）
  copyPeriod: (pid, body) => api(`/api/forecast/periods/${pid}/copy`, { method: 'POST', body }),
  seedPeriod: (pid, body) => api(`/api/forecast/periods/${pid}/seed`, { method: 'POST', body }),
  closePeriod: (pid) => api(`/api/forecast/periods/${pid}/close`, { method: 'POST' }),
  // v219：关闭（=定稿）此前是**单向**的，误点一次即永久锁死、无补救 ⇒ 重开是唯一补救路径。
  // ⚠️ 副作用必须让用户知道：重开后该期次重新出现在小程序 open 列表 ⇒ **销售又能报单了**。
  // 🔴 v319（2026-09-29）：拆成两个语义不同的动作 ——
  //    `mode='unlock'`（解锁编辑）：status **不动**，只记「人工接管」⇒ 授权角色可改数，
  //       但**销售报单通道不开**。副作用最小，「我只要改个数」的正确选择。
  //    `mode='full'`（恢复报单，默认）：status 回 open，销售可继续报单（= v219 行为）。
  //    不传 mode 时走 full，旧调用方行为逐字不变。
  reopenPeriod: (pid, mode) => api(`/api/forecast/periods/${pid}/reopen`
    + (mode === 'unlock' ? '?mode=unlock' : ''), { method: 'POST' }),
  // v319：把本期的加单/减单明细**手动推送**给业务员。
  //   为什么需要：自动关单（调度器直调 db 层）不发通知 ⇒ 那些期次一条都没推，
  //   界面也不会说（v318 的推送挂在「关闭期次」端点上）。出口定在**人确认的那一次**。
  pushExtraAlloc: (pid) => api(`/api/forecast/periods/${pid}/push-alloc`, { method: 'POST' }),
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

/* ---- @deprecated 对账工作流（⚠️ 页面已于 v197 撤下，本组接口暂留不删） ----
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

/* ---- AI 经营研判（「判」层：掉量归因 / 先出哪批权衡，全部只读 + 真实数据兜底） ---- */
export const aiJudgementApi = {
  decline: (periodDays = 30, topN = 8) =>
    api(`/api/ai/decline-diagnosis?period_days=${periodDays}&top_n=${topN}`),
  batchTradeoff: (productId, warehouseId = 1) =>
    api(`/api/ai/batch-tradeoff?product_id=${productId}&warehouse_id=${warehouseId}`),
}

/* ---- 经验闭环（「越用越聪明」底座 · P2-4）：只读健康看板 + 跨租户口径（红线过滤） ---- */
export const aiExperienceApi = {
  loopStatus: () => api('/api/ai/experience/loop-status'),
  industryCaliber: (paramKey = '') =>
    api(`/api/ai/experience/industry-caliber${paramKey ? `?param_key=${encodeURIComponent(paramKey)}` : ''}`),
  /* T1-5：可调口径**权威清单**（模块/中文名/值域/当前值/近 30 天记录次数）。
     🔴 候选清单只由后端给 —— 前端不得再写第二份（旧 FIELD_LABEL 已漂移 4 个不存在的键）。 */
  params: () => api('/api/ai/experience/params'),
  /* T1-5：把「这一次确认的口径」显式沉成一条提案（一次确认即建提案，不等 3 次重复） */
  proposeRecipe: (body) => api('/api/ai/experience/propose-recipe', { method: 'POST', body }),
}

/* ---- AI 经营一页纸（P1-3：四宫格聚合，只读） ---- */
export const aiPagerApi = {
  pager: () => api('/api/ai/business-pager'),
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

/* ---- 仓库档案（v294，2026-09-27）：内部仓主档 ----

   后端 CRUD **早就有了**（`routers/inventory.py` 的 `/api/warehouses/full`，
   GET/POST/PUT/DELETE 四件套，挂 `stock` 模块），但**前端此前没有任何入口** ——
   仓库只能靠库存页顺带露出来，改名/加仓/填联系人无处可去。

   为什么现在必须补：员工档案的「个人仓」（`hr_employees.warehouse_id`）与报单模板的
   「源仓 / 目标仓」（`report_mapping.src_wh / dst_wh`）都指向这张表 ——
   没有主档入口，上游三个下拉就只能是「默认仓库」一个选项，配了也等于没配。

   ⚠️ 数据源用 `/api/warehouses/full` 而**不是** `/api/warehouses`：两者今天返回同一份，
   但 `full` 是「带地址/联系人」的语义名，`/api/warehouses` 是 v107.48 为兼容旧客户端补的
   别名（见该路由上方注释）⇒ 新代码一律走 `full`，别再扩那个兼容名。 */
export const warehouseApi = {
  list: () => api('/api/warehouses/full'),
  create: (body) => api('/api/warehouses/full', { method: 'POST', body }),
  update: (wid, body) => api(`/api/warehouses/full/${wid}`, { method: 'PUT', body }),
  remove: (wid) => api(`/api/warehouses/full/${wid}`, { method: 'DELETE' }),
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
  /* v295（2026-09-27）：报单简称（列头）名册 —— 「报单简称」输入框据此**点选**。
     汇总表列头 = `forecast_submissions.store_name` 的全历史名册（后端 all_units），
     手打一个名册外的名字 = 给汇总表**新增一列**（同一门店裂成两列、永不合并 = v247 的病根）。
     返回 { aliases: [...], suggest: {"store:2225": {alias, from}}, stats: {...} }。 */
  aliasPool: () => api('/api/report-mappings/alias-pool'),
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
  /* v219 打磨⑥：**改**数量上限（老板/管理员）。set_rules 本就存在，缺的正是这一个 HTTP 入口
     —— 在此之前上限是「只读」的：前端按它判红框，而租户没有任何办法改它。 */
  setValidationRules: (body) => api('/api/forecast-submissions/validation-rules', { method: 'PUT', body }),
}

/* ---- 商品目标管理（v264，2026-09-24）----
   🔴 后端前缀 `/api/product-targets` **必须**在 server.py 的 `_PATH_MODULE_MAP` 里显式登记：
      那个映射用 `path.startswith(prefix)` 匹配，而本前缀**不**以 `/api/products` 开头
      （`product-t` ≠ `products`）⇒ 不登记就是 fail-closed 403，页面只会显示「无权限」。
   🔴 目标一律以**箱**计（方案 §4.1）⇒ 后端对「无大单位换算」的商品硬拒 422；
      前端用 `/products` 的 `can_target` 提前禁选并说明原因（不让用户白填一遍再报错）。
   🔴 均单/预填**只由后端算**（`/avg-target`），前端不本地重算 —— 那是第二份口径。 */
export const productTargetsApi = {
  list: (month = '', keyword = '') => {
    const q = []
    if (month) q.push('month=' + encodeURIComponent(month))
    if (keyword) q.push('keyword=' + encodeURIComponent(keyword))
    return api('/api/product-targets' + (q.length ? '?' + q.join('&') : ''))
  },
  create: (body) => api('/api/product-targets', { method: 'POST', body }),
  update: (tid, body) => api(`/api/product-targets/${tid}`, { method: 'PUT', body }),
  remove: (tid) => api(`/api/product-targets/${tid}`, { method: 'DELETE' }),
  employees: () => api('/api/product-targets/employees'),
  products: (keyword = '', limit = 50) =>
    api(`/api/product-targets/products?keyword=${encodeURIComponent(keyword)}&limit=${limit}`),
  /* 均单目标 + 加单预填。`periodId` 必填（剩余期次与本期报单合计都挂在期次上）。 */
  avgTarget: (periodId, productIds = '') =>
    api(`/api/product-targets/avg-target?period_id=${periodId}`
        + (productIds ? '&product_ids=' + encodeURIComponent(productIds) : '')),
  /* v264c：报单「列名 ↔ 报单对象」对账（**只读**）。用于目标页顶部告警 ——
     列名没配进「报单配置」时，该列落库 store_id=0 ⇒「逐人实报」只能靠名字匹配。 */
  mappingAudit: () => api('/api/product-targets/mapping-audit'),
  /* v277（需求 6 读取端）：加/减单的**按比例分配明细**。只读 `forecast_extra_alloc`，
     **不重算** —— 算归 `save-matrix`（经理保存那一刻的结果），这里只把存下来的结果拿出来给
     hover 展示用。重算会出现「保存时按 8 人算、悬停时按 9 人算」两套结果。 */
  extraAlloc: (periodId) => api(`/api/product-targets/extra-alloc?period_id=${periodId}`),
  /* v318（需求：一键分摊按钮）—— 弹窗的**初始状态**（只读）。
     只服务「点了某一个商品的角标」这一次点击，所以**不**塞进 extraAlloc（那个每次开表都调全表）。 */
  extraAllocSetup: (periodId, productId) =>
    api(`/api/product-targets/extra-alloc/setup?period_id=${periodId}&product_id=${productId}`),
  /* v318：**只读预演** —— 给定总量与（可选的）覆盖占比，返回逐人分配结果。
     🔴 必须走后端：减单的「夹断到 0 后按相对占比重分」是边界敏感的，前端另写一份
        必然在边界上给出第二个答案（本项目反复栽的「同屏两个同名数对不上」）。
     本接口一个字节都不写 —— 比例落档案走 `update()`，加单量落库仍随汇总结表的保存。 */
  extraAllocPreview: ({ periodId, productId, totalDelta, ratios }) =>
    api('/api/product-targets/extra-alloc/preview', {
      method: 'POST',
      body: { period_id: periodId, product_id: productId, total_delta: totalDelta, ratios: ratios || [] },
    }),
  /* v339（P1）：**保存 / 清除本期临时占比** —— 只影响本期，**不写商品目标档案**。
     老板原话：「L2 的比例『临时改只影响本期』放 P1」。
     `ratios` 传**空数组** = 清除覆盖 ⇒ 该商品回落到自动判据（有档案按档案、无档案按报单量）。
     🔴 与 `update()`（写档案、**全期生效**）是两条不同的路，绝不能混：写档案会让该商品
        **本月所有期次**的加单分摊都跟着变，而这个接口**只改本期**。
     后端三道校验（都在服务端）：Σ 必须 = 100 / 每个人本来就能分摊（不许凭空造人）/ 占比非负。 */
  extraAllocOverride: ({ periodId, productId, ratios }) =>
    api('/api/product-targets/extra-alloc/override', {
      method: 'PUT',
      body: { period_id: periodId, product_id: productId, ratios: ratios || [] },
    }),
  /* v277（S3）：**就地补商品的大单位换算**。后端三道校验（当前必须真缺 / 补完必须真能折箱
     且能摊出各级单位 / 大单位名不得撞名），任一不过返 400 并带中文原因。 */
  fixConversion: (productId, largeUnit, largeRatio) =>
    api('/api/product-targets/fix-conversion', {
      method: 'POST',
      body: { product_id: productId, large_unit: largeUnit, large_ratio: largeRatio },
    }),
}

/* ---- 商品主档（Web 预报模块网格直编 / 粘贴） ---- */
export const productsApi = {
  grid: () => api('/api/products/grid'),
  /* v196：`opts` 透传 —— 改单保存那一步要单独给更长超时（默认 20 秒对"商品档案 + 数量矩阵"
     这一串写太紧：正常 0.2 秒就能回，长超时纯兜底；真慢下来时至少不会在 20 秒被硬掐断）。
     ⚠️ 默认值 `{}` ⇒ 既有两个调用方（ProductArchive 单行）行为一字不变。 */
  bulkUpsert: (rows, opts = {}) => api('/api/products/bulk-upsert', { method: 'POST', body: { rows }, ...opts }),
  // v157 存量商品批量补进价：items = [{id, factory_price}] 或 [{barcode, factory_price}]（导出回填走条码）
  batchFactoryPrice: (items) => api('/api/products/batch-factory-price', { method: 'POST', body: { items } }),
  // v161 自定义列的值：批量写（合并写，值为空 = 删该键）。
  // 后端会按列注册表校验 key —— 未知列/系统列一律 400，绝不静默丢弃。
  extraValues: (items) => api('/api/products/extra-values', { method: 'POST', body: { items } }),
  // v158 进价闸门（per-tenant 开关，**默认关闭**）：开启后两条上报路径都会拒收「没录进价」的商品行。
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
  /* v158 待补进价清单导出（后端生成 xlsx，含「商品编号」列作导回钥匙）。
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
  /* v158 导回填好进价的清单：按「商品编号」优先、条码兜底回写（只改 factory_price 一列）。 */
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
  /* v303：导入回执 → 撤销。只回删该次导入**新建**的行；后端逐行确认仍在库里，
     返回 {deleted, recorded}，两者不相等说明有人在导入后动过这些行。
     对「库存 / 应收期初 / 销售明细 / 报单矩阵」后端会**明确拒绝**并给原因（不静默失败）。 */
  receipts: (limit = 20) => api(`/api/import/receipts?limit=${limit}`),
  undo: (batchId) => api(`/api/import/receipts/${encodeURIComponent(batchId)}/undo`, { method: 'POST' }),
  mappingMemory: (category) => api(`/api/import/mapping-memory?category=${category}`),
  /* v304：数据台账 —— 「我的数据全不全、上次什么时候传的」。
     后端 `/api/import/ledger` 的返回是 `{success, items, generated_at}`（**没有 `data` 外层**）
     ⇒ `api()` 会把整包原样返回，调用方读 `.items` 即可（见 client.js 的解包规则）。
     🔴 后端只给事实（条数 / 上次上传时间 / 上次条数 / 上传人），**不给建议**：
        "这个数算不算少""多久没传该提示"只写在 `DataLedger.vue` 一处，避免阈值散成两份。 */
  ledger: () => api('/api/import/ledger'),
}

/* v303：客户回款 —— 「他到底收回来了多少」的唯一入口。
   账龄（aging）的金额口径 = `receivables.amount - paid_amount`，而 `paid_amount`
   在 v303 之前**没有任何写入口** ⇒ 这个数字一直是"期初建账"口径。 */
export const collectionsApi = {
  aging: () => api('/api/collections/aging'),
  payments: (contactId = 0, limit = 20) =>
    api(`/api/collections/payments?contact_id=${contactId || 0}&limit=${limit}`),
  pay: (body) => api('/api/collections/payments', { method: 'POST', body }),
  undo: (rid) => api(`/api/collections/payments/${rid}/undo`, { method: 'POST' }),
}

/* v303：厂家承诺台账 —— 口头承诺（返利/陈列费/赠品/费用支持）的登记与兑现跟踪。
   挂在「目标与返利」页签里，不新增侧栏（见 CommitmentsTab.vue 的注释）。 */
export const commitmentsApi = {
  list: (status = '') => api(`/api/commitments${status ? '?status=' + status : ''}`),
  summary: () => api('/api/commitments/summary'),
  create: (body) => api('/api/commitments', { method: 'POST', body }),
  update: (id, body) => api(`/api/commitments/${id}`, { method: 'PUT', body }),
  done: (id, body = { status: 'done' }) => api(`/api/commitments/${id}/done`, { method: 'POST', body }),
  remove: (id) => api(`/api/commitments/${id}`, { method: 'DELETE' }),
  scanDue: () => api('/api/commitments/scan-due', { method: 'POST' }),
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

/* ---- 舟谱单据导入（v269，2026-09-25）----
 * 把舟谱导出的「销售结算明细表 / 调拨订单明细表」落成系统里的提货单。
 * 两步：先 `preview` 看清单（不写库），确认后再 `execute` 落库。
 *
 * 🔴 v271（2026-09-25）：这两个端点改成**后台任务**了 —— 请求只负责「开工」，
 *   立刻返回一个 `job_id`，真正的活在服务端线程里跑，前端拿 job_id 轮询 `/status`。
 *
 *   为什么必须改：同步版实测整年（14.4 万行 / 2.2 万张单）**268.7 秒**，
 *   而 nginx `proxy_read_timeout` 是 300 秒 —— 只剩 31 秒余量，文件稍大就是一次 504，
 *   用户看到的只是「失败」，而库里其实可能已经导了一半。
 *
 *   改完之后**不再受 300 秒约束**（HTTP 请求本身只有几十毫秒），超时只需覆盖上传本身。
 * 🔴 **本模块四个方法一律 `raw: true`** —— 也就是说返回值都是**整包** `{success, data}`，
 *   调用方必须读 `r.data`。这不是随手写的，是把一个**已经踩过的坑**固定下来：
 *   `api()`（api/client.js:241）默认会**把 `data` 解包掉**
 *   （`return raw ? data : (data.data !== undefined ? data.data : data)`），
 *   而后端这四个端点返回的都是 `{"success":true,"data":{…}}`。
 *   ⇒ 只要有一个方法漏了 `raw: true`，调用方读 `r.data` 就是 `undefined`：
 *     **不报错、不抛异常，只是静默拿到空值**（进度条永远停在原地 / 卡片永远显示「未使用」）。
 *   2026-09-25 v271 真机探针实测：`status` 正因为漏了 `raw: true`，
 *     轮询里 `d = (r && r.data) || null` 恒为 null ⇒ **进度永远不会走到完成**。
 *     当时只做了 curl 级验收所以没发现 —— 加新方法时请照抄 `raw: true`。
 */
export const zhoupuApi = {
  /** 上传并开工解析。返回 { job_id } —— 报告要等轮询拿。 */
  preview: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api('/api/import/zhoupu/preview', {
      method: 'POST', body: fd, timeout: 60000, raw: true
    })
  },
  /** 按 token 开工落库。返回 { job_id }。 */
  execute: (token) => {
    const fd = new FormData()
    fd.append('token', token)
    return api('/api/import/zhoupu/execute', {
      method: 'POST', body: fd, timeout: 30000, raw: true
    })
  },
  /** 查进度。跑完后 `data.result` 里带完整报告。 */
  status: (jobId) => api(`/api/import/zhoupu/status/${encodeURIComponent(jobId)}`,
                         { timeout: 15000, raw: true }),
  /** 请求中止。协作式：在下一张单的边界停，已导入的完整单据保留。 */
  cancel: (jobId) => {
    const fd = new FormData()
    return api(`/api/import/zhoupu/cancel/${encodeURIComponent(jobId)}`, {
      method: 'POST', body: fd, timeout: 15000, raw: true
    })
  },
  /* v274（2026-09-25）：通道状态 —— 给「AI 引擎 › 连接器 › ERP 数据源」那张卡用，
     （容器 v311 前叫「能力中心」，路由仍是 `/connect`）
     读的是导入成功后落的**回执**（后端 system_config 里的 zhoupu_import_receipt）。
     ⚠️ 读数含义 = 「这个通道最近一次动作」，**不是**「库里现在有多少张舟谱单」——
        别拿它当业务量统计（有人手工删过单就会与库不一致）。 */
  sourceStatus: () => api('/api/import/zhoupu/source-status', { timeout: 15000, raw: true }),
}
