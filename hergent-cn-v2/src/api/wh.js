/* ============================================================
   wh.js — 仓配管理（Warehouse & Distribution）API 封装
   ------------------------------------------------------------
   后端 = 旧仓储域 `routers/inventory.py`（router prefix = `/api`）
        ＋ `routers/vehicles.py`。**全部落在既有已映射前缀**，无新前缀登记：
     · /api/expiry/forecast          → stock（v465c 补映射，见 server.py）
     · /api/vehicles                 → stock
     · /api/vehicle-stock/{id}       → stock
     · /api/inventory/low-stock      → stock（P0 新增只读端点）
   与前端可见性（`pages.js` 里 `/wh/*` = BIZ_ROLES，全员持 `stock`）**一致** ⇒
   不会出现「入口看得见、取数 403」的假入口。

   ⚠️ 契约同 `client.js`：`api()` 成功返回 `data.data`（无该字段则返回整包）；
      失败抛 `Error`（挂 `err.status`）。页面必须显示错误，不许 `catch {}` 吞掉。
   ============================================================ */
import { api } from './client.js'

/* 拼查询串：空串 / null / undefined / false / 0 一律不发（= 后端默认 = 不限）。
   用 URLSearchParams 而非手拼 —— 关键词含 `&`/`#`/中文时手拼必坏。 */
function qs(params) {
  const p = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false || v === 0) return
    p.append(k, String(v))
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const whApi = {
  /* 效期预警表：红区（≤30 天）/ 黄区（31–60 天），后端已按阈值分好组 */
  expiryForecast: () => api('/api/expiry/forecast'),
  /* 车辆列表（司机任务 / 车辆库存的选车下拉） */
  vehicles: () => api('/api/vehicles'),
  /* 单车在车库存 */
  vehicleStock: (vehicleId) => api(`/api/vehicle-stock/${vehicleId}`),
  /* 库存预警：低于安全库存的在售商品（severity: ''|'out'|'low'） */
  lowStock: (params) => api(`/api/inventory/low-stock${qs(params)}`),
}
