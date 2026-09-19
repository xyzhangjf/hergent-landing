/* 角色集中定义：管理视角（可看跨门店汇总）角色 + 角色中文名 —— 唯一事实源，
   消除 summary.js / mine.wxml 硬编码漂移。改角色权限只改这里。
   2026-09-07：小程序「审批预报单」模块已下线（经销商以经销商为单位向厂家下单，
   不存在按门店逐单采购），故此处的 APPROVER_ROLES 实际只用于「能否看汇总总表」，
   函数名保留以免牵连调用点。

   🔴 2026-09-19（收敛）：本表的键集必须**覆盖后端 `core._DEFAULT_PERMS` 的全部角色**
   （权威源在 server/core.py，不在小程序里）。缺条目的后果不是报错而是静默降级：
   `roleText()` 落到 `|| role` 把英文原样显示，「缺配置」与「本来就是英文」看不出区别。
   本轮补上此前缺的 driver / guide / staff（生产目前只有 admin/boss/sales/supervisor，
   但员工档案里可以把人设成导购/司机/员工 —— 那些人的「我的」页此前会显示裸英文）。
   回归护栏：`.workbuddy/tools/role-registry-consistency-check.py`（跨网页端 / 小程序比对）。 */

// 「能看汇总总表（跨门店）」的角色。**本名单不许自行增删** —— 它必须与后端两处对齐：
//   ① `routers/forecast_submissions.py::submission_summary`（GET /summary）里的硬编码名单
//      `("admin","boss","accountant","supervisor")`，不符即 403「仅管理员/老板可看汇总」；
//   ② `server.py::_PATH_MODULE_MAP` 把 `/api/forecast-submissions` 登记为 **data 模块** ⇒
//      调用方还必须持有 `core._DEFAULT_PERMS` 里的 data 权限（中间件先于路由执行）。
// 🔴 2026-09-19 实测记录（**两处后端判据互相矛盾，尚未修**）：`accountant` 在 ①名单里，但
//   `_DEFAULT_PERMS['accountant'] = [dashboard, accounts, reports, marketing]` **没有 data** ⇒
//   会计进小程序点「汇总总表」会在**中间件**就被 403（连路由的角色检查都到不了）。
//   要让会计真能看，正确改法是**在后端给 accountant 加 data 权限**（或从 ①名单里去掉 accountant）
//   —— 那是业务决定；在这里加名字只会造出一个点了就报错的入口。
//   故本名单**保持原样**，与①逐字一致，等待后端拍板后再同步。
const APPROVER_ROLES = ['admin', 'boss', 'accountant', 'supervisor']

// 角色 → 中文显示名（mine 页头部展示用）。
// 🔴 键集必须覆盖后端 `core._DEFAULT_PERMS` 的**全部 8 个角色**，且**译名与网页端逐字相同**
//   （网页端唯一来源：hergent-cn-v2/src/constants/roles.js；两边由护栏跨仓比对）。
//   2026-09-19 补：此前缺 driver / guide / staff —— 这三种人在「我的」页会看到裸英文
//   （`roleText()` 落到 `|| role`，不报错、只是把英文吐出来，所以一直没人发现）。
//   同轮统一译名：财务 → 会计、销售 → 业务员（与员工档案 / 权限矩阵一致）。
const ROLE_TEXT = {
  admin: '管理员',
  boss: '老板',
  accountant: '会计',
  sales: '业务员',
  guide: '导购',
  driver: '司机',
  staff: '员工',
  supervisor: '主管',
  // 业务口语别名，**不是后端角色**：后端的 v107 注释把 staff 描述为「小程序员工（业务员/促销/导购）」
  // —— 促销实际由 staff 承载。保留此条只为兼容历史值/口头叫法，别用它来派权限。
  promoter: '促销'
}

function isApprover(role) {
  return APPROVER_ROLES.indexOf(role) >= 0
}

function roleText(role) {
  if (!role) return ''
  // ⚠️ 未知角色**故意不回落成原值** —— `|| role` 正是「静默失败」的载体：缺配置时把英文原样
  //    显示，看起来跟「这个角色本来就叫 sales」一样，于是永远没人发现清单漏了条目。
  //    改成显式标记，让下一次有人看「我的」页就暴露（网页端 constants/roles.js 同款约定）。
  return ROLE_TEXT[role] || ('未知角色(' + role + ')')
}

module.exports = { APPROVER_ROLES, ROLE_TEXT, isApprover, roleText }
