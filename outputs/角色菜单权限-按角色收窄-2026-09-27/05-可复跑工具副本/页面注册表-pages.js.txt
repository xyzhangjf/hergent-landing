/* ============================================================================
   pages.js —— 页面注册表：前端「入口可见性」的唯一真源（v291，2026-09-27）
   ============================================================================
   需求原话（老板）：**「不同的角色登录进去后只能看到自己有权限的页面」**。

   ---------------------------------------------------------------------------
   一、为什么不能只按权限模块判（这是本文件存在的全部理由）
   ---------------------------------------------------------------------------
   后端权限模块一共 19 个，粒度**极粗** —— 实测 `_PATH_MODULE_MAP` 304 条接口里：
       · `data`    占 83 条（档案 / 渠道价格 / 能力中心 / 招投标 / 定时任务 / 补录 / 报单…）
       · `accounts` 61 条、`stock` 36 条、`sales` 36 条、`hr` 28 条 …
   于是「模块授权」根本回答不了「这个角色该不该看这一页」：

     · 员工 `staff` 的模块 = `data + chat + stock` ⇒ 按模块判，他会看到
       档案管理 / 渠道与价格 / 能力中心 / 招投标雷达 / 定时任务 / 库存效期补录
       **六到八个管理页面**（因为报单要用 `data`，`/api/cron` 恰好也归 `data`）。
     · 司机 `driver` 的模块里有 `stock`，而 `/api/loss` 也归 `stock`
       ⇒ 司机能看到「货损核算」（金额与货损率）。
     · 员工 `staff` 的模块里**没有 `dashboard`**，而首页 `/workbench` 的主接口归 `dashboard`
       ⇒ 若首页也按模块判，**员工登录后连首页都进不去**（落到空白页）。

   ⇒ 结论：模块只能表达「**这个租户有没有买这个能力**」（客户可在「设置 › 权限」自助勾选），
      表达不了「**这个角色该不该看这一页**」。后者必须由产品内置，就是本表。

   ---------------------------------------------------------------------------
   二、两条轴，缺一不可
   ---------------------------------------------------------------------------
     · `module` —— 后端权限模块（读 `store.canModule`）。客户可在权限页自助开关，
                    用来表达「这个租户用不用得上这个功能」。
     · `roles`  —— 角色硬门槛（读 `roles.js::roleIn`）。产品内置，
                    用来表达「这一页天然只给某几类人」。
       🔴 配了 `roles` 的页面，**权限页勾选也放不开**（硬门槛优先）。这是刻意的：
          价格体系 / 定时任务 / 数据接入这类页面，不该因为一次误勾就对全员敞开。
       🔴 `roles: null` = 不按角色收紧，只看模块。

   ---------------------------------------------------------------------------
   三、三处消费方，同一份判据（这是本文件的主要价值）
   ---------------------------------------------------------------------------
     ① 侧栏（`Shell.vue`：桌面 `.sb-item` + 手机底栏 `.mnav-item` + 手机抽屉 `.md-item`）
     ② 路由守卫（`router/index.js`，挡"手敲 URL 深链"）
     ③ 命令面板（`CommandPalette.vue` ⌘⇧K）
     ④ 页面内的跳转入口（各页 `goXxx()` 前置判据）
   此前这四处各写各的 ⇒ 天然产出两种界面级假象（v267 / v275 都修过）：
     · **假入口**：入口在、点进去被拒（用户以为系统坏了）；
     · **假封锁**：入口没了、手敲 URL 还能进（以为权限做过了，其实没有）。
   收敛成一份表之后，这四种假象**结构上不可能**再出现 —— 因为不可能再"各写一份"。

   ---------------------------------------------------------------------------
   四、fail-open 的两处（纪律，不是疏忽）
   ---------------------------------------------------------------------------
     · **未登记的路径 ⇒ 放行**。新增页面忘了登记时，页面照常可用（不会白屏），
       只是暂时不受门禁保护。反向（未登记 ⇒ 拒绝）会让一次漏登记把整页锁死。
     · **未知角色 ⇒ 放行**（`roleIn` 的实现，见 roles.js 注释）。启动瞬间 `store.user.role`
       还是空串，此刻判 false 会把合法用户（含老板）的菜单全藏掉。
       调用方若要更严的语义，正确做法是**先 `await loadPerms()` 把"未知"消掉**
       （`router/index.js::ensureRoleLoaded()` 就是这么做的），而不是改掉这里的 fail-open。
   ============================================================================ */
import { roleIn, FORECAST_SUMMARY_ROLES, ZHOUPU_IMPORT_ROLES } from './roles'
/* v291：便捷判据 `canSee()` 直接读 store 上下文（下方导出）。
   静态 import store 是安全的，与本仓既有先例同源 —— `router/index.js` 早就这么干，
   且 `store/index.js` **不反向依赖** pages/roles/router（`api/client.js` 零 import），
   故不存在循环依赖；`store` 是 `useAppStore(pinia)` 的实例，不依赖"当前 active pinia"。 */
import { store } from '../store'

/** 「业务管理岗」—— 能看返利政策 / 货损 / 档案 / 效期补录的那批角色。
 *
 *  🔴 为什么这四类页面要按**角色**收紧、而不是按模块：
 *     它们的接口分别落在 `sales` / `stock` / `data` / `hr` 四个模块里，而这四个模块
 *     **司机、导购、员工都各自持有一两个**（小程序要库存、要报单）⇒ 按模块判就一定漏。
 *     典型反例：`/api/cron`（定时任务）归 `data`，员工持有 `data`（报单要用）——
 *     若不收紧，员工登录后第一屏就能看见「定时任务」。
 *
 *  ⚠️ 这份名单与后端**没有**同源关系（后端这几条路上没有角色白名单，只有模块）。
 *     它是**产品决策**，不是代码镜像 —— 要调整就改这一行，别去别处再抄一份。 */
export const BIZ_ROLES = ['admin', 'boss', 'accountant', 'sales', 'supervisor']

/** 只要配置类页面（价格 / 接入 / 定时任务）—— 老板与管理员。 */
export const ADMIN_ROLES = ['admin', 'boss']

/**
 * 页面注册表。键 = 路由路径（**父级即可**，子路由自动继承，见 `ruleFor`）。
 *
 * 字段：
 *   title   —— 中文名。被路由守卫用作"你无权访问「xxx」"的文案，必须与页面标题一致。
 *   module  —— 后端权限模块名（`store.canModule`）；`null` = 不看模块。
 *   roles   —— 允许的角色白名单；`null` = 不按角色收紧。
 *   cat     —— 分类（仅作文档与护栏用，运行时不用）：'core' 人人 | 'biz' 业务岗 | 'admin' 管理岗
 */
export const PAGE_RULES = {
  /* —— core：所有登录用户都应能到达 —— */
  // 🔴 首页**绝不能**挂 `module: 'dashboard'`：`staff` 的模块里没有 dashboard，
  //    挂了就是「员工登录后首页被藏」，而 `/` 的 redirect 与登录成功跳转都指向它 ⇒ 白屏。
  '/workbench':       { title: '经营工作台',   module: null,        roles: null,        cat: 'core' },
  '/dashboard':       { title: '经营趋势',     module: 'dashboard', roles: null,        cat: 'core' },
  '/ai-hub':          { title: 'AI 中心',      module: 'chat',      roles: null,        cat: 'core' },

  /* —— biz：业务管理岗（BIZ_ROLES） —— */
  // ⚠️ `/forecast` 的名单**不是** BIZ_ROLES：后端 `forecast_submissions.py::SUMMARY_ROLES`
  //    只放 管理员/老板/主管，前端必须与它逐项一致（有 AST 护栏），否则就是假入口。
  '/forecast':        { title: '预报订货管理', module: null,        roles: FORECAST_SUMMARY_ROLES, cat: 'biz' },
  '/rebate':          { title: '目标与返利',   module: null,        roles: BIZ_ROLES,   cat: 'biz' },
  '/loss':            { title: '货损计算工作流', module: null,      roles: BIZ_ROLES,   cat: 'biz' },
  '/loss-accounting': { title: '货损核算',     module: null,        roles: BIZ_ROLES,   cat: 'biz' },
  '/data-fill':       { title: '库存效期补录', module: null,        roles: BIZ_ROLES,   cat: 'biz' },
  // 档案管理：`/archive/employees|customers|brands|products` 四个子路由自动继承本行。
  '/archive':         { title: '档案管理',     module: null,        roles: BIZ_ROLES,   cat: 'biz' },

  // 算工资：**只挂 module、不挂 roles** —— 这是 2026-09-19 拆出 `payroll` 窄模块时的明确契约：
  //   「会计能不能算工资按客户差异，由各租户在权限页自行授予」（见后端 `_DEFAULT_PERMS` 注释）。
  //   这里若加角色硬门槛，客户在权限页给会计勾了 `payroll` 也放不开 ⇒ 违背该契约。
  '/payroll':         { title: '算工资',       module: 'payroll',   roles: null,        cat: 'biz' },
  // 招投标雷达：接口归 `data`（**员工/司机也持有 `data`**）⇒ 只判模块拦不住，必须叠角色门槛。
  //   给业务员留一个：招投标情报正是跑业务的人用得上的东西。
  '/bid-radar':       { title: '招投标雷达',   module: 'data',      roles: [...ADMIN_ROLES, 'sales'], cat: 'biz' },

  /* —— admin：管理岗（ADMIN_ROLES） —— */
  '/price-channels':  { title: '渠道与价格',   module: null,        roles: [...ADMIN_ROLES, 'accountant'], cat: 'admin' },
  '/connect':         { title: '能力中心',     module: null,        roles: ADMIN_ROLES, cat: 'admin' },
  '/cron':            { title: '定时任务',     module: 'data',      roles: ADMIN_ROLES, cat: 'admin' },
  '/roles':           { title: 'AI 团队',      module: 'chat',      roles: ADMIN_ROLES, cat: 'admin' },
  // 🔴 `/settings` **故意不挂任何 module**：`_ALL_MODULES` 里有 `settings`，
  //    但 `_PATH_MODULE_MAP` 里**没有任何接口归它**（幽灵模块），而老板的 `_DEFAULT_PERMS`
  //    里恰好没有 `settings` ⇒ 一旦挂上 `module: 'settings'`，**老板自己的「设置」菜单会消失**。
  '/settings':        { title: '设置',         module: null,        roles: ADMIN_ROLES, cat: 'admin' },
  // 舟谱单据导入：名单来自后端 `zhoupu_documents.py::_guard()`（AST 护栏逐项比对）。
  // 侧栏已撤掉入口（迁进能力中心卡片），但深链与卡片都走本行。
  '/zhoupu-import':   { title: '舟谱单据导入', module: null,        roles: ZHOUPU_IMPORT_ROLES, cat: 'admin' }
}

/**
 * 取某路径对应的规则：**精确匹配 → 逐级去掉尾段再匹配**（子路由继承父级）。
 * `/archive/employees` → `/archive`；`/loss-accounting` → 精确命中本行（不会被父级误配）。
 * 未登记 ⇒ `null`（调用方一律按放行处理，见文件头 §四）。
 */
export function ruleFor(path) {
  let p = String(path || '').split('?')[0].split('#')[0].replace(/\/+$/, '')
  while (p) {
    if (PAGE_RULES[p]) return PAGE_RULES[p]
    const i = p.lastIndexOf('/')
    if (i <= 0) return null
    p = p.slice(0, i)
  }
  return null
}

/**
 * **入口显隐用**（侧栏 / 命令面板 / 页内跳转）：两条轴都判。
 * @param {string} path      路由路径
 * @param {string} role      `store.user.role`
 * @param {Function} canModule  `store.canModule`（传函数而非模块集合，避免各调用点自己拼）
 * @returns {boolean} true = 显示 / 可进
 */
export function canSeePage(path, role, canModule) {
  const r = ruleFor(path)
  if (!r) return true                                     // 未登记 ⇒ 放行
  if (r.roles && !roleIn(role, r.roles)) return false
  if (r.module && typeof canModule === 'function' && !canModule(r.module)) return false
  return true
}

/**
 * **路由守卫用**：只判**角色硬门槛**。
 *
 * 🔴 这里**故意不判 `module`** —— 沿用 v275 的决策（见 `router/index.js` 那段注释）：
 *    模块判据是面向菜单的优化，边界已在后端；未授权时页面自己会渲染常驻的无权限说明。
 *    按模块拦会把「接口抖一下」放大成「进不去页面」，收益不抵风险。
 *    而 `roles` 是**硬事实**（后端整页 403 / 产品内置），拦在门口不会误伤任何合法用法。
 */
export function pageRoleAllowed(path, role) {
  const r = ruleFor(path)
  if (!r || !r.roles) return true
  return roleIn(role, r.roles)
}

/** 供护栏 / 文档用：本表登记的路径清单。 */
export const PAGE_PATHS = Object.keys(PAGE_RULES)

/** 路径 → 中文名（用于"你没有访问「xxx」的权限"这类提示）。未登记 ⇒ 空串。 */
export function pageTitle(path) {
  const r = ruleFor(path)
  return (r && r.title) || ''
}

/**
 * **便捷判据**：读当前 store 上下文（`store.user.role` + `store.canModule`）。
 *
 * 模板里直接 `v-if="canSee('/cron')"`、JS 里直接 `if (!canSee('/connect')) return` 即可。
 *
 * 🔴 为什么要收这一个壳，而不是让调用点各写 `canSeePage(p, store.user.role, store.canModule)`：
 *    那样写，「少传一个参数」不会报错、而是**静默降级** —— `canModule` 传成 undefined 时
 *    `canSeePage` 直接跳过模块轴（`typeof canModule === 'function'` 为假），页面看着照常显示，
 *    却悄悄少了一层判据。这正是本项目反复栽的"规则抄多份"的同一类坑。
 *    收敛成一个壳之后，调用点连参数都不用传，不可能写错。
 */
export function canSee(path) {
  return canSeePage(path, store.user.role, store.canModule)
}
