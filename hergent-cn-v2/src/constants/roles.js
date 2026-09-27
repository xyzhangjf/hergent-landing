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
 * 通用判据：角色是否在给定白名单内 —— **未知角色一律放行（fail-open）**。
 *
 * 🔴 为什么必须收敛成这一个函数（v275，2026-09-25）：
 *    「能不能看到某个入口」（侧栏 / 卡片）与「能不能进某个页面」（路由守卫）
 *    必须是**同一份判据**。两边各写一遍 ⇒ 两处各自漂移，产出两种界面级假象：
 *      · 入口在、点进去被弹走（**假入口**，v267 修过的那类）；
 *      · 入口没了、直接输 URL 就能进（**假封锁** —— 看起来像"权限做过了"，其实没有）。
 *    抽成函数后，路由表的 `meta.roles` 与侧栏的 `v-if` 引的是同一个数组、同一个算法。
 *
 * 🔴 未知角色 ⇒ **放行**，这不是疏忽：`store.user.role` 在权限接口回来之前是空串，
 *    此刻判 false 会把合法用户（含老板）弹走。同 `store.canModule()` 的纪律
 *    「拉不到 ≠ 没权限」。真正的边界永远在后端；本函数只决定**界面给不给看 / 走不走**。
 *    调用方若要更严的语义（例如路由守卫希望"未知"不出现），正确做法是先
 *    `await loadPerms()` 把"未知"消掉，**而不是**把这里的 fail-open 改掉。
 */
export function roleIn(r, allowList) {
  const k = normRole(r)
  if (!isCanonicalRole(k)) return true
  return Array.isArray(allowList) && allowList.includes(k)
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
  return roleIn(r, MINI_PROGRAM_ROLES)
}

/** 能在小程序里干活的后端角色（含 admin 的 `*` 通配） */
export const MINI_PROGRAM_ROLES = ['admin', 'boss', 'sales', 'staff', 'supervisor']

/**
 * 能查看「报单汇总表」的后端角色 —— 也就是「能不能用『预报订货管理』页」。
 *
 * 🔴 权威源 = 后端 `server/routers/forecast_submissions.py::SUMMARY_ROLES`
 *    （`submission_summary()` 里 `if u.get("role") not in SUMMARY_ROLES: raise HTTPException(403, ...)`）。
 *    后端改这里，本文件必须同步；护栏：`.workbuddy/tools/role-registry-consistency-check.py`
 *    （AST 解析后端那个元组，与本数组逐项比对 —— 写死在页面里护栏是看不见的）。
 *
 * ⚠️ 判据是**主角色单值**（`users.role`），**不是** `role ∪ roles` 并集：
 *    后端那一处用的就是单值 `u.get("role")`，属 `core.py::user_roles` 注释里点名的
 *    「9 处按单值 role 判断的地方」之一 ⇒ 兼任了 boss 的业务员在这条路上照样被拒。
 *    所以前端也必须按单值判，否则「兼任 boss 的业务员」会**看到入口却点进去 403**（假入口回归）。
 *    要放开兼任，必须**先在业务上拍板并同时改后端**，不能只改这里。
 */
export const FORECAST_SUMMARY_ROLES = ['admin', 'boss', 'supervisor']

/** 该角色能否查看报单汇总（= 侧栏「预报订货管理」是否可见、本期预报表格是否可读）。
 *
 *  🔴 **角色未知时不隐藏（fail-open）** —— 与 `store.canModule()` 同一纪律：「拉不到 ≠ 没权限」。
 *     两个真实场景决定了这一点：
 *       ① 启动瞬间 `store.user.role` 还是空串（权限还没回来）⇒ 若此时判 false，
 *          老板会看到「预报订货管理」先消失、权限回来后再冒出来（闪一下）。
 *       ② 角色值是历史遗留/配置漂移的怪值时，宁可让他多看到一个入口
 *          （进去有常驻的无权限说明），也不要让一个合法角色无端丢掉核心模块。
 *     代价是「未知角色多看一眼入口」，比「核心模块对老板人间蒸发」轻得多。
 */
export function canViewForecastSummary(r) {
  // v275：fail-open 的实现已收敛到 `roleIn()`（见其注释），本函数只剩"名单是谁"。
  return roleIn(r, FORECAST_SUMMARY_ROLES)
}

/**
 * 能用「舟谱单据导入」的角色 —— 与后端 `server/routers/zhoupu_documents.py::_guard()`
 * 里的 `role not in ("admin","boss")` **必须是同一份名单**。
 *
 * 🔴 为什么要专门维护它，而不是让这个入口对所有人都可见：
 *    导入是**往核心数据（提货 / 达成）里批量写**，后端必然拒掉非管理员；
 *    若前端照常显示入口，就是 v267 刚修过的那类**假入口**
 *    （入口在，点进去必被拒 —— 而且一次要跑几分钟，用户会以为是系统坏了）。
 *
 * ⚠️ 这里同样按**主角色单值**判（与后端一致），不对 `roles` 并集放宽。
 *
 * v275：本数组现在有**两个消费方**，且它们必须一致 ——
 *   ① 入口显隐：`Shell.vue`（已是历史）与 `ConnectCenter.vue` 的「ERP 数据源」第三张卡；
 *   ② 路由守卫：`router/index.js` 的 `meta.roles`（挡住"手敲 URL 直接进"这条深链）。
 *   两处都读本数组、都走 `roleIn()`，所以不可能出现"卡片没了但 URL 还能进"。
 */
export const ZHOUPU_IMPORT_ROLES = ['admin', 'boss']

/** 该角色能否使用舟谱单据导入（= 侧栏入口 / 能力中心卡片是否可见、路由是否放行）。未知角色时不隐藏，理由同上。 */
export function canImportZhoupu(r) {
  return roleIn(r, ZHOUPU_IMPORT_ROLES)
}
