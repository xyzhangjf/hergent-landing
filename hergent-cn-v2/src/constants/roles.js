/* 角色中文名 —— 前端唯一来源（2026-09-19 收敛）
 *
 * 为什么要有这个文件：同一批角色名此前在四处各写一份，且**都漏条目**：
 *   · pages/EmployeeArchive.vue  ROLE_NAMES（短名，漏 supervisor）
 *   · pages/Forecast.vue         ROLE_LABELS（用的是 owner/finance/promoter/dealer 这套**后端不存在**的词）
 *   · 小程序 utils/roles.js      ROLE_TEXT（漏 driver/guide/staff）
 *   · pages/Settings.vue         ROLE_LABELS（权限矩阵专用，措辞更长，仍留本地；护栏单列一条校验）
 * 漏条目的后果**不是报错而是静默降级**：调用点普遍写成 `MAP[x] || x`，
 * 缺 key 时把英文原样吐给用户，与「这个值本来就是英文」完全无法区分 —— 于是没人发现。
 *
 * 🔴 权威源 = 后端 `server/core.py::_DEFAULT_PERMS`（8 个角色）。后端加/改角色，这里必须同步。
 *    回归护栏：`.workbuddy/tools/role-registry-consistency-check.py`（AST 解析后端 + 校验本文件）。
 *
 * 两套词汇，别混：
 *   · 规范角色名 = ROLE_NAMES 的 key = 后端真实角色，`users.role` 存的就是它（本文件的正主）
 *   · 视图令牌   = VIEW_TOKEN_NAMES = 早期「按身份预览」演示功能的词（owner/finance/dealer/promoter），
 *                 **后端并不存在**，只可能出现在 localStorage('hergent_biz_role') 的遗留值与
 *                 Forecast.vue 的旧配置里。保留是为了不改既有行为（旧令牌仍解析成同一批中文名）。
 *                 新代码一律用规范角色名。
 */

/** 8 个后端角色 → 中文短名。键集必须与后端 `_DEFAULT_PERMS` 完全一致（有护栏）。 */
export const ROLE_NAMES = {
  admin: '管理员',
  boss: '老板',
  accountant: '会计',
  sales: '业务员',
  guide: '导购',
  driver: '司机',
  staff: '员工',
  supervisor: '主管',
}

/** 视图令牌 → 中文名（**不是**后端角色；只为兼容历史配置/遗留 localStorage 值）。 */
export const ROLE_VIEW_TOKEN_NAMES = {
  owner: '老板',
  finance: '会计',
  dealer: '经销商',
  promoter: '促销',
}

/** 视图令牌 → 规范角色名。用于把历史值归一到后端角色再参与权限比对。 */
export const ROLE_ALIAS = {
  owner: 'boss',
  finance: 'accountant',
}

/** 是否后端真实角色 */
export function isCanonicalRole(r) {
  return Object.prototype.hasOwnProperty.call(ROLE_NAMES, String(r || ''))
}

/**
 * 把任意来源的角色值归一到规范角色名。
 * 视图令牌 → 别名表；未知值 → 原样返回（**不猜**，由调用方的默认值兜底）。
 */
export function normRole(r) {
  const k = String(r || '').trim()
  if (!k) return ''
  if (isCanonicalRole(k)) return k
  return ROLE_ALIAS[k] || k
}

/**
 * 角色 → 中文名。
 * ⚠️ 未知角色**故意不回落成原值** —— 回落成原值正是「静默失败」的载体（看起来像正常的英文值）。
 *    这里回落到 `未知角色( xxx )`，让配置漂移在下一次有人看界面时就暴露出来。
 */
export function roleName(r) {
  const k = String(r || '').trim()
  if (!k) return '未设置'
  return ROLE_NAMES[k] || ROLE_VIEW_TOKEN_NAMES[k] || ('未知角色(' + k + ')')
}

/**
 * 该角色能否在小程序里干活（报单 / 商品 / 门店 / 汇总 / 库存 / AI 对话）。
 * 判据是**后端模块权限**，不是猜的：小程序调用的接口前缀在
 * `server.py::_PATH_MODULE_MAP` 里分别落到 `data`（/api/forecast-submissions/*、/api/products）
 * 与 `stock`（/api/inventory）与 `chat`（AI 对话）—— 所以「有 data 或 chat 就能用小程序」。
 * 与后端 `_DEFAULT_PERMS` 对照：admin/boss/sales/staff/supervisor 有，accountant/guide/driver 没有。
 * 护栏会把这个集合与员工档案角色下拉里的「小程序」标注对齐，防止文案与权限脱节。
 */
export function canUseMiniProgram(r) {
  return MINI_PROGRAM_ROLES.includes(normRole(r))
}

/** 能在小程序里干活的后端角色（含 admin 的 `*` 通配） */
export const MINI_PROGRAM_ROLES = ['admin', 'boss', 'sales', 'staff', 'supervisor']
