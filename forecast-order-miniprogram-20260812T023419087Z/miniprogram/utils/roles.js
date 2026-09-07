/* 角色集中定义：管理视角（可看跨门店汇总）角色 + 角色中文名 —— 唯一事实源，
   消除 summary.js / mine.wxml 硬编码漂移。改角色权限只改这里。
   2026-09-07：小程序「审批预报单」模块已下线（经销商以经销商为单位向厂家下单，
   不存在按门店逐单采购），故此处的 APPROVER_ROLES 实际只用于「能否看汇总总表」，
   函数名保留以免牵连调用点。 */
const APPROVER_ROLES = ['admin', 'boss', 'accountant', 'supervisor']

// 角色 → 中文显示名（mine 页头部展示用）
const ROLE_TEXT = {
  admin: '管理员',
  boss: '老板',
  accountant: '财务',
  supervisor: '主管',
  sales: '销售',
  promoter: '促销'
}

function isApprover(role) {
  return APPROVER_ROLES.indexOf(role) >= 0
}

function roleText(role) {
  return ROLE_TEXT[role] || role || ''
}

module.exports = { APPROVER_ROLES, ROLE_TEXT, isApprover, roleText }
