/* ============================================================================
   pages.js —— 页面注册表：前端「入口可见性」的唯一真源（v291，2026-09-27）
   ============================================================================
   需求原话（老板）：**「不同的角色登录进去后只能看到自己有权限的页面」**。

   ---------------------------------------------------------------------------
   一、为什么不能只按权限模块判（这是本文件存在的全部理由）
   ---------------------------------------------------------------------------
   后端权限模块一共 19 个，粒度**极粗** —— 实测 `_PATH_MODULE_MAP` 304 条接口里：
       · `data`    占 83 条（档案 / 渠道价格 / AI 引擎 / 招投标 / 定时任务 / 补录 / 报单…）
       · `accounts` 61 条、`stock` 36 条、`sales` 36 条、`hr` 28 条 …
   于是「模块授权」根本回答不了「这个角色该不该看这一页」：

     · 员工 `staff` 的模块 = `data + chat + stock` ⇒ 按模块判，他会看到
       档案管理 / 渠道与价格 / AI 引擎 / 招投标雷达 / 定时任务 / 库存效期补录
       **六到八个管理页面**（因为报单要用 `data`，`/api/cron` 恰好也归 `data`）。
     · 司机 `driver` 的模块里有 `stock`，而 `/api/loss` 也归 `stock`
       ⇒ 司机能看到「货损核算」（金额与货损率）。
     · 员工 `staff` 的模块里**没有 `dashboard`**，而首页 `/workbench` 的主接口归 `dashboard`
       ⇒ 若首页也按模块判，**员工登录后连首页都进不去**（落到空白页）。

   ⇒ 结论：模块只能表达「**这个租户有没有买这个能力**」（客户可在「设置 › 权限」自助勾选），
      表达不了「**这个角色该不该看这一页**」。后者必须由产品内置，就是本表。

   ---------------------------------------------------------------------------
   二、两条轴 + 一条「让位」规则（v296）
   ---------------------------------------------------------------------------
     · `module` —— 后端权限模块（读 `store.canModule`）。客户可在「设置 › 权限」自助开关，
                    用来表达「这个租户用不用得上这个功能」。
     · `roles`  —— 角色硬门槛（读 `roles.js::roleIn`）。产品内置，
                    用来表达「这一页天然只给某几类人」。
     · `lock`   —— （v296 新增，可选）`true` = **连客户配置也放不开**的产品硬锁。
     🔴 `roles: null` = 不按角色收紧，只看模块。

   ---------------------------------------------------------------------------
   二之二、v296「用户配置优先」——为什么 `roles` 必须会**让位**
   ---------------------------------------------------------------------------
   背景（老板原话）：「允许用户自主为角色分配和调整权限；当权限发生变更时，该角色对应的
   UI 界面元素应同步动态调整」。把这句话落到实处时，出现了**两套判据打架**：

     老板在「设置 › 权限」给 `会计` 勾上 `data` 模块，权限页当场显示"会计可以查看"，
     但侧栏的「定时任务」仍旧不出现（`/cron` 的 `roles` 白名单把它挡在门外）
     ⇒ **权限页说的话与实际界面不符**。这正是本项目反复在修的「假」那一族
        （权限页在许诺一个它兑现不了的事）。

   定下的规则（`roleGateOpen`）——三档，只有第 ③ 档会让位：
     ① 本行没配 `roles`                     ⇒ 不看角色，直接过。
     ② 角色在 `roles` 名单里                 ⇒ 过。
     ③ 角色**不在**名单里，但**本租户已为该角色真实改过权限**（后端 `custom_roles`），
        且本行**配有 `module`**、且**未被 `lock` 锁住** ⇒ **让位**，改由 `module` 轴单独裁决。

   🔴 为什么第 ③ 档要求「本行必须配有 `module`」——这条限制是安全阀，不是偷懒：
      若允许「让位」发生在 `module: null` 的页面上，那一页就**一个判据都不剩**了
      （角色让位 + 没有模块可判）= 对所有"被自定义过的角色"全开。后果具体而不抽象：
      `/archive`（档案管理）与 `/price-channels`（渠道与价格）都是 `module: null`，
      一旦全开，老板在权限页随手点一下"保存权限"，**每个角色都会多出这两个入口**。
      所以：`module: null` 的页面（= 产品内置能力包）**客户配不了**，这是刻意的，
      要放开必须先给它们建一个真模块（后端要同步改 `_PATH_MODULE_MAP`），不能只改这里。

   🔴 现在恰好有 3 页**同时**配了 `roles` 与 `module`（其余各页只有一条轴，故不受本规则影响）：
      `/bid-radar`（module `bid`）、`/cron`（module `cron`）、`/roles`（module `chat`）。
      前两页后端只按模块裁决 ⇒ 让位是**诚实**的（放开就能真进去）。
      而 `/roles`（AI 团队）是**配置页**、且 `chat` 模块人人都有 ⇒ 已 `lock: true` 锁死，
      否则任何角色一旦被改过就会看到「AI 团队」。同理 `/settings` 也标了 `lock: true`
      （它是权限页本身所在，放开等于把改权限的入口发给被管的人）。
      —— `lock` 是**显式声明**，即使某页当前因为 `module: null` 而天然不会让位，
         也照样标上：后人给它补 `module` 时，锁还在。

   ---------------------------------------------------------------------------
   二之三、v296：`data` 拆出 `cron` / `bid` 两个窄模块（让位规则的前置修复）
   ---------------------------------------------------------------------------
   上面第 ③ 档（让位）有一个前提：**「勾了这个模块」必须真的等于「想开这一页」**。
   而 `data` 不是这样的模块 —— 它一条管 **83 个接口前缀**，业务名却叫「档案管理」：
     老板在权限页给「会计」勾上「档案管理」（本意：让她看客户/商品档案），
     却同时把 `/api/cron`、`/api/bid-radar` 也一并授了出去；这两个角色一旦被改过权限，
     `/cron`、`/bid-radar` 就**让位** ⇒ 会计的侧栏凭空多出「定时任务」。
     权限页从头到尾没提过这件事 —— 又是一次"许诺得比兑现的多"。

   v296 的修法不是改让位规则（那是老板明确要的：客户能自主调权限），而是**把模块拆细**：
     · `/api/cron`      → 新模块 `cron`（权限页中文名「定时任务」）
     · `/api/bid-radar` → 新模块 `bid`（权限页中文名「招投标雷达」）
   拆完之后，「档案管理」与「定时任务」变成两个可**分别**勾选的项 ⇒ 第 ③ 档重新变得诚实。

   🔴 三处缺一不可（少任一处都是静默失效）：
     ① 后端 `core._ALL_MODULES`（权限页要能勾到它）；
     ② 后端 `server.py::_PATH_MODULE_MAP`（接口要真按它裁决）；
     ③ **迁移脚本**（老租户的等价性）。③ 最容易被漏：拆了映射却不迁移 ⇒
        老租户里"原本靠 `data` 就能调 `/api/cron`"的角色**全部 403**，
        而前端 `/cron` 页面照样打得开（它的 `roles` 含 boss）⇒ **页面进得去、数据拉不到、零报错**。
        迁移判据 = **写死四个默认持有 `data` 的角色**（boss / sales / staff / supervisor）补
        `cron`/`bid`；客户手工勾出来的 `data`（如给会计勾的「档案管理」）**不补** —— 那正是要消除的连带。

   ⚠️ 顺带纠正一处**文案漂移**：权限页里原先把 `tasks` 标作「定时任务」，
      但 `tasks` 管的是 `/api/tasks`+`/api/projects`（任务看板 / 项目），与定时任务无关。
      v296 起 `tasks` 显示为「任务与项目」，而「定时任务」这个名字归新模块 `cron`（对齐页面名）。

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

   🔴 v296 补充：`pageRoleAllowed`（守卫用）与 `canSeePage`（入口用）现在都调同一个
      `roleGateOpen`。「让位」这件事只在**一处**实现 ⇒ 不可能出现
      「侧栏按规则放开了、守卫却还按旧名单拦」这种**假封锁回归**。

   ---------------------------------------------------------------------------
   四、fail-open / fail-closed 的分界（纪律，不是疏忽）
   ---------------------------------------------------------------------------
     · **未登记的路径 ⇒ 放行**。新增页面忘了登记时，页面照常可用（不会白屏），
       只是暂时不受门禁保护。反向（未登记 ⇒ 拒绝）会让一次漏登记把整页锁死。
     · **角色「未加载」（空串）⇒ 放行**。启动瞬间 `store.user.role` 还是空串，
       此刻判 false 会把合法用户（含老板）的菜单全藏掉。
     · 🔴 **角色「真未知」（非空、但不在 `ROLE_NAMES` 里）⇒ 收紧**（v296 修洞）。
       这是 v296 之前的一个真洞：原 `roleIn()` 对"未知"一律放行，于是租户只要在员工档案里
       填一个自定义角色名（如 `库管`），该角色就**绕过产品内置的全部 `roles` 门槛** ——
       既越权看到入口，又在「预报订货管理」这类页上造出**假入口**（页内判据说可以、后端 403）。
       现在「未知」分两判：空串 = 未加载 = 放行（技术性竞态）；非空未知 = 收紧。
       客户要给自定义角色放开，走「设置 › 权限」那条正门（`roleGateOpen` 第 ③ 档让位）。
     ⚠️ v296 的另一条：`customRoles` 拿到 `null`（= 不知道哪些角色被改过）时**不让位**，
        即退回"只认内置 `roles`"的**较严**那一侧。方向理由：`perms` 拉不到时若"藏菜单"，
        代价是老板眼前少几个入口（看得见、可刷新）；而 `customRoles` 拉不到时若"放行"，
        代价是每个角色的菜单**凭空多出**「定时任务 / AI 团队」几个入口（看起来就像权限失效）。
        后者更像缺陷、更难解释。
   ============================================================================ */
import { roleIn, normRole, FORECAST_SUMMARY_ROLES, ZHOUPU_IMPORT_ROLES } from './roles'
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
 *   lock    —— （v296 可选）`true` = 产品硬锁：**连客户配置也放不开**（见文件头 §二之二）。
 *   cat     —— 分类（仅作文档与护栏用，运行时不用）：'core' 人人 | 'biz' 业务岗 | 'admin' 管理岗
 */
export const PAGE_RULES = {
  /* —— core：所有登录用户都应能到达 —— */
  // 🔴 首页**绝不能**挂 `module: 'dashboard'`：`staff` 的模块里没有 dashboard，
  //    挂了就是「员工登录后首页被藏」，而 `/` 的 redirect 与登录成功跳转都指向它 ⇒ 白屏。
  '/workbench':       { title: '经营工作台',   module: null,        roles: null,        cat: 'core' },
  '/dashboard':       { title: '经营趋势',     module: 'dashboard', roles: null,        cat: 'core' },
  // ⚠️ `/ai-hub`（原「AI 中心」）**已从 core 移走** —— v311 起并入「AI 引擎」并收口为管理岗，
  //    登记行在下方 admin 段（与 `/connect` 相邻），不在本段。见那里的说明。

  /* —— biz：业务管理岗（BIZ_ROLES） —— */
  // ⚠️ `/forecast` 的名单**不是** BIZ_ROLES：后端 `forecast_submissions.py::SUMMARY_ROLES`
  //    只放 管理员/老板/主管，前端必须与它逐项一致（有 AST 护栏），否则就是假入口。
  // v332（2026-09-29）：补 `module: 'data'` —— 这一页**整页数据都靠 `data`**
  //   （`/api/forecast/*`、`/api/forecast-submissions/*`、`/api/products`、
  //    `/api/report-mappings/*` 均归 `data`）。此前只有角色门槛 ⇒ 造出本项目最典型的病灶
  //   「入口在、进去全 403」：2026-09-29 主管郝洋即如此（他在名字单里、却没有 `data`）。
  //   🔴 这是**纯收紧**且与现实一致：admin/boss 持 `"*"`、supervisor 迁库后有 `data`，
  //      而除这三者外没有角色能看见本页（名单与后端 `SUMMARY_ROLES` 逐项一致、有 AST 护栏）。
  //   ⚠️ 页面内的「审核 / 定稿」「厂家返利」另外依赖 `forecast-audit`（v332 新拆的窄模块），
  //      它**不**参与本行可见性判断 —— 缺它只是那两块不可用，页面本身仍有意义。
  // 🔴 v347（2026-09-30）：`module: 'data'` → **`'forecast'`**（从 `data` 拆出的新窄模块）。
  //   动机：`data` 是「档案管理」，而库管（自定义角色）持有它 —— 他管商品/客户档案，
  //   与"报单"毫无关系，却因此**看见了本页**（本租户动过他的权限 ⇒ 让位生效）。
  //   这与 v296 拆 `cron`/`bid`、v332 拆 `forecast-audit` 是**同一招**：拆细模块，让
  //   「勾了这一项」重新等于「想开这一页」（文件头 §二之三）。
  //   ✅ 为什么**不**改判 `lock`：加锁是"产品硬拦，客户也放不开"；而本页该由
  //      「勾了 `forecast`」这条正门控制 —— 客户想给自定义角色放开就在权限页勾它，
  //      勾完入口自动出现、数据层也通（两条轴同源）。lock 是留给配置类页面的。
  //   ⚠️ 影响面（已逐角色核过）：名单里四类人（管理员 / 老板 / 主管 / 会计）
  //      **全部已持 `forecast`**（v347 同批改 `_DEFAULT_PERMS` ＋ 迁租户库）⇒ 对谁都不隐藏。
  //      库管 / 分销商 / 一线角色**不持** `forecast` ⇒ 入口消失、深链被拦、接口 403
  //      （此前是"看得见、点进去页内恒空"＝本项目定义的**假入口**，消失才是修复）。
  // 🔴 v390（2026-10-07）：`title` 由「预报订**货**管理」统一为「预报订**单**管理」（老板拍板）。
  //   这个名字有 **8 份**（含后端 2 份），必须同一批改 —— 清单见 `core.py::MODULE_LABEL["forecast"]`
  //   上方那段；少改一处就会出现「守卫提示 / 权限页 比界面早一代」的文案漂移。
  '/forecast':        { title: '预报订单管理', module: 'forecast',  roles: FORECAST_SUMMARY_ROLES, cat: 'biz' },
  // v333（2026-09-30）：补 `module: 'sales'`。此前是 `module: null`（只看角色名单）。
  //   老板原话：「角色权限界面怎么没有『预报订单管理和返利与目标』的权限配置框」——
  //   🔴 根因有两层，这是第二层：**权限页上根本没有任何一个框能控制本页**。
  //   权限页的每一行是**后端模块**，而 `/rebate` 的 `module` 是 `null` ⇒ 它在权限页上
  //   **不出现**；同时页内数据（含「达成填报」页签）全走 `/api/rebate-*` ⇒ 归 `sales`
  //   （见 `server.py::_PATH_MODULE_MAP` 的 v112 R38 注释）⇒ 老板勾了「销售管理」也不知道
  //   勾的是这一页。补上后「目标与返利」↔「销售管理」形成真实映射（权限页会据此显示
  //   「对应页面」，见 `Settings.vue::pageNamesFor`）。
  //   ⚠️ 这是**纯收紧**，且对当前默认值**零影响**：`BIZ_ROLES` 五个角色
  //      （admin/boss/accountant/sales/supervisor）实测**全部持有 `sales`**。
  //      与 v332 给 `/loss-accounting` 补 `module: 'stock'` 同一配方 ——
  //      不满足时入口消失，而不是"看得见、点进去恒空"（本项目定义的**假入口**）。
  //      ⚠️ 若某租户在权限页撤掉某角色的「销售管理」，该角色的本页入口会一并消失，
  //         这是**有意**的：那种状态下他进去也是全 403，消失才是修复。
  '/rebate':          { title: '目标与返利',   module: 'sales',     roles: BIZ_ROLES,   cat: 'biz' },
  // v332b（2026-09-30）：补 `module: 'stock'` —— 与 `/loss-accounting` 同一批处理。
  //   本页数据全在 `stock`（`/api/loss/recipe`、`/api/loss/run`；页内那个「建议徽标」
  //   还调 `/api/payroll-workflow/advice`（归 payroll），**刻意不为此放开算工资** ——
  //   该调用自带 catch，失败只是徽标不显示）。
  //   🔴 敢挂的前提是**逐角色核过**：老板已给 主管/会计 开 `stock`，而 `BIZ_ROLES` 五类人
  //      现在全都有 `stock` ⇒ 对谁都不隐藏，只把"入口由谁裁决"换成模块轴。
  '/loss':            { title: '货损计算工作流', module: 'stock',   roles: BIZ_ROLES,   cat: 'biz' },
  // v332（2026-09-29）：补 `module: 'stock'`。老板原话：「货损核算提示权限不足，
  //   但侧栏还是有这个模块的显示 —— 应该设置成如果该角色没有这个权限就不显示这个侧栏」。
  //   本页数据全在 `stock`（`/api/loss` → stock，`_PATH_MODULE_MAP` 首个前缀命中即停）
  //   ⇒ 与角色门（BIZ_ROLES）**两轴取交集**：任一不满足就不显示。
  //   ⚠️ 影响面（已核）：**会计**没有 `stock` ⇒ 入口消失（此前是"看得见、点进去 403 恒空"，
  //      属于本项目定义的**假入口**，消失才是修复）。老板若要让会计看货损核算，
  //      正门是「设置 › 权限」给会计勾「仓库管理」——勾完入口会自动出现（本行不再写死名单）。
  //   🔴 加 `module` **只会更严**，不会放宽任何东西：`canSeePage` 是 `roles ∧ module`。
  // v349（2026-09-30）：`module` 由 `stock` **改挂新窄模块 `loss`**（老板原话：
  //   「货损核算要单独一个开关」）。此前它与 `/loss`（货损计算工作流）、`/data-fill`、
  //   `/archive/warehouses` **共用 `stock` 一个开关** ⇒ 想关「货损核算」必须连关 3 页。
  //   ✅ 拆得动是因为接口边界本来就干净：`routers/loss_accounting.py` 的 prefix
  //      = `/api/loss/accounting`，与 `routers/loss_workflow.py` 的 `/api/loss` 完全分离；
  //      本页数据 **100% 来自 `/api/loss/accounting/*`**（已逐条 grep 复核）。
  //   ✅ 等价性：v349 迁移脚本给**所有持 `stock` 的角色**补了 `loss` ⇒ 挂上新模块后
  //      谁都不会"突然看不见"（那才是变更，不是拆分）。
  //   ⚠️ 同类约束不变：`canSeePage` = `roles ∧ module`，加/换 `module` 只会更严或等价。
  //   🔴 配套必改项：`LossAccounting.vue` 里 6 处 `canDo('stock', …)` 按钮门禁要同步改成
  //      `canDo('loss', …)` —— v335 的页内门禁用的是**接口模块**，写错键会 fail-closed
  //      ⇒ 整页按钮消失（v335 踩过的坑）。
  '/loss-accounting': { title: '货损核算',     module: 'loss',      roles: BIZ_ROLES,   cat: 'biz' },
  // v332b（2026-09-30）：补 `module: 'stock'`。本页两条数据链都在 `stock`
  //   （`/api/batch/expiry-scan`、`/api/inventory/near-expiry`）；**导入那一步**调
  //   `/api/import/*`（归 `data`）—— 主管本来有 `data`，会计由 v333 拿到 `data`
  //   ⇒ 两类人都能整页走通（只有 `stock` 会卡在导入）。
  '/data-fill':       { title: '库存效期补录', module: 'stock',     roles: BIZ_ROLES,   cat: 'biz' },
  // 档案管理：`/archive/employees|customers|brands|products|warehouses|prices` 六个子路由自动继承本行。
  //   ⚠️ 子路由**必须**全部在 router/index.js 的 /archive children 里登记；父级只解析到
  //      `/archive` 这一段，多出的路径段不会自动继承、会落到 404。
  // 🔴 v341（2026-09-30）：本容器改为**单值 `module: 'data'`**，与「设置 › 权限」里的
  //    「档案管理」开关**同源**（那一行就是 `data` 模块）。这样"取消某角色的档案管理权限"
  //    才会真正让侧栏入口消失 —— 此前用 `moduleAny`（hr/crm/data/stock 任一可用即显示），
  //    主管虽被撤了 `data`，却仍持有 `stock`（v332b 为让他用「货损核算」而授予），
  //    于是入口照常出现（老板 2026-09-30 报障）。
  //   ⚠️ 为什么改成单值不会误伤其他角色：BIZ_ROLES（admin/boss/accountant/sales/supervisor）
  //      中只有"被撤掉 data 的主管"在撤后仍持其它档案模块（stock）；其余四类都自带 `data`，
  //      入口照常显示。非 BIZ_ROLES 的司机/导购/员工/分销商本就被角色门槛挡在门外，与模块无关。
  //   ⚠️ 页签**仍**逐条登记（下方六行）：父级只决定「侧栏这一项出不出现」，页签是否渲染由
  //      `ruleFor('/archive/xxx')` 判（员工→hr、客户→crm、品牌/商品/渠道价→data、仓库→stock）——
  //      两道缺一就会出现「进得去档案管理、点『员工档案』却 403」（2026-09-29 主管与会计的真实报障）。
  '/archive':         { title: '档案管理',     module: 'data', roles: BIZ_ROLES, cat: 'biz' },
  // v332：六个页签逐条登记自己的模块（`ruleFor` 精确匹配优先，会盖住父级的 `module:'data'`）。
  //   ⚠️ `title` 用**页签自己的名字**（不是统一叫「档案管理」）—— 它是路由守卫那句
  //      「你没有访问「xxx」的权限」的文案；写具体的名字，用户才知道自己缺的是哪个模块。
  '/archive/employees':  { title: '员工档案', module: 'hr',    roles: BIZ_ROLES, cat: 'biz' },
  '/archive/customers':  { title: '客户档案', module: 'crm',   roles: BIZ_ROLES, cat: 'biz' },
  '/archive/brands':     { title: '品牌档案', module: 'data',  roles: BIZ_ROLES, cat: 'biz' },
  '/archive/products':   { title: '商品档案', module: 'data',  roles: BIZ_ROLES, cat: 'biz' },
  '/archive/warehouses': { title: '仓库档案', module: 'stock', roles: BIZ_ROLES, cat: 'biz' },
  // v387（2026-10-06）批次 1.2：新增「供应商档案」页签（档案管理第 7 个页签）。
  //   轴的选择理由：与**同容器的兄弟页签**同轴（品牌 / 商品都用 `module:'data'` + `BIZ_ROLES`），
  //   不另立窄名单。三点权衡（记下来免得后人重推）：
  //     ① 若挂 `module:'inventory'`：进销存能力**当前默认只有 boss 持有**（v380 闸门）⇒
  //        会计连供应商都录不了；而供应商主档是**档案能力**的一部分，不是采购执行能力。
  //     ② 若用 `module:null` + 窄 roles：会变成 `/archive/prices` 那种"产品硬锁、客户配不了"页面；
  //        供应商不像价格体系那样需要硬锁，没必要占一个不可配置位。
  //     ③ 与兄弟页签不同轴 ⇒ 用户会问「档案管理里别的都有、为什么就这个没有」= 支持成本。
  //   ⚠️ 敏感面处置（**在页面层，不在门禁层**）：`bank_account` 是加密列（SENSITIVE_FIELDS）
  //      ⇒ **列表不展示开户行/账号**，只在编辑弹窗里可填可改。若哪天老板要求业务员看不到
  //      供应商页，改这一行的 roles 即可（一行改动，无需动后端）。
  //   `title` 用页签自己的名字（不是「档案管理」）—— 它是守卫那句「你没有访问「xxx」的权限」的文案。
  '/archive/suppliers':  { title: '供应商档案', module: 'data', roles: BIZ_ROLES, cat: 'biz' },

  // 算工资：**只挂 module、不挂 roles** —— 这是 2026-09-19 拆出 `payroll` 窄模块时的明确契约：
  //   「会计能不能算工资按客户差异，由各租户在权限页自行授予」（见后端 `_DEFAULT_PERMS` 注释）。
  //   这里若加角色硬门槛，客户在权限页给会计勾了 `payroll` 也放不开 ⇒ 违背该契约。
  '/payroll':         { title: '算工资',       module: 'payroll',   roles: null,        cat: 'biz' },
  // 招投标雷达：v296 起接口归**独立模块 `bid`**（原归 `data`）⇒ 勾「档案管理」不再连带放开本页。
  //   角色门槛保留：`bid` 模块本身仍可能被客户授给任意角色，而这一页天然只给这几类人。
  //   给业务员留一个：招投标情报正是跑业务的人用得上的东西。
  // 🔴 v347（2026-09-30）**给主管补进名单**（老板原话：「『招投标雷达』要给主管看」）。
  //   此前主管能看到本页，靠的是**让位**（他持 `bid` ＋ 本租户改过他的权限）—— 那是一条
  //   隐式路径：v345 全站审计正是在排查它时才顺带发现"主管持 `bid`"。隐式改**显式**两个好处：
  //     ① 不再依赖「本租户曾动过这个角色的权限」这个前提（新租户 / 没动过权限的租户同样成立）；
  //     ② 名单即文档 —— 与产品意图一致，后人不必再去推断"他为什么看得见"。
  //   ⚠️ **不加 `lock`**：本行是**显式放行**，而"让位"那条正门要留给自定义角色
  //      （客户可自行在权限页给某个角色授 `bid`）。
  '/bid-radar':       { title: '招投标雷达',   module: 'bid',       roles: [...ADMIN_ROLES, 'sales', 'supervisor'], cat: 'biz' },

  /* —— admin：管理岗（ADMIN_ROLES） —— */
  // v311（2026-09-28）：**渠道与价格并入「档案管理」当第 6 个页签**，侧栏不再单列。
  //   本行**保留**：旧路径 `/price-channels` 已改为 `redirect → /archive/prices`
  //   （书签 / 浏览器历史 / 群里的链接都在用它），`ruleFor` 仍要能查出这个名字。
  //   ⚠️ 真正生效的是下方 `/archive/prices` 那一行 —— **不要以为改这里就够了**。
  '/price-channels':  { title: '渠道与价格',   module: null,        roles: [...ADMIN_ROLES, 'accountant'], cat: 'admin' },
  // 🔴 v311 新增：页签化后的**真实登记行**。
  //   为什么必须单独登记、不能靠父级 `/archive` 继承：`/archive` 是 `BIZ_ROLES`
  //   （多出 **主管 / 业务员** 两类人），而价格只该给老板 / 管理员 / 会计
  //   ⇒ 靠继承会**把价格体系对主管敞开**（文件头 §二之二 第 52-58 行警告过这件事）。
  //   `ruleFor` 是**精确匹配优先**，所以这一行会盖住父级的宽名单。
  '/archive/prices':  { title: '渠道与价格',   module: null,        roles: [...ADMIN_ROLES, 'accountant'], cat: 'admin' },
  // v311（2026-09-28）：**「能力中心」更名为「AI 引擎」**。
  //   更名理由：并入「AI 中心」当第 5 个页签后，它装的是 AI 的**整条链** ——
  //   接入（连接器）→ 配置（专家 / 技能）→ 运行（进化日志）→ 产出（产出与用量）。
  //   「能力中心」只罩得住第 3 段（技能），**名字比内容窄** ⇒ 用户猜不到里面有什么。
  //   ⚠️ 这是本容器的**第二次改名**（连接中心 → 能力中心 → AI 引擎）：改一次就有一次
  //      记忆/文档/截图成本 ⇒ 以后往里加东西，都必须能被"引擎"罩住，别再改。
  '/connect':         { title: 'AI 引擎',      module: null,        roles: ADMIN_ROLES, cat: 'admin' },
  // v311（2026-09-28）：**原「AI 中心」并入「AI 引擎」当第 5 个页签「产出与用量」**。
  //   侧栏不再单列，但**路由保留为活的**（不 redirect）—— 与本文件里的 `/roles`（AI 团队）
  //   完全同构：有路由、无侧栏项、靠容器页签进入。→ 深链 / 命令面板 / 副驾 drillTo 都还能走。
  //
  //   🔴 为什么必须显式收紧（而不是维持原来的 `cat:'core'` + `roles:null`）：
  //      它是一个**物理嵌入**的页签，用户得先能进「AI 引擎」（= ADMIN_ROLES）。
  //      两侧口径不一致就会造出本项目的「假封锁」—— 页面没坏、入口没了、零报错。
  //   🔴 `lock: true` 是**必须的**（不是保险）：本行挂的 `module: 'chat'`，而**每个角色都持有 chat**
  //      ⇒ 只加 `roles` 不加 `lock`，`roleGateOpen` 第 ③ 档（用户配置优先）就会让位，
  //      **收紧是假的**，还给人一种"已经管住了"的错觉。与 `/roles`、`/settings` 同一个洞。
  //   ⚠️ 影响面（已核实）：主管 / 会计 / 导购 / 司机 失去本页入口；老板与管理员不受影响。
  //      业务员自 v310 起已被收紧为「仅小程序」，本就登不进网页端，不在影响面内。
  '/ai-hub':          { title: '产出与用量',   module: 'chat',      roles: ADMIN_ROLES, lock: true, cat: 'admin' },
  // v296：接口从 `data` 拆到独立模块 `cron`。动机见文件头 §二之三 ——
  //   「老板给某角色勾『档案管理』，却连带放开了定时任务」这件事，根因是 `data` 粒度太粗。
  //
  // 🔴 v345（2026-09-30）`lock: true` —— **本行曾经就是一个活洞**。
  //   v296 拆模块时按「谁原本真能调 `/api/cron`」做迁移，把 `cron` **补给了
  //   boss / sales / staff / supervisor**（见 `tools/v296-data-split-migrate.py` 的目标角色表）。
  //   而本行的 `roles` 只有 ADMIN_ROLES —— 两者一叠加，让位规则就被踩中：
  //   老板只要**动过某个角色一次权限**（`custom_roles` 含该角色），第 ③ 档就让位，
  //   改由 module 轴单独裁决 ⇒ **持有 `cron` 的主管立刻看到「定时任务」**。
  //   生产实测（`tools/v345-cron-delegate-e2e.mjs`）：
  //     · 主管 + 未改过权限 ⇒ 不出现（名单拦得住）
  //     · 主管 + 改过权限（且持 cron）⇒ **出现** ← 老板报障原话「郝洋不该看到我的定时任务」
  //   加 `lock` 后：与 `/ai-hub`、`/roles`、`/settings` 三行同族 ——
  //   「定时任务」是**租户级配置页**（页面副标题：AI 副驾的定时任务，结论可推送企业微信），
  //   产品上只给老板与管理员，**连客户配置也放不开**（`ADMIN_ROLES` 的注释原文就是这么写的：
  //   「只要配置类页面（价格 / 接入 / 定时任务）—— 老板与管理员」）。
  //   ⚠️ 影响面（已核实）：主管 / 会计 / 业务员 / 员工 / 司机 失去本页**入口**；
  //      老板与管理员不受影响。本页此前对他们是"误得"，不是既有业务能力。
  '/cron':            { title: '定时任务',     module: 'cron',      roles: ADMIN_ROLES, lock: true, cat: 'admin' },
  // v380（2026-10-06）：进销存 —— 老板自研新能力，**开发闸门：默认只 boss/admin 可见**。
  //   🔴 为什么 `lock: true`：本行是**窄名单**（ADMIN_ROLES ≤2），挂的 `module: 'inventory'`
  //      目前只有 boss（admin 经 `["*"]`）持有 ⇒ 若不加锁，`roleGateOpen` 第 ③ 档「让位」会
  //      在本租户为某个自定义角色改过权限后，把进销存**对那个角色放开**（v345 的活洞同款）。
  //      现在是「先自用」阶段，连客户配置都不放开才是老板要的「其他人看不到」。
  //   ⚠️ 将来要卖给客户 / 开给库管、会计等，**改这一行**（加进 `roles` 名单，或撤 `lock`），
  //      不要在前端 Shell.vue 里另写 `v-if`（那是 v206 老形态，会造出假入口）。
  '/inventory':       { title: '进销存',       module: 'inventory', roles: ADMIN_ROLES, lock: true, cat: 'admin' },
  // AI 团队（管 AI 团队成员与提示词）—— 配置页，同「设置」一族。
  // 🔴 v296 `lock: true`：它挂的 `module: 'chat'` 而**每个角色都持有 chat**（`_DEFAULT_PERMS`
  //    里 staff/driver/guide 全有）⇒ 一旦「用户配置优先」让位生效，任何被改过权限的角色
  //    都会多出这个入口。配置类页面不该因为一次权限勾选就对全员敞开。
  '/roles':           { title: 'AI 团队',      module: 'chat',      roles: ADMIN_ROLES, lock: true, cat: 'admin' },
  // 🔴 `/settings` **故意不挂任何 module**：`_ALL_MODULES` 里有 `settings`，
  //    但 `_PATH_MODULE_MAP` 里**没有任何接口归它**（幽灵模块），而老板的 `_DEFAULT_PERMS`
  //    里恰好没有 `settings` ⇒ 一旦挂上 `module: 'settings'`，**老板自己的「设置」菜单会消失**。
  // 🔴 v296 `lock: true`：本页就是「设置 › 权限」所在。后端 `role-permissions` 四个端点
  //    一律 `core._admin`（role ∈ admin/boss）⇒ 放开入口只会造出**假入口**
  //    （能进页面、改任何一项都被 403）。锁是显式声明：即使它因 `module: null` 天然不会让位，
  //    也照样标上 —— 后人给它补 module 时，锁还在。
  '/settings':        { title: '设置',         module: null,        roles: ADMIN_ROLES, lock: true, cat: 'admin' },
  // 舟谱单据导入：名单来自后端 `zhoupu_documents.py::_guard()`（AST 护栏逐项比对）。
  // 侧栏已撤掉入口（迁进 AI 引擎卡片），但深链与卡片都走本行。
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
 * **角色门槛是否放行**（v296 抽出，`canSeePage` 与 `pageRoleAllowed` 共用唯一实现）。
 *
 * 三档（详见文件头 §二之二，那里解释了每条限制为什么必须在）：
 *   ① 本行没配 `roles` ⇒ 过；
 *   ② 本行 `roles` 名单里有该角色 ⇒ 过；
 *   ③ 都不满足，但**本租户已为该角色真实改过权限**、且本行配有 `module`、且未被 `lock`
 *      锁住 ⇒ **让位**（过）。这一档就是「用户配置优先」。
 *
 * @param {object} r            `PAGE_RULES` 里的一行
 * @param {string} role         `store.user.role`
 * @param {string[]|null} customRoles  后端 `custom_roles`；`null`/非数组 = 不知道 ⇒ 不让位
 */
function roleGateOpen(r, role, customRoles) {
  if (!r.roles) return true                      // ① 不按角色收紧
  if (roleIn(role, r.roles)) return true         // ② 在名单里（空串=未加载亦放行；真未知不放行，v296）
  if (r.lock === true) return false              // 产品硬锁：客户配置也放不开
  if (!r.module) return false                    // 没有 module 可判 ⇒ 让位 = 全开，不许
  if (!Array.isArray(customRoles)) return false  // 不知道 ⇒ 按内置门槛收紧（见文件头 §四）
  // ③ 用户配置优先：老板真的动过这个角色的权限 ⇒ 内置名单让位，交由 module 轴裁决
  return customRoles.includes(normRole(role))
}

/**
 * **入口显隐用**（侧栏 / 命令面板 / 页内跳转）：两条轴都判。
 *
 * 模块轴两种语义（v332 补第二种）：
 *   · `module`（单值）  = **必须有它**；
 *   · `moduleAny`（数组）= **至少有一个**（容器页可选语义：子页签分属多个模块时；现无页面使用，保留为支持的写法）。
 *
 * @param {string} path      路由路径
 * @param {string} role      `store.user.role`
 * @param {Function} canModule  `store.canModule`（传函数而非模块集合，避免各调用点自己拼）
 * @param {string[]=} customRoles  后端 `custom_roles`（v296；省略 ⇒ 不让位，= v291 行为）
 * @returns {boolean} true = 显示 / 可进
 */
export function canSeePage(path, role, canModule, customRoles) {
  const r = ruleFor(path)
  if (!r) return true                                     // 未登记 ⇒ 放行
  if (!roleGateOpen(r, role, customRoles)) return false
  /* v332（2026-09-29）：模块轴拆成两种语义，缺一不可 ——
       · `module`    单值 = **必须有它**（"整页数据都归这一个模块"的页面）；
       · `moduleAny` 数组 = **至少有一个**（容器页可选语义：子页签分属多个模块时；`/archive` 已于 v341 改为单值 `module`，见上文）。
     🔴 两处都遵守同一条纪律：**权限还没拉到（`canModule` 不是函数）⇒ 放行**。
        依据是既有的「拉不到 ≠ 没权限」（见 `store.canModule` 的三态语义）——
        启动瞬间把老板的入口藏掉、半秒后再冒出来，比"多点一下"（随后被后端 403 兜住）坏得多。
        ⚠️ `moduleAny` 这条**特别容易写错**：空 `some()` 天然返回 false ⇒ 漏了这层守卫
        就会在"权限未加载"时把容器页整页隐藏，而且**只在启动那一下可见**（极难复现）。
    ⚠️ 无关的模块键**不参与**判断：例如 `/forecast` 的 `module: 'forecast'` 不含
       `forecast-audit` —— 缺后者只是页内「审核/定稿」与「厂家返利」两块不可用，
       页面本身仍有意义（详见 `PAGE_RULES` 该行注释）。 */
  const has = typeof canModule === 'function'
  if (r.module) {
    if (!has) return true
    if (!canModule(r.module)) return false
  }
  if (Array.isArray(r.moduleAny) && r.moduleAny.length) {
    if (!has) return true
    if (!r.moduleAny.some(m => canModule(m))) return false
  }
  return true
}

/**
 * **路由守卫用**：只判**角色门槛**（`roleGateOpen`，与入口同一实现）。
 *
 * 🔴 这里**故意不判 `module`** —— 沿用 v275 的决策（见 `router/index.js` 那段注释）：
 *    模块判据是面向菜单的优化，边界已在后端；未授权时页面自己会渲染常驻的无权限说明。
 *    按模块拦会把「接口抖一下」放大成「进不去页面」，收益不抵风险。
 *    而 `roles` 是**硬事实**（后端整页 403 / 产品内置），拦在门口不会误伤任何合法用法。
 *    ⚠️ 但「让位」这一档必须一起放行 —— 否则侧栏按新规则放开了入口、守卫却按旧名单
 *       把人弹回工作台 = 把 v275 修好的**假封锁**重新造出来。
 */
export function pageRoleAllowed(path, role, customRoles) {
  const r = ruleFor(path)
  if (!r) return true
  return roleGateOpen(r, role, customRoles)
}

/** 供护栏 / 文档用：本表登记的路径清单。 */
export const PAGE_PATHS = Object.keys(PAGE_RULES)

/** 路径 → 中文名（用于"你没有访问「xxx」的权限"这类提示）。未登记 ⇒ 空串。 */
export function pageTitle(path) {
  const r = ruleFor(path)
  return (r && r.title) || ''
}

/**
 * **便捷判据**：读当前 store 上下文（`store.user.role` + `store.canModule` + `store.customRoles`）。
 *
 * 模板里直接 `v-if="canSee('/cron')"`、JS 里直接 `if (!canSee('/connect')) return` 即可。
 *
 * 🔴 为什么要收这一个壳，而不是让调用点各写 `canSeePage(p, store.user.role, store.canModule)`：
 *    那样写，「少传一个参数」不会报错、而是**静默降级** —— `canModule` 传成 undefined 时
 *    `canSeePage` 直接跳过模块轴（`typeof canModule === 'function'` 为假），页面看着照常显示，
 *    却悄悄少了一层判据。这正是本项目反复栽的"规则抄多份"的同一类坑。
 *    收敛成一个壳之后，调用点连参数都不用传，不可能写错。
 *    （v296 加 `customRoles` 时这条纪律又救了一次：24 处菜单 + 命令面板 13 条**一处都不用改**。）
 */
export function canSee(path) {
  return canSeePage(path, store.user.role, store.canModule, store.customRoles)
}
