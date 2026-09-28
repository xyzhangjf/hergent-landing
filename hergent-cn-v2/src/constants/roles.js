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
  // v307 分销商（**外部客户**，不是本企业员工）：只用小程序给自己报单。
  // 🔴 键名用 `distributor` 而非 `dealer` —— `dealer` 是演示期遗留的**视图令牌**
  //    （见下方 `ROLE_VIEW_TOKEN_NAMES`），复用会让历史值就地变成真实角色。
  distributor: '分销商',
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
 * 通用判据：角色是否在给定白名单内。
 *
 * 🔴 为什么必须收敛成这一个函数（v275，2026-09-25）：
 *    「能不能看到某个入口」（侧栏 / 卡片）与「能不能进某个页面」（路由守卫）
 *    必须是**同一份判据**。两边各写一遍 ⇒ 两处各自漂移，产出两种界面级假象：
 *      · 入口在、点进去被弹走（**假入口**，v267 修过的那类）；
 *      · 入口没了、直接输 URL 就能进（**假封锁** —— 看起来像"权限做过了"，其实没有）。
 *    抽成函数后，路由表的 `meta.roles` 与侧栏的 `v-if` 引的是同一个数组、同一个算法。
 *
 * 🔴 「未知」必须分成两种（v296，2026-09-27）—— 这是本条判据唯一微妙处：
 *    ① **空串 = 还没加载**（`store.user.role` 在权限接口回来之前就是空串）
 *       ⇒ **放行**。此刻判 false 会把合法用户（含老板）的菜单全藏掉，
 *       同 `store.canModule()` 的纪律「拉不到 ≠ 没权限」。
 *    ② **非空但不在 `ROLE_NAMES` 里 = 真·未知角色**（典型：租户自定义的「库管」）
 *       ⇒ **收紧**（false）。
 *
 *    ⚠️ v296 之前 ② 也是放行（原实现只有一句 `if (!isCanonicalRole(k)) return true`），
 *       后果不是抽象的：租户只要在员工档案里填一个自定义角色名，该角色就**绕过产品内置的
 *       全部 `roles` 门槛**（`/cron`、`/bid-radar`、`/settings`、`/roles`…），
 *       而它连 `roleName()` 都拼不出中文名（会显示「未知角色( 库管 )」）。
 *       更糟的是它同时制造**假入口**：自定义角色进「预报订货管理」时，
 *       页内判据 `canViewForecastSummary()` 说"可以"、后端 `SUMMARY_ROLES` 却 403
 *       ⇒ 用户看到一个**永远读不到数**的汇总区（看起来像系统坏了）。
 *       —— 收紧之后，「能不能看这一页」重新由**产品内置**说了算。客户要给某个角色放开，
 *       走的是「设置 › 权限」那条正门（后端 `custom_roles` 让位，见 `pages.js::roleGateOpen` ③），
 *       而不是"名字没登记就默认放行"这条后门。
 *
 *    本函数只决定**界面给不给看 / 走不走**；硬边界永远在后端。
 *    ① 保留的原因是**启动竞态**（技术性），不是"宽松更好"。
 */
export function roleIn(r, allowList) {
  const k = normRole(r)
  if (!k) return true                            // ① 未加载（空串）⇒ 放行：拉不到 ≠ 没权限
  if (!isCanonicalRole(k)) return false          // ② v296：真·未知角色 ⇒ 收紧，不给内置门槛之外的后门
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
 * 「适用端」标注 —— **全站唯一一份**（员工档案的角色下拉用它拼 label）。
 *
 * 🔴 它**不是**"又一份手写的角色表"：护栏 `role-registry-consistency-check.py` 的 D 段
 *    会把「标为 小程序 的角色集（`mini` ∪ `both`）」与后端 `_DEFAULT_PERMS` 里
 *    **持有 `data` 或 `*`** 的角色集**逐项比对** ⇒ 后端改了而这里没跟，构建前就红。
 *    （旧实现是"下拉 label 里手写『小程序』字样 + 另一处硬编码名单"，两边各写一份 —— 已漂移过。）
 *
 * 🔴 v300（2026-09-27）订正判据：从「有 `data` **或** `chat`」收窄为「有 `data`」。
 *    为什么：`chat` 自 v292/v293 起**全员持有**（为「副驾代理通道降级」而补，见后端
 *    `_DEFAULT_PERMS` 2026-09-25 注释）⇒ 它**已失去区分度**，用 `data||chat` 判会把
 *    8 个角色**全部**判成"能用小程序"，而事实上会计/导购/司机在业务上并不用小程序。
 *    小程序的核心能力是**报单**（`/api/forecast-submissions/*`、`/api/products` → 归 `data`）
 *    ⇒ 判据 = `data`（或 admin 的 `*`），与产品定义精确对齐：
 *       admin(*) / boss / sales / staff / supervisor —— 恰好 5 个。
 *    ⚠️ 这条订正同时消掉了护栏 D 段的一个**真红**（旧判据下文案集 5 ≠ 后端集 8）。
 *       真因是**判据过时**，不是文案漏标 —— 千万别用"把文案补成 8 个"去消红（那会把
 *       会计/导购/司机的下拉 label 改成"网页端 + 小程序"，属于把缺陷写进产品）。
 */
export const ROLE_END = {
  staff: 'mini',                                       // 仅小程序
  // v307 分销商：外部客户 ⇒ **默认只开小程序**（登录入口），这也是「默认小程序 + 可手动开通
  //   网页端」这条需求的落点。改这里会同时改到角色下拉的适用端标注（两职合一，见下方说明）。
  distributor: 'mini',
  supervisor: 'both', sales: 'both', boss: 'both', admin: 'both',
  guide: 'web', driver: 'web', accountant: 'web',      // 仅网页端
}

/** `ROLE_END` 的取值 → 中文标注（员工档案下拉 label / 账号摘要用）。 */
export const ROLE_END_LABEL = { mini: '仅小程序', both: '网页端 + 小程序', web: '仅网页端' }

/* ---- v307 登录范围（账号允许从哪个端登录）----------------------------------
   ⚠️ `ROLE_END` 现在**身兼两职**：① 角色下拉里的「适用端」标注（能力）
      ② 新建账号时「可登录端」的**默认值**（入口）。
      第 ② 条是本轮新增 —— 默认值刻意**复用同一张表**，不另抄一份名单
      （本项目三次栽在"同一规则抄成两份"）。界面上仍可手动改，改了以手工值为准。
   -------------------------------------------------------------------------- */

/** 下拉选项。取值与后端 `core.LOGIN_SCOPES` **逐字一致**，顺序即界面顺序。 */
export const LOGIN_SCOPE_OPTIONS = [
  { value: 'mini', label: '仅小程序' },
  { value: 'both', label: '网页端 + 小程序' },
  { value: 'web', label: '仅网页端' },
]

/** 中文标注（账号摘要、列表列用）。与 `ROLE_END_LABEL` 取值口径相同，分开存只为语义清楚。 */
export function loginScopeLabel(v) {
  return ({ mini: '仅小程序', both: '网页端 + 小程序', web: '仅网页端' })[v] || '网页端 + 小程序'
}

/** 某角色的**默认**登录范围 = 它的适用端。
 *  🔴 未登记的角色（含客户自定义角色）一律 `both` —— 宁可放宽也不猜
 *     （猜错 = 某个客户的人登不进来，而唯一能改的人可能也被挡着）。 */
export function defaultLoginScope(r) {
  return ROLE_END[r] || 'both'
}

/**
 * 能在小程序里干活的后端角色（含 admin 的 `*` 通配）。
 * ⚠️ **派生自 `ROLE_END`**，不另抄一份名单 —— 两处各写一份正是漂移的温床。
 *    顺序即 `ROLE_END` 的声明顺序（消费方只做 `includes`，与顺序无关）。
 */
export const MINI_PROGRAM_ROLES = Object.keys(ROLE_END).filter(r => ROLE_END[r] !== 'web')

/**
 * 该角色能否在小程序里干活（报单 / 商品 / 门店 / 汇总 / 库存）。
 * 判据 = 后端模块权限里有 `data` 或 `*`（依据与订正见 `ROLE_END` 上方注释）。
 * 🔴 本函数之前**零引用**（2026-09-22 代码评审点过名）—— 员工档案的角色下拉现在真的接它了，
 *    否则"护栏声明"与"护栏实际接线"仍是两张皮。
 */
export function canUseMiniProgram(r) {
  return roleIn(r, MINI_PROGRAM_ROLES)
}

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
 *  🔴 **加载前（空串）不隐藏** —— 与 `store.canModule()` 同一纪律：「拉不到 ≠ 没权限」。
 *     启动瞬间 `store.user.role` 还是空串（权限还没回来）⇒ 若此时判 false，
 *     老板会看到「预报订货管理」先消失、权限回来后再冒出来（闪一下）。
 *
 *  ⚠️ v296 起，「配置漂移的怪值」**不再**享受这条放宽：真·未知角色（如租户自定义的
 *     「库管」）现在**会被隐藏**。原文把取舍讲反了 —— 后端这条路用的是 `SUMMARY_ROLES`
 *     硬白名单（`forecast_submissions.py`），未知角色**必然 403**。所以"多看一眼入口"
 *     不是轻微代价，而是**造一个假入口**：入口在、页内汇总区也在，但永远读不到数。
 *     宁可让它看不见入口，也不要让它对着一个空表格怀疑系统坏了。
 *     （口径按**主角色单值**判的说明见 `FORECAST_SUMMARY_ROLES` 上方注释。）
 */
export function canViewForecastSummary(r) {
  // v275：实现已收敛到 `roleIn()`；v296 起该函数对"真未知角色"收紧（见其注释）。
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

/** 该角色能否使用舟谱单据导入（= 侧栏入口 / 能力中心卡片是否可见、路由是否放行）。
 *  v296：真·未知角色**不显示** —— 后端 `_guard()` 只放 admin/boss（不在名单里必 403），
 *        显示出来就是纯粹的假入口，且一次导入要跑几分钟，用户会以为是系统坏了。 */
export function canImportZhoupu(r) {
  return roleIn(r, ZHOUPU_IMPORT_ROLES)
}
