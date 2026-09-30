/* ============================================================
   router.js — 蓝图副驾路由（hash 模式，无需服务端配置）
   全部页面懒加载（code-splitting）：首屏只加载登录/外壳必需代码，
   其余页面（含 1401 行的 Forecast、1239 行的 ConnectCenter）按需加载，
   显著降低首屏 JS 体积（P0 评审清单）。
   ============================================================ */
import { createRouter, createWebHashHistory } from 'vue-router'
/* v275（2026-09-25）：路由级角色守卫要用到 store 与角色判据。
   🔴 这里**静态** import store 是安全的（已核实）：store/index.js 不反向依赖 router
      （`api/client.js` 零 import 语句），且 main.js 是 `app.use(pinia).use(router)`，
      而 store/index.js 用的是 `useAppStore(pinia)`（显式传实例）⇒ 不依赖"当前 active pinia"，
      在 app 挂载前被求值也没问题。 */
import { store } from '../store'
/* v291（2026-09-27）：「哪些角色能进哪些页」已收敛到 `constants/pages.js` 的**页面注册表**。
   本文件不再自己写判据 —— 侧栏 / 命令面板 / 守卫 / 页内跳转读的是同一份表。
   （旧写法是各页 `meta.roles` 自己带名单，只有 1 个页面填了。见文件末尾守卫处注释。） */
import { ruleFor, pageRoleAllowed } from '../constants/pages'

const Login = () => import('../pages/Login.vue')
const Shell = () => import('../components/Shell.vue')
const Workbench = () => import('../pages/Workbench.vue')
const Forecast = () => import('../pages/Forecast.vue')
const Rebate = () => import('../pages/Rebate.vue')
const Dashboard = () => import('../pages/Dashboard.vue')
const ConnectCenter = () => import('../pages/ConnectCenter.vue')
const LossWorkflow = () => import('../pages/LossWorkflow.vue')
const LossAccounting = () => import('../pages/LossAccounting.vue')
const PayrollWorkflow = () => import('../pages/PayrollWorkflow.vue')
const DataFill = () => import('../pages/DataFill.vue')
// v269 (2026-09-25)：舟谱单据导入（销售结算表 / 调拨订单表 → 提货单）
const ZhoupuImport = () => import('../pages/ZhoupuImport.vue')
const EmployeeArchive = () => import('../pages/EmployeeArchive.vue')
const CustomerArchive = () => import('../pages/CustomerArchive.vue')
const ArchiveShell = () => import('../pages/ArchiveShell.vue')
const Archive = () => import('../pages/Archive.vue')
const Settings = () => import('../pages/Settings.vue')
const CronJobs = () => import('../pages/CronJobs.vue')
const RoleManage = () => import('../pages/RoleManage.vue')
const BidRadar = () => import('../pages/BidRadar.vue')
const AiHub = () => import('../pages/AiHub.vue')
const PriceChannels = () => import('../pages/PriceChannels.vue')
// v265（2026-09-24）：ProductTarget 不再由路由懒加载 —— 它已收进 Forecast.vue 当第 4 个页签
// （静态 import，随 Forecast chunk 一起加载）。旧路由 /product-target 保留 redirect，见下。

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login },
    {
      path: '/',
      component: Shell,
      children: [
        { path: '', redirect: '/workbench' },
        { path: 'workbench', component: Workbench, meta: { title: '经营工作台' } },
        { path: 'forecast', component: Forecast, meta: { title: '预报订货管理' } },
        { path: 'rebate', component: Rebate, meta: { title: '目标与返利' } },
        // v265（2026-09-24）：商品目标已收进「预报订货管理」当第 4 个页签。
        // 🔴 旧路由**保留为 redirect，不能直接删**：书签 / 浏览器历史 / 命令面板里还留着
        //    `#/product-target`，删掉就是白屏。redirect 到 `?tab=target` 后落在 /forecast 上，
        //    侧栏「预报订货管理」也能正常高亮（router-link-active 按 matched 链匹配）。
        { path: 'product-target', redirect: { path: '/forecast', query: { tab: 'target' } } },
        { path: 'dashboard', component: Dashboard, meta: { title: '经营趋势' } },
        // v311（2026-09-28）：「能力中心」改名「AI 引擎」（第二次改名，见 pages.js 的 `/connect` 行）。
        //   理由：容器现在覆盖 接入(连接器) → 配置(专家/技能) → 运行(进化日志) → 产出(产出与用量)，
        //   「能力中心」只盖住第 3 段。`meta.title` 与 `pages.js` 的 `title` 必须同源同字，
        //   否则「设置›权限」里列模块名、命令面板显示名、页签容器名会三处不一致。
        { path: 'connect', component: ConnectCenter, meta: { title: 'AI 引擎' } },
        { path: 'roles', component: RoleManage, meta: { title: 'AI 团队' } },
        { path: 'loss', component: LossWorkflow, meta: { title: '货损计算工作流' } },
        // 货损核算（月度·期间流水口径）—— 与上面的 /loss（配方驱动的批次效期预测）
        // 是两个模块：前者算"这个月实际损了多少、率是多少"，后者算"我的货里有多少快坏了"。
        { path: 'loss-accounting', component: LossAccounting, meta: { title: '货损核算' } },
        { path: 'payroll', component: PayrollWorkflow, meta: { title: '算工资工作流' } },
        { path: 'data-fill', component: DataFill, meta: { title: '库存效期补录' } },
        /* v291（2026-09-27）：本页的角色白名单已从 `meta.roles` **迁进页面注册表**
           （`constants/pages.js` 的 `/zhoupu-import` 行，名单仍是 `ZHOUPU_IMPORT_ROLES`）。
           为什么迁：判据原本散在 router / Shell / ConnectCenter 三处，天然会漂移 ——
           侧栏藏了但 URL 还能进（假封锁），或卡片在但守卫拒（假入口）。
           现在侧栏 / 命令面板 / 守卫 / 页内跳转读同一份表 ⇒ 结构上不可能再漂移。
           ⚠️ 本页**已无 `meta.roles`**（字段废弃，全表见 pages.js）—— 别在别处又补一份。
           ⚠️ 白名单只给**后端整页级拒绝**的页面配：本页后端 `_guard()` 对非 admin/boss 一律 403
               （不是"某个操作 403"，是整页不可用）⇒ 拦在门口不会误伤任何合法用法。
           ❌ 不要顺手给 /forecast、/payroll 配 `roles`：那些页面的合法用户可以进
               （只是页内某块不可见；模块未授权时页面自己会渲染常驻说明），整页拦会**误伤**。 */
        { path: 'zhoupu-import', component: ZhoupuImport, meta: { title: '舟谱单据导入' } },
        // 档案管理：父级为薄壳容器，4 个 tab 作为子路由。
        // 这样侧栏 <router-link to="/archive"> 解析出的父级 record 会出现在任意
        // /archive/* 子页面的 matched 链里，router-link-active 自动命中（与其它模块一致）。
        {
          path: 'archive',
          component: ArchiveShell,
          redirect: '/archive/employees',
          children: [
            { path: 'employees', component: Archive, meta: { title: '档案管理' } },
            { path: 'customers', component: Archive, meta: { title: '档案管理' } },
            { path: 'brands', component: Archive, meta: { title: '档案管理' } },
            { path: 'products', component: Archive, meta: { title: '档案管理' } },
            // v294：仓库档案 —— 员工「个人仓」与报单模板「源仓/目标仓」的上游主档。
            // 继承父级 `/archive` 的可见性规则（module:null + BIZ_ROLES），无需单独登记。
            { path: 'warehouses', component: Archive, meta: { title: '档案管理' } },
            // v311（2026-09-28）：渠道与价格并入本容器当第 6 个页签。
            // 🔴 它是**唯一一个不继承父级门槛**的子路由：`/archive` 是 BIZ_ROLES（含主管/业务员），
            //    而价格只给老板/管理员/会计 ⇒ 必须在 `pages.js` 里给 `/archive/prices` 单独登记
            //    窄名单（`ruleFor` 精确匹配优先）。页签本身也带 `canSee` 门禁，两道一起才不漏。
            { path: 'prices', component: PriceChannels, meta: { title: '渠道与价格' } }
          ]
        },
        { path: 'cron', component: CronJobs, meta: { title: '定时任务' } },
        // v311（2026-09-28）：「AI 中心」并入「AI 引擎」当第 5 个页签（侧栏不再单列）。
        //   ⚠️ 路由**保留为活的**，不做 redirect —— 与本仓 `/roles`（AI 团队）同构：
        //      有路由、无侧栏项、靠容器页签进入。副驾 `CopilotDrawer` 有 `drillTo('#/ai-hub')`、
        //      命令面板也可直达 ⇒ 保留活路由，这些入口才不用改判据。
        //   🔴 改名同时把可见性收口为管理岗（见 `constants/pages.js` 的 `/ai-hub` 行）——
        //      它是物理嵌入的页签，用户得先能进「AI 引擎」（ADMIN_ROLES），两侧口径必须一致。
        { path: 'ai-hub', component: AiHub, meta: { title: '产出与用量' } },
        // v311：「渠道与价格」并入「档案管理」当第 6 个页签 ⇒ 本路径改为 redirect。
        //   🔴 与 v265「商品目标」同一处置：**旧路径不能直接删** —— 书签 / 浏览器历史 /
        //      群里的链接都还留着 `#/price-channels`，删掉就是白屏。
        { path: 'price-channels', redirect: { path: '/archive/prices' } },
        { path: 'settings', component: Settings, meta: { title: '设置' } },
        { path: 'bid-radar', component: BidRadar, meta: { title: '招投标雷达' } }
      ]
    }
  ]
})

/* ---------------------------------------------------------------------------
   v275（2026-09-25）路由级角色守卫
   ---------------------------------------------------------------------------
   起因：入口可以靠 `v-if` 藏起来，但**深链藏不住** —— 书签 / 浏览器历史 / 手敲 URL /
        别处贴过来的链接都能直接落在页面上。此前 `/zhoupu-import` 正是如此：主管看不到入口，
        手敲 `#/zhoupu-import` 却能把页面打开（点到"读取"才 403）。
        表现是"看起来权限做过了，其实没有" —— 属**假封锁**，比假入口更难发现。

   🔴 为什么要 async + `ensureRoleLoaded()`（这是本段唯一的技术难点）：
      `roleIn('')` 对**空串**是 fail-open（返回 true）—— 启动瞬间 `store.user.role` 就是空串，
      此刻若判 false 会把老板弹走（见 roles.js 注释）。所以守卫**不能**直接拿
      `store.user.role` 判，必须先"把未知消掉"：等一次 `loadPerms()`
      （幂等：同一租户只真发一次请求；Shell.onMounted 也调它，命中缓存不重发）。
      代价 = 深链首次进入多等一次权限往返；换来 = 空串不再自动等于"放行"。
      ⚠️ v296：这句话的适用面**收窄**了 —— `roleIn()` 现在只对"空串 = 未加载"放行，
      对**真未知角色**（非空、但不在 `ROLE_NAMES` 里，如租户自定义的 `库管`）改为**收紧**。
      于是本段多兜住一件事：自定义角色在它本该被拒的页上**真被拒**（此前借 fail-open 穿过
      所有 `roles` 门槛，既越权又造假入口）。

   🔴 `loadPerms()` 失败（网络抖动 / 401）⇒ **放行**。取舍明确：让一个终将被后端 403 的人
      多看一眼页面，远比把管理员挡在自己系统门外轻。本仓一贯纪律「拉不到 ≠ 没权限」，这里不破例。

   ❌ 这里**故意不拦模块级权限**（`store.canModule`）：那是面向菜单的优化，边界已在后端，
      未授权时页面自己会渲染常驻的无权限说明。按模块拦会把"接口抖一下"放大成"进不去页面"，
      收益不抵风险。因此守卫只拦 `roles` 白名单（v291 起由 `constants/pages.js` 统一提供）。

   v291（2026-09-27）变更：判据从"各页 `meta.roles`（当时只有 1 页填了）"换成
      **页面注册表全表**。故现在是**所有登记了 roles 的页面**都受保护，不再是一页。
      受影响页面清单见 `constants/pages.js::PAGE_RULES`（含 `/cron` `/connect` `/settings`
      `/archive` `/rebate` `/loss-accounting` 等 11 页）—— 老板原话：「不同角色登录进去后
      只能看到自己有权限的页面」。注意这只加了**入口与深链**的门禁，**没有收窄任何后端权限**：
      被拦的角色即使手改前端缓存，接口仍会按后端权限返回 403。

   v296（2026-09-27）两处变更：
     ① 守卫改调 `pageRoleAllowed(path, role, customRoles)` —— 多传一个"哪些角色被本租户
        真实改过权限"。**「让位」这件事只在 `pages.js::roleGateOpen` 里实现一次**，
        入口与守卫共用一个实现；否则会出现"侧栏按新规则放开了、守卫还按旧名单拦"
        = 把 v275 修好的**假封锁**重新造出来。
     ② 每次导航顺带发一个**不 await** 的权限版本比对（见下方注释），用于发现
        "权限被别的会话改过"。
--------------------------------------------------------------------------- */
async function ensureRoleLoaded() {
  if (store.user.role) return store.user.role
  try { await store.loadPerms() } catch (_) { /* 拉不到 ⇒ 维持空串，由 roleIn 按"未加载"放行 */ }
  return store.user.role
}

/** v291：本页是否受角色门禁保护（= 注册表里登记了非空 roles）。 */
function roleGuarded(path) {
  const r = ruleFor(path)
  return !!(r && Array.isArray(r.roles) && r.roles.length)
}

router.beforeEach(async (to) => {
  const token = localStorage.getItem('hergent_v2_token')
  if (!token && to.path !== '/login') return '/login'
  if (token && to.path === '/login') return '/'

  /* v291：判据来自页面注册表。**只有受保护的页面**才走这段并可能发权限请求
     （`ensureRoleLoaded` 幂等，同一租户只真发一次）—— 未登记的页面不进这里，
     所以"进站首次多等一次往返"只发生在受保护页面上，不影响登录后落工作台的速度。 */
  if (token) {
    /* v291：本次会话还没拉过权限（登录后 / F5 刷新后）⇒ **先等它回来再渲染**。
       不这样的话，Shell 的 24 处菜单会因为「角色未知 = fail-open」先**全显**、
       权限回来后**再收窄**（员工会看到「定时任务 / 设置」一闪而过，观感等同权限没做）。
       代价只有一次本来就要发的请求（`perms` 非空时这里直接跳过，页面内跳转零开销）。 */
    if (!store.perms) await ensureRoleLoaded()

    /* v296：「权限被别处改过」在这里被发现 —— **故意不 await**。
       它只是一个几十字节的版本号比对；一旦 await，每次点导航（含页面内跳转）都要多等
       一次往返，把"权限联动"变成手感税。不 await 的代价 = 变更从**下一次**导航起生效，
       而"下一次"通常就在几秒内（加上 Shell 的 60 秒轮询与切回标签页检查兜底）。
       `refreshPermsIfChanged` 内部有 20 秒节流 + 全静默（见 store/index.js），
       所以这里连错误分支都不用写。 */
    store.refreshPermsIfChanged().catch(() => {})

    if (roleGuarded(to.path) && !pageRoleAllowed(to.path, store.user.role, store.customRoles)) {
      /* 🔴 拒绝必须**看得见**：`return false` 会原地停住、页面一片空白（"死按钮"的变体，
         用户会以为自己点坏了）。带 `denied` 回到工作台，由 Shell.vue 弹说明并清掉 query
         （清掉是为了刷新 / 回退时不重复弹）。
         ⚠️ 回落到 `/workbench` 是安全的：它在注册表里是 core（roles:null）⇒ 不会再被拦，
            不存在"被拦后又落到另一个被拦页面"的循环。 */
      return { path: '/workbench',
               query: { denied: String((ruleFor(to.path) || {}).title || to.path) } }
    }
  }
  return true
})
