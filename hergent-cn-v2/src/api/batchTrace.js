/* ============================================================
   batchTrace.js — 批次追溯查询页（v529 · P1-5）API 封装
   ------------------------------------------------------------
   后端（均已生产部署）：
     full   → GET /api/batch-trace/{batch_no}
              → { batch_no,
                  inbound:  [batch_trace 行],   // direction='in'
                  outbound: [batch_trace 行],   // direction='out'
                  current_stock: [{product_name, quantity, batch_no, expiry_date, cost_price}],
                  total_in, total_out }
              batch_trace 行字段：{batch_no, direction, product_id, product_name,
              quantity, ref_type, ref_id, ref_no, contact_name, created_at}
     recall → GET /api/batch/recall-impact/{batch_no}
              → [{contact_name, ref_no, quantity, created_at, phone}]（phone 可能为 null）

   ⚠️ 契约同 client.js：`api()` 成功返回 `data.data`（无该字段则返回整包）；
      失败抛 Error（挂 err.status）。
   ============================================================ */
import { api } from './client.js'

export const batchTraceApi = {
  /* 批次全链路：入库来源 + 出库去向 + 当前在库 + 累计进出数量 */
  full: (batchNo) => api(`/api/batch-trace/${encodeURIComponent(batchNo)}`),

  /* 召回影响：收到过该批号的客户清单（含电话，供召回联系） */
  recall: (batchNo) => api(`/api/batch/recall-impact/${encodeURIComponent(batchNo)}`),
}
