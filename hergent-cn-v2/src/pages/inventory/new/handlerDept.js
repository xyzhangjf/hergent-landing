/* ============================================================
   handlerDept.js — 「选业务员 → 自动带出他的部门」**唯一实现**（v686）
   ------------------------------------------------------------
   老板口径（2026-10-25）：选经办人后要自动带出该经办人所属部门；经办人没有
   关联部门时要给提示，且**不因此拦住开单**。

   🔴 为什么收在一处：采购订单 / 采购退货 / 调拨 / 自提订单 / 自提退单 /
      车销订单 / 车销退单**七个页面**都要这条逻辑，而它们的部门落库形态
      **不一样**：
        · 采购、采购退货、调拨：`department_id`（INTEGER，存 `departments.id`）
        · 销售订单 / 销售退单：`department`（TEXT，存**部门名**）
      逐个页面各写一份，必然出现「一页带出 id、另一页带出名字」的分叉；
      更要紧的是**降级分支**（这个人没配部门）在七份实现里总有几份会漏，
      而漏掉的表现是「静默什么都不填」—— 用户以为系统没这功能。
      ⇒ 这里只回答「这个人属于哪个部门」，至于填 id 还是填名字，由页面自己决定。

   🔴 「没配部门」必须能被调用方**区分于**「配了部门但那个部门被删了」：
     两者都不该填值，但提示语不同（前者要老板去补配置，后者是历史数据问题）。
       · `known: true`  —— 找到了部门（`id` / `name` 都可用）
       · `known: false` —— 没找到；`reason` 说明是哪一种，`userName` 供提示语用
       · `picked: false` —— 压根没选人（此时**不许**弹提示：刚进页面一片警告是噪音）

   ⚠️ 数据源：`refs?kind=users` 下发的 `department_id`（主库 `users.department_id`）
      与 `refs?kind=departments`（当前租户 `departments`）。**两库 id 同域**
      （生产实测：主库与 tenant_1 的 departments 都是 1 总部 / 2 销售部 /
      3 财务部 / 4 仓储部）—— 若哪天不一致，症状是「带出的部门名字对不上」，
      所以这里**只按 id 匹配**、不按名字猜。
   ============================================================ */

/**
 * @param {Array} users        `refs?kind=users` 的数组（每项含 id/name/department_id）
 * @param {Array} departments  `refs?kind=departments` 的数组（每项含 id/name）
 * @param {string|number} handlerId 业务员 id（主库 users.id 的字符串）
 * @returns {{picked:boolean, id:number, name:string, known:boolean, reason:string, userName:string}}
 */
export function handlerDepartment (users, departments, handlerId) {
  const uid = String(handlerId == null ? '' : handlerId).trim()
  if (!uid) {
    return { picked: false, id: 0, name: '', known: false, reason: 'none', userName: '' }
  }
  const u = (users || []).find(x => String(x.id) === uid)
  const userName = u ? String(u.name || '').trim() : ''
  /* 人名都查不到（账号被停用/删除，或 refs 读失败）≠ 这人没有部门。
     ⚠️ 不能并在「没配部门」里说「请去给他配部门」—— 他可能已经配了，
        只是账号不在列表里；那句话会把人引到错的地方。 */
  if (!u) {
    return { picked: true, id: 0, name: '', known: false, reason: 'no-handler', userName: '' }
  }
  const did = Number(u.department_id || 0)
  if (!did) {
    return { picked: true, id: 0, name: '', known: false, reason: 'no-dept', userName }
  }
  const d = (departments || []).find(x => Number(x.id) === did)
  if (!d) {
    /* 账号记住了部门 id，但当前租户的部门表里没有这一行（部门被删 / 跨库不同步）。
       ⇒ 不填值、也**不**提示「他没配部门」（他有），提示去看配置是一种误导。 */
    return { picked: true, id: 0, name: '', known: false, reason: 'dept-missing', userName }
  }
  return { picked: true, id: did, name: String(d.name || '').trim(), known: true, reason: 'ok', userName }
}

/**
 * 提示语。**只**给「该账号确实没配部门」出声 —— 其余情况返回空串（静默），
 * 因为它们的正确处置不是让老板去配置，而是数据/权限层面的问题。
 * @returns {string} 空串 = 不显示提示
 */
export function handlerDeptWarn (users, departments, handlerId) {
  const r = handlerDepartment(users, departments, handlerId)
  if (!r.picked) return ''
  if (r.reason === 'no-dept') {
    const who = r.userName ? `「${r.userName}」` : '这个业务员'
    return `${who}还没设置所属部门 —— 本次可以手动选；到「员工档案 → 业务员部门」给他选好，以后选他就自动带出。`
  }
  if (r.reason === 'dept-missing') {
    /* 有 id 但部门表里没有：如实说「没匹配上」，别甩锅给"没设置"。 */
    return '这个业务员记的部门在当前部门表里找不到（可能部门已停用）—— 请手动选一个。'
  }
  return ''
}
