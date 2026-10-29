/* ============================================================
   partyLedger.js — ③ 往来账本 / 逐笔核销 API 封装
   ------------------------------------------------------------
   后端 = `/api/party-ledger`、`/api/unreconciled`（模块 accounts；boss / accountant 持有），
        核销与收款复用既有 `/api/writeoffs`、`/api/payments`。

   契约同 client.js：`api()` 成功返回 `data.data`（无该字段则返回整包）；
   失败抛 Error（挂 err.status）。
   ============================================================ */
import { api } from './client.js'

export const partyLedgerApi = {
  /* 往来账本轨迹 */
  list: (partyType, partyId, params = {}) => {
    const q = new URLSearchParams()
    if (partyType) q.set('party_type', partyType)
    if (partyId) q.set('party_id', String(partyId))
    if (params.date_from) q.set('date_from', params.date_from)
    if (params.date_to) q.set('date_to', params.date_to)
    return api('/api/party-ledger?' + q.toString())
  },

  /* 未核销应收 + 可用预收（核销页左右两列取数） */
  unreconciled: (partyType, partyId) => {
    const q = new URLSearchParams({
      party_type: partyType || 'customer',
      party_id: String(partyId || 0),
    })
    return api('/api/unreconciled?' + q.toString())
  },

  /* 预收冲应收：复用既有核销单接口（items 支持分拆） */
  writeoff: (payload) => api('/api/writeoffs', { method: 'POST', body: payload, timeout: 60000 }),

  /* 收款核销：复用既有收款接口（ref_type/ref_id 指向具体单据） */
  payment: (payload) => api('/api/payments', { method: 'POST', body: payload, timeout: 60000 }),

  /* 往来方列表（客户/供应商） */
  contacts: (type, keyword = '') =>
    api('/api/contacts?type=' + encodeURIComponent(type) +
        '&keyword=' + encodeURIComponent(keyword) + '&limit=500'),
}
