/* ============================================================
   reconcile.js — 对账工作台（v528 · P1-4 自动勾对）API 封装
   ------------------------------------------------------------
   后端 = `/api/reconciliation`（模块 accounts；boss / accountant 均持有）。

   取数链路（七步分工前三步，前端只取数与收集映射）：
     upload    → POST /api/chat-attachment（multipart，返回 file_id；按用户隔离）
     peek      → GET  /api/reconciliation/file-peek（原始行：选 sheet + 表头行）
                  🔴 银行/微信/舟谱导出的表头普遍不在第 1 行，必须先看原始行选定
     rows      → GET  /api/reconciliation/file-rows（按选定表头行读全量 + 猜列建议）

   比对链路（🔴 判定 100% 走后端确定性算子，前端不实现任何匹配逻辑）：
     statement → POST /api/reconciliation/statement（rows_a/rows_b + side_a/side_b + spec）
                  → recon_engine.reconcile（金额 + 日期容差 + 组合 + 退款冲减 + 手续费感知）

   ⚠️ 契约同 client.js：`api()` 成功返回 `data.data`（无该字段则返回整包）；
      失败抛 Error（挂 err.status）。上传走 FormData（client.js 已支持透传）。
   ============================================================ */
import { api } from './client.js'

export const reconcileApi = {
  /* 上传文件（Excel/CSV，≤10MB）。返回 { ok, file_id, file_name, sheets, rows, cols, ... } */
  upload: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api('/api/chat-attachment', { method: 'POST', body: fd, timeout: 60000, raw: true })
  },

  /* 取数预览：sheets + 前 12 行**原始行**（人选表头行用；表头不在第 1 行的文件必须） */
  peek: (fileId) => api('/api/reconciliation/file-peek?file_id=' + encodeURIComponent(fileId || '')),

  /* 按选定表头行读全量数据 + 猜列建议 + 合计行提示 */
  rows: (fileId, sheet, headerRow) =>
    api('/api/reconciliation/file-rows?file_id=' + encodeURIComponent(fileId || '')
        + '&sheet=' + encodeURIComponent(sheet || '')
        + '&header_row=' + encodeURIComponent(String(headerRow || 0))),

  /* 逐笔对账（账户对账口径）。payload = { rows_a, rows_b, side_a, side_b, spec } */
  statement: (payload) => api('/api/reconciliation/statement', {
    method: 'POST', body: payload, timeout: 120000
  }),
}
