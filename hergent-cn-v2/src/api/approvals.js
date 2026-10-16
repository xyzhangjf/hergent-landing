/* ============================================================
   approvals.js — 多级可配审批流（P1-2）API 封装
   ------------------------------------------------------------
   后端：`server/routers/approvals.py`（前缀 `/api/approvals`）。
   🔴 doc_type ∈ {purchase, sale, transfer}（前端只接这三类；退货走各自「过账」
       流程，不在此列——与 `psi.py` 的 `return_orders` / `purchase_returns` 路由一致）。
   🔴 沿用 psi.js 三纪律：不重抄业务规则 / 单位以商品档案为准 / **失败必须显式**
       （`api()` 把后端 detail 抛成 `Error`，页面要显示，不可 `catch{}` 吞）。
   🔴 `api()` 契约（见 `api/client.js`）：成功返回 `data.data`，失败抛 `Error` 带
       `err.status` / `err.payload`；POST 无 body 时 `body: undefined` → fetch 省略 body
       （与 `psiApi.batchPurchases` 同口径，不会发空 body 触发 415）。
   ============================================================ */
import { api } from './client.js'

export const approvalApi = {
  /* 提交审核：draft → pending_approval（快照当前审批链，node=0）。 */
  submit: (docType, oid) => api(`/api/approvals/${docType}/${oid}/submit`, { method: 'POST' }),
  /* 当前节点审批人通过（comment 可选）。末节点 → approved，否则 node+1。 */
  approve: (docType, oid, comment = '') =>
    api(`/api/approvals/${docType}/${oid}/approve`, { method: 'POST', body: comment ? { comment } : undefined }),
  /* 当前节点审批人驳回（reason 可选）→ 回草稿。 */
  reject: (docType, oid, reason = '') =>
    api(`/api/approvals/${docType}/${oid}/reject`, { method: 'POST', body: reason ? { reason } : undefined }),
  /* 当前用户待审清单（跨单据类型）。返回 [{doc_type,id,order_no,node,current_node_name,total_nodes}] */
  pending: () => api('/api/approvals/pending'),
  /* 读取全部单据类型审批链（admin）。返回 {purchase:[...],sale:[...],transfer:[...],return:[...]} */
  flows: () => api('/api/approvals/flows'),
  /* 配置某单据类型审批链（admin）。nodes: [{role,name},...] 按序逐节点。 */
  setFlow: (docType, nodes) => api(`/api/approvals/flows/${docType}`, { method: 'PUT', body: { nodes } }),
}

export default approvalApi
