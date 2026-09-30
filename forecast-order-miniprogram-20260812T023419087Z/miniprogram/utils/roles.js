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
//   ① `routers/forecast_submissions.py::SUMMARY_ROLES`（模块级常量，403 文案引它）
//      —— 🔴 v333（2026-09-30）起该常量 = `("admin","boss","supervisor","accountant")`，
//      **比本名单多一个 `accountant`**，而这个"多"是**有意的**，理由见下方 v333 段；
//   ② `server.py::_PATH_MODULE_MAP` 把 `/api/forecast-submissions` 登记为 **data 模块** ⇒
//      调用方还必须持有 `core._DEFAULT_PERMS` 里的 data 权限（中间件先于路由执行）。
//
// 🔴 2026-09-20 已收敛：`accountant` **从本名单移除**（此前它在名单里，制造了「假入口」）。
//   原状态是三处打架：本名单收会计（`isApprover` 为真 ⇒ 「我的」页显示汇总入口）
//   ＋ ①后端名单收会计 ＋ ②中间件拒会计（`_DEFAULT_PERMS['accountant']` 没有 `data`）
//   ⇒ 会计点进去必 403，而失败点在**中间件**、连路由里那句提示语都到不了，用户只看到通用报错。
//   用户 2026-09-20 拍板：**会计不报单**。当时的收敛办法是把名字从三处名单里统一摘掉。
//
// ✅ v333（2026-09-30）改走**另一条路**（拍板原文：「财务/文员需要导出舟谱订单模版，需要填
//   达成填报，所以要默认给财务/文员 预报订单管理 和 返利与目标 权限」）：
//   不再"摘名字"，而是按上面 ② 提示的**正确做法**落实 —— 后端给 `accountant` 补上 `data`
//   （`core._DEFAULT_PERMS`）＋ 把 `accountant` 加进 `forecast_submissions.py::SUMMARY_ROLES`。
//   🔴 于是本文件与后端**不再逐项相等**，这是**有意为之**，不是漏改：
//     · 本名单只服务**小程序界面**（它决定「我的」页要不要显示汇总入口）；
//     · 会计**登不进小程序**（`ROLE_LOGIN_SCOPE['accountant'] = 'web'`，见后端 core.py），
//       `isApprover()` 对他永远不会被求值 ⇒ 加不加名字对小程序行为**零影响**；
//     · 若为"两处对齐"把会计加进来，反而会造出新的假象：名单声称会计是小程序审批人。
//   ⚠️ **「会计不报单」的决定未被推翻**：v333 放开的动词是「**看**汇总 / 导出模板 / 填达成」，
//      「**下单**」仍不通 —— 会计拿不到小程序入口。两者不矛盾（详见 core.py 的 v333 段）。
//   ⚠️ 第 4 处拷贝 `erp_db.py::forecast_submission_recall` 的内联元组
//      `("admin","boss","supervisor")` **同样保持不动**，理由与本节完全一致（同属小程序链路）。
//      判别标准只有一条：**这份名单服务的是小程序界面，还是网页端？**
const APPROVER_ROLES = ['admin', 'boss', 'supervisor']

// 角色 → 中文显示名（mine 页头部展示用）。
// 🔴 键集必须覆盖后端 `core._DEFAULT_PERMS` 的**全部 8 个角色**，且**译名与网页端逐字相同**
//   （网页端唯一来源：hergent-cn-v2/src/constants/roles.js；两边由护栏跨仓比对）。
//   2026-09-19 补：此前缺 driver / guide / staff —— 这三种人在「我的」页会看到裸英文
//   （`roleText()` 落到 `|| role`，不报错、只是把英文吐出来，所以一直没人发现）。
//   同轮统一译名：财务 → 会计、销售 → 业务员（与员工档案 / 权限矩阵一致）。
//   🔴 v333（2026-09-30）**又改回来了**：`accountant` 由「会计」改为「财务/文员」。
//      老板原话：「把财务角色改成"财务/文员"」。网页端 `constants/roles.js::ROLE_NAMES`
//      是权威源，本表是镜像 —— 护栏 E3 段「同一角色在网页端与小程序译名逐字一致」逐字比对。
//      ⚠️ 会计**登不进小程序**（后端 `ROLE_LOGIN_SCOPE['accountant'] = 'web'`），所以这条
//         翻译在实际运行中不会被任何人看到；改它**纯粹是为了两处口径一致**（否则护栏红、
//         且下次有人对照两页会以为是两个角色）。本表**其余条目一字未动** ——
//         尤其 `APPROVER_ROLES` 有意不同步，理由见其上方注释。
const ROLE_TEXT = {
  admin: '管理员',
  boss: '老板',
  accountant: '财务/文员',
  sales: '业务员',
  guide: '导购',
  driver: '司机',
  staff: '员工',
  supervisor: '主管',
  // v307 分销商（外部客户）：译名与网页端**逐字一致**（护栏比对两处），只用来显示。
  distributor: '分销商',
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
