/* 角色集中定义（二期新增）：审批/汇总入口可见角色 + 角色中文名 —— 唯一事实源，
   消除 approval.js / summary.js / mine.wxml 三处硬编码漂移。改角色权限只改这里。 */
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
