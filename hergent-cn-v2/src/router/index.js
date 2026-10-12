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
import { ruleFor, pageRoleAllowed, PLACEHOLDER_PAGES } from '../constants/pages'
/* v449：旧建单入口 → 新独立页面的路径解析。**纯数据模块、零副作用**（只导出常量与
   两个纯函数），静态 import 不影响首屏体积，也不会引入循环依赖。 */
import { legacySalePath, legacyPurchasePath, DOC_PATHS } from '../pages/inventory/new/docTypes.js'

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
// v395（2026-10-08）：打印 —— 入口先立（老板点名「很重要」），本页为占位骨架。
const Print = () => import('../pages/Print.vue')
/* v465（2026-10-11）：四新区占位骨架 —— 99 页共用这一个组件，由下方 `PLACEHOLDER_PAGES`
   **数据驱动**批量挂载（可见性已逐页登记在 `pages.js::PAGE_RULES`，见那里 v465 段）。 */
const Placeholder = () => import('../pages/Placeholder.vue')
/* v465c（2026-10-11 仓配管理 P0）：库存查询三页**落真身** —— 从 `PLACEHOLDER_PAGES`
   移出、改为独立组件（对齐「落真身四步」，见 docs/仓配模块开发规范.md）。 */
const WhExpiryReport = () => import('../pages/wh/ExpiryReport.vue')
const WhVehicleStock = () => import('../pages/wh/VehicleStock.vue')
const WhStockAlert = () => import('../pages/wh/StockAlert.vue')
/* v465e（2026-10-11 仓配管理 P1）：**仓库作业 6 页落真身**（入库单 / 出库单 / 盘点单 /
   出入库策略 / 其它入库单 / 其它出库单）。同「落真身四步」，见 docs/仓配模块开发规范.md。
   🔴 两张「其它出入库」共用 `EntryList.vue` 内核（in/out 两个方向），差异由 `direction` prop
      注入；本文件按路由登记两个薄壳组件 —— 因为 router 需要**真实组件**、`pages.js` 按路径登记。 */
const WhInboundList = () => import('../pages/wh/InboundList.vue')
const WhOutboundList = () => import('../pages/wh/OutboundList.vue')
const WhStocktake = () => import('../pages/wh/Stocktake.vue')
const WhStrategy = () => import('../pages/wh/Strategy.vue')
const WhOtherIn = () => import('../pages/wh/OtherIn.vue')
const WhOtherOut = () => import('../pages/wh/OtherOut.vue')
/* v465h（2026-10-11 仓配管理 P2）：库存作业 6 页落真身。
   只有 **4 个组件** —— 静态盘点整仓/部分共用 `StaticFreeze`（`scope` prop 区分），
   组合单/拆分单共用 `KitOrder`（`type` prop 区分）。理由见各文件头注释：
   同构两页拆成两个文件必然漂移。 */
const WhStocktakeDiff = () => import('../pages/wh/StocktakeDiff.vue')
const WhStaticFreeze = () => import('../pages/wh/StaticFreeze.vue')
const WhKitOrder = () => import('../pages/wh/KitOrder.vue')
const WhWastage = () => import('../pages/wh/Wastage.vue')
/* v465k（2026-10-12 仓配管理 P3）：配送作业 3 页落真身（**各一个组件**，无同构复用）。 */
const WhDeliveryOrder = () => import('../pages/wh/DeliveryOrder.vue')
const WhDriverBoard = () => import('../pages/wh/DriverBoard.vue')
const WhRouteSetup = () => import('../pages/wh/RouteSetup.vue')
const CronJobs = () => import('../pages/CronJobs.vue')
const RoleManage = () => import('../pages/RoleManage.vue')
const BidRadar = () => import('../pages/BidRadar.vue')
const AiHub = () => import('../pages/AiHub.vue')
const PriceChannels = () => import('../pages/PriceChannels.vue')
/* v392（2026-10-07）批次 5：进销存从「v380 单页脚手架」扩成 **1 容器 + 8 页**。
   🔴 拆开而不是塞进一个 8 段 v-if 的大页面：进销存是**一条链**
      （采购 → 入库 → 销售 → 出库 → 查库存），每段都有自己的列表/详情/表单，
      合在一起会变成第二个 Forecast.vue（1400 行）—— 改动面与回归面都失控。
   🔴 可见性**一点没变**：8 条子路由全部继承父级 `/inventory` 那一行
      （`constants/pages.js:359`，`module:'inventory'` + `ADMIN_ROLES` + `lock:true`）——
      `ruleFor()` 是「精确匹配 → 逐级去掉尾段再匹配」⇒ 只要父行不变，子页自动同门槛。
      **`pages.js` 一字不改**（这是本批的硬约束，见计划 §七 细节 3）。 */
const InventoryShell = () => import('../pages/inventory/InventoryShell.vue')
const InvWorkbench = () => import('../pages/inventory/InvWorkbench.vue')
const InvPurchaseList = () => import('../pages/inventory/InvPurchaseList.vue')
/* 🔴 v449：`InvPurchaseNew.vue` / `InvSaleNew.vue` 两条懒加载常量**已删除** ——
   拆分后没有任何路由指向它们（对照实验：产物 `dist-v449/assets/` 里已无
   `InvPurchaseNew-*.js` / `InvSaleNew-*.js`，证明它们本来就是死引用）。
   两个文件仍在磁盘上（是 7 个新页面「逐段搬移」的溯源基准），**待归档**；
   但**不要**再把它们挂回路由 —— 那会让同一个业务出现两套建单页，差异会立刻漂移。 */
const InvPurchaseDetail = () => import('../pages/inventory/InvPurchaseDetail.vue')
const InvSaleList = () => import('../pages/inventory/InvSaleList.vue')
/* v449+：调拨单**列表页**（真双仓 `transfer_orders`）。此前「调拨单」侧栏入口指向
   `/inventory/sale?type=transfer`，那张出来的是 `sale_orders` 里 `order_type='transfer'`
   的**舟谱导入单**（单仓、与真实调拨不是同一批数据）—— 一个指向错误数据集的假入口。
   现在落到本组件，数据源 `GET /api/psi/transfer-orders`（与建单页同源，归 `inventory` 模块）。 */
const InvTransferList = () => import('../pages/inventory/InvTransferList.vue')
/* ---- v449（2026-10-11）：进销存建单页拆成**7 个独立页面** -------------------
   🔴 全部走 `new/` 目录下的薄页面 + 3 个配置化内核（见 `pages/inventory/new/docTypes.js`）。
      这里只登记路由；**差异（标题 / 字段 / 端点 / 列表落点）全在 `docTypes.js`**，
      不在本文件里写第二份。
   ⚠️ 拆分前的两个入口 `/inventory/sale/new` 与 `/inventory/purchase/new?kind=…`
      **保留**（`redirect` / `beforeEnter`）—— 书签、列表页按钮、工作台按钮都还指着它们，
      删掉就是一堆静默 404。 */
const PurchaseOrderNew = () => import('../pages/inventory/new/PurchaseOrderNew.vue')
const PurchaseReturnNew = () => import('../pages/inventory/new/PurchaseReturnNew.vue')
const SelfPickupOrderNew = () => import('../pages/inventory/new/SelfPickupOrderNew.vue')
const SelfPickupReturnNew = () => import('../pages/inventory/new/SelfPickupReturnNew.vue')
const VehicleSaleOrderNew = () => import('../pages/inventory/new/VehicleSaleOrderNew.vue')
const VehicleSaleReturnNew = () => import('../pages/inventory/new/VehicleSaleReturnNew.vue')
const TransferOrderNew = () => import('../pages/inventory/new/TransferOrderNew.vue')
const InvSaleDetail = () => import('../pages/inventory/InvSaleDetail.vue')
const InvStock = () => import('../pages/inventory/InvStock.vue')
/* v465d（2026-10-11 资金管理）：7 张报表页 + 参数化单据引擎（覆盖 17 类资金单据）。
   🔴 单据引擎 FundsDoc 由 `meta.docType` 驱动（一处组件、28 页复用）；
      报表页由 `meta.partyType` / `meta.costMode` 驱动。差异全在路由 meta，不在本文件写第二份。
   🔴 可见性唯一真源在 `pages.js::PAGE_RULES`（窄名单 老板/管理员/会计），这里只负责路由可达。 */
const FundsDoc = () => import('../pages/funds/FundsDoc.vue')
const FundsStatement = () => import('../pages/funds/FundsStatement.vue')
const FundsBalance = () => import('../pages/funds/FundsBalance.vue')
const FundsFlow = () => import('../pages/funds/FundsFlow.vue')
const FundsBankReconcile = () => import('../pages/funds/FundsBankReconcile.vue')
const FundsStaffDebt = () => import('../pages/funds/FundsStaffDebt.vue')
const FundsCost = () => import('../pages/funds/FundsCost.vue')
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
        // 🔴 v390（2026-10-07）：`meta.title` 与 `pages.js::PAGE_RULES['/forecast'].title`、
        //    `Shell.vue::NAV` 显示名**必须逐字一致** —— 它就是路由守卫那句
        //    「你没有访问「xxx」的权限」的文案，不一致就等于「提示比界面早一代」。
        { path: 'forecast', component: Forecast, meta: { title: '预报订单管理' } },
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
            // v387（2026-10-06）批次 1.2：供应商档案 = 第 7 个页签。
            //   与 warehouses 同构：**必须**在这里登记，否则刷新 `/archive/suppliers`
            //   会静默落回「员工档案」页签（URL 与内容对不上，见 Archive.vue::tabFromPath）。
            //   继承父级 `/archive` 的可见性规则（`module:'data'` + BIZ_ROLES）；
            //   `pages.js` 里另有一条同名精确登记行（那是 `canSee` 的**唯一真源**，
            //   这里只负责路由可达 —— 两处都写是刻意的，缺任一处就是"假入口"或"假封锁"）。
            { path: 'suppliers', component: Archive, meta: { title: '档案管理' } },
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
        // v395：`/print?tab=templates|settings|logs` —— 三个入口共用本页（页签进 URL），
        //   与 `/forecast` 的页签同构 ⇒ 不为每个入口造页面。可见性见 `pages.js` 的 `/print` 行。
        { path: 'print', component: Print, meta: { title: '打印' } },
        { path: 'bid-radar', component: BidRadar, meta: { title: '招投标雷达' } },
        // v380（2026-10-06）：进销存 —— 角色门禁在 `constants/pages.js` 的 `/inventory` 行
        //   （ADMIN_ROLES + lock），这里只登记路由；深链由守卫按同一份表拦。
        // v392（2026-10-07）批次 5：扩成 1 容器 + 8 子路由（容器 = 页内二级导航）。
        //   🔴 `path: ''`（空串）的「工作台」是必需的：没有它，访问 `/inventory` 时
        //      父级匹配到了却**没有子记录可渲染** ⇒ 页签条在、内容空白。
        //   🔴 **不要**给父级加 `redirect: '/inventory'` —— 那是自指重定向（`/inventory` → `/inventory`），
        //      vue-router 会报重定向循环。空串子路由已经承担了「索引页」的角色。
        //   🔴 `purchase/new` 必须排在 `purchase/:id` **之前**：vue-router 按声明顺序匹配，
        //      反序会让「新建」被 `:id` 吃掉（`id='new'` ⇒ 详情页 404 文案）。
        {
          path: 'inventory',
          component: InventoryShell,
          children: [
            { path: '', component: InvWorkbench, meta: { title: '进销存' } },
            { path: 'purchase',      component: InvPurchaseList,   meta: { title: '采购单' } },
            /* v449：`purchase/new` **仍然是采购订单**的路径（不挪），但多了一层
               `beforeEnter` 把拆分前的 `?kind=return` 送到新的采购退货单页面。
               🔴 为什么用 `beforeEnter` 而不是 `redirect`：`redirect` 是**无条件**的，
                  用在这里会把「采购订单」本身也一起重定向走（页面直接打不开）。
                  `beforeEnter` 返回一个 location = 改道；返回 `undefined` = 照常进入。
                  这是**条件重定向**唯一干净的写法。 */
            {
              path: 'purchase/new',
              component: PurchaseOrderNew,
              meta: { title: '新建采购单' },
              beforeEnter: (to) => {
                const k = String((to.query && to.query.kind) || '')
                if (k && k !== 'order') {
                  /* 🔴 其余 query（尤其 `from_po`）**原样带走**：采购单详情页的
                     「转单为 → 采购退货」是 `/purchase/new?kind=return&from_po=12`，
                     丢了 `from_po` 那张单的可退预览就没了（退化成"自己填"）。
                     带上的 `kind` 要去掉 —— 新页面不再认它，留着会让 URL 撒谎。 */
                  const q = { ...(to.query || {}) }
                  delete q.kind
                  return { path: legacyPurchasePath(k), query: q }
                }
              },
            },
            { path: 'purchase/return/new', component: PurchaseReturnNew, meta: { title: '新建采购退货单' } },
            { path: 'purchase/:id',  component: InvPurchaseDetail, meta: { title: '采购单详情' } },
            { path: 'sale',          component: InvSaleList,       meta: { title: '销售单' } },
            /* v449：拆分前那条共用路径**只做重定向**，不再承载页面。
               🔴 它**必须**留：`InvSaleList.vue` 的「新建销售单」按钮、空态按钮、
                  进销存工作台按钮、以及用户书签都还指着 `/inventory/sale/new?...`。
                  `redirect` 无条件改道正合适（这条路径本来就没有自己的内容）。
               🔴 未知 `type` / 调拨退单的兜底在 `legacySalePath()` 里（那条函数
                  同时负责打警告）—— 不要在这里再写一遍分支。 */
            {
              path: 'sale/new',
              redirect: (to) => ({
                path: legacySalePath(to.query && to.query.type, to.query && to.query.kind),
                /* 🔴 `query: {}` **不能省**（v449 实测）：vue-router 4 在 redirect 返回的
                   location **未指定 `query`** 时会**继承原 query** ⇒ 改道后 URL 停在
                   `.../vehicle/return/new?type=vehicle_sale&kind=return` —— 目标页一个字都不读它，
                   纯粹是「URL 在撒谎」（且与上面 `purchase/new` 那条 `delete q.kind` 的口径不一致）。
                   两个销售内核都不用 query ⇒ 这里整体丢掉是安全的（无 `copy` / `edit` / `from_so`
                   这类需要透传的键；销售侧本来也没有「从原单转退货」的通道，见 docTypes.js 头注）。 */
                query: {},
              }),
            },
            /* 静态段必须排在 `sale/:id` **之前**：vue-router 4 虽然按
               「静态 > 参数」打分，但把静态段写在前面能让下面这四条一眼看清归属。 */
            { path: 'sale/self-pickup/new',        component: SelfPickupOrderNew,  meta: { title: '新建自提订单' } },
            { path: 'sale/self-pickup/return/new', component: SelfPickupReturnNew, meta: { title: '新建自提退单' } },
            { path: 'sale/vehicle/new',            component: VehicleSaleOrderNew, meta: { title: '新建车销订单' } },
            { path: 'sale/vehicle/return/new',     component: VehicleSaleReturnNew, meta: { title: '新建车销退单' } },
            /* v449+：调拨单**列表页**（真双仓 `transfer_orders`）。放在 `transfer/new` 之前；
               静态段顺序无关紧要（vue-router 4 按特异性排序），但同族放一起易读。
               🔴 不要把这条写成 `transfer/:id` —— 调拨没有详情页，写 `:id` 会让
                  `transfer/new` 被当成 `transfer/<id=new>` 吃掉（详情页 404 文案会冒出来）。 */
            { path: 'transfer',     component: InvTransferList,   meta: { title: '调拨单' } },
            { path: 'transfer/new', component: TransferOrderNew,  meta: { title: '新建调拨单' } },
            { path: 'sale/:id',      component: InvSaleDetail,     meta: { title: '销售单详情' } },
            { path: 'stock',         component: InvStock,          meta: { title: '库存查询' } }
          ]
        },

        /* v465c（2026-10-11 仓配管理 P0）：**库存查询三页落真身**。
           🔴 必须排在下方 `PLACEHOLDER_PAGES.map(...)` **之前**（相对路径 + 静态段在前）——
              这三条已从 `PLACEHOLDER_PAGES` 移出，此处是它们唯一的真实路由；
              `pages.js::PAGE_RULES` 另有正式登记行（**两处都要写**：缺路由 = 假封锁，
              缺登记 = 假入口，见 docs/仓配模块开发规范.md 的「落真身四步」）。 */
        { path: 'wh/expiry-report', component: WhExpiryReport, meta: { title: '效期预警表' } },
        { path: 'wh/vehicle-stock', component: WhVehicleStock, meta: { title: '车辆库存查询' } },
        { path: 'wh/stock-alert',   component: WhStockAlert,   meta: { title: '库存预警' } },

        /* v465e（2026-10-11 仓配管理 P1）：**仓库作业 6 页落真身**。
           🔴 必须排在下方 `PLACEHOLDER_PAGES.map(...)` **之前**（相对路径 + 静态段在前）——
              这 6 条已从 `PLACEHOLDER_PAGES` 移出，此处是它们唯一的真实路由；
              `pages.js::PAGE_RULES` 另有正式登记行（**两处都要写**：缺路由 = 假封锁，
              缺登记 = 假入口）。`meta.title` 与 pages.js 的 title、Shell.vue 的 name
              必须逐字一致（它就是路由守卫「你没有访问「xxx」的权限」的文案）。 */
        { path: 'wh/inbound',     component: WhInboundList,  meta: { title: '入库单' } },
        { path: 'wh/outbound',    component: WhOutboundList, meta: { title: '出库单' } },
        { path: 'wh/stocktake',   component: WhStocktake,    meta: { title: '盘点单' } },
        { path: 'wh/strategy',    component: WhStrategy,     meta: { title: '出入库策略' } },
        { path: 'wh/other-in',    component: WhOtherIn,      meta: { title: '其它入库单' } },
        { path: 'wh/other-out',   component: WhOtherOut,     meta: { title: '其它出库单' } },

        /* v465h（2026-10-11 仓配管理 P2）：**库存作业 6 页落真身**。
           🔴 同样必须排在下方 `PLACEHOLDER_PAGES.map(...)` **之前**（相对路径 + 静态段在前）——
              这 6 条已从 `PLACEHOLDER_PAGES` 移出，此处是它们唯一的真实路由；
              `pages.js::PAGE_RULES` 另有正式登记行（**两处都要写**：缺路由 = 假封锁，
              缺登记 = 假入口，见 docs/仓配模块开发规范.md「落真身四步」）。
           🔴 4 个组件挂 6 条路由：`props` 用**对象模式**注入，组件内不读 `$route`
              （读 route 会让两个路由的组件实例行为耦合到 URL，写成 prop 后
               `StaticFreeze` / `KitOrder` 自身不知道有几个入口，也不必知道）。
           🔴 `meta.title` 与 `pages.js` 的 title、`Shell.vue` 的 name **必须逐字一致**
              （它就是路由守卫「你没有访问「xxx」的权限」的文案）。 */
        { path: 'wh/stocktake-diff', component: WhStocktakeDiff, meta: { title: '盘点差异单' } },
        { path: 'wh/stocktake-full', component: WhStaticFreeze,  props: { scope: 'full' },
          meta: { title: '静态盘点单（整仓）' } },
        { path: 'wh/stocktake-part', component: WhStaticFreeze,  props: { scope: 'partial' },
          meta: { title: '静态盘点单（部分）' } },
        { path: 'wh/pnl',            component: WhWastage,       meta: { title: '损益单' } },
        { path: 'wh/combo',          component: WhKitOrder,      props: { type: 'assemble' },
          meta: { title: '组合单' } },
        { path: 'wh/split',          component: WhKitOrder,      props: { type: 'disassemble' },
          meta: { title: '拆分单' } },

        /* v465k（2026-10-12 仓配管理 P3）：**配送作业 3 页落真身**（各组最后一页 ⇒ 仓配 20 项全数落真身）。
           🔴 同样必须排在下方 `PLACEHOLDER_PAGES.map(...)` **之前**；三处都要写
              （router / `pages.js::PAGE_RULES` / 从 `PLACEHOLDER_PAGES` 移出），缺一即假入口或假封锁。
           🔴 后端**零改动** —— 8 个端点全是既有的（见 `api/wh.js` P3 段注释）。
              ⚠️ 上一轮盘点说「P3 后端不存在、要按新建估工」是**错的**，根因写在规范 §8.K。 */
        { path: 'wh/delivery',     component: WhDeliveryOrder, meta: { title: '配送单' } },
        { path: 'wh/driver-board', component: WhDriverBoard,   meta: { title: '司机任务看板' } },
        { path: 'wh/route-setup',  component: WhRouteSetup,    meta: { title: '线路设置' } },

        /* v465d（2026-10-11 资金管理）：**全部 28 页落真身**。
           🔴 必须排在下方 `PLACEHOLDER_PAGES.map(...)` **之前**（相对路径 + 静态段在前）——
              这 28 条已从 `PLACEHOLDER_PAGES` 移出，此处是它们唯一的真实路由；
              `pages.js::PAGE_RULES` 另有正式登记行（**两处都要写**：缺路由 = 假封锁，
              缺登记 = 假入口，见 docs/资金管理模块开发规范.md 的「落真身四步」）。
           🔴 17 张单据页共用 `FundsDoc` 引擎，差异只由 `meta.docType` 注入；
              报表页由 `meta.partyType` / `meta.costMode` 区分。
           🔴 `meta.title` 与 `pages.js` 的 title、`Shell.vue` 的 name **必须逐字一致**
              （它就是路由守卫「你没有访问「xxx」的权限」的文案，不一致 = 提示比界面早一代）。 */
        { path: 'funds/receipt',            component: FundsDoc,       meta: { title: '收款单',     docType: 'receipt' } },
        { path: 'funds/customer-fee',       component: FundsDoc,       meta: { title: '客户费用单', docType: 'customer-fee' } },
        { path: 'funds/advance-receipt',    component: FundsDoc,       meta: { title: '预收款单',   docType: 'advance-receipt' } },
        { path: 'funds/writeoff',           component: FundsDoc,       meta: { title: '核销单',     docType: 'writeoff' } },
        { path: 'funds/sales-settle',       component: FundsDoc,       meta: { title: '销货结算单', docType: 'sales-settle' } },
        { path: 'funds/return-settle',      component: FundsDoc,       meta: { title: '退货结算单', docType: 'return-settle' } },
        { path: 'funds/other-receivable',   component: FundsDoc,       meta: { title: '其他应收单', docType: 'other-receivable' } },
        { path: 'funds/payment',            component: FundsDoc,       meta: { title: '付款单',     docType: 'payment' } },
        { path: 'funds/supplier-fee',       component: FundsDoc,       meta: { title: '供应商费用单', docType: 'supplier-fee' } },
        { path: 'funds/advance-payment',    component: FundsDoc,       meta: { title: '预付款单',   docType: 'advance-payment' } },
        { path: 'funds/purchase-settle',    component: FundsDoc,       meta: { title: '采购结算单', docType: 'purchase-settle' } },
        { path: 'funds/internal-fee',       component: FundsDoc,       meta: { title: '内部费用单', docType: 'internal-fee' } },
        { path: 'funds/internal-income',    component: FundsDoc,       meta: { title: '内部收入单', docType: 'internal-income' } },
        { path: 'funds/transfer',           component: FundsDoc,       meta: { title: '资金调拨单', docType: 'transfer' } },
        { path: 'funds/in-cost',            component: FundsDoc,       meta: { title: '入库核算单', docType: 'in-cost' } },
        { path: 'funds/out-cost',           component: FundsDoc,       meta: { title: '出库核算单', docType: 'out-cost' } },
        { path: 'funds/cost-adjust',        component: FundsDoc,       meta: { title: '成本调价单', docType: 'cost-adjust' } },
        { path: 'funds/customer-statement', component: FundsStatement, meta: { title: '客户对账单',     partyType: 'customer' } },
        { path: 'funds/supplier-stmt',      component: FundsStatement, meta: { title: '供应商对账单',   partyType: 'supplier' } },
        { path: 'funds/supplier-stmt-detail', component: FundsStatement, meta: { title: '供应商对账明细', partyType: 'supplier' } },
        { path: 'funds/balance',            component: FundsBalance,   meta: { title: '资金余额表' } },
        { path: 'funds/flow',              component: FundsFlow,      meta: { title: '资金流水账' } },
        { path: 'funds/bank-reconcile',    component: FundsBankReconcile, meta: { title: '银行流水对账' } },
        { path: 'funds/staff-debt',        component: FundsStaffDebt, meta: { title: '员工欠款' } },
        { path: 'funds/cost-query',        component: FundsCost,      meta: { title: '库存成本查询', costMode: 'query' } },
        { path: 'funds/cost-summary',      component: FundsCost,      meta: { title: '库存成本汇总', costMode: 'summary' } },
        { path: 'funds/qty-cost',          component: FundsCost,      meta: { title: '数量成本价',   costMode: 'qty' } },
        { path: 'funds/cost-abnormal',     component: FundsCost,      meta: { title: '成本异常调整', costMode: 'abnormal' } },

        /* v465（2026-10-11）：四新区（仓配管理 / 资金管理 / 数据报表 / 市场营销）的
           **占位页路由** —— 按 `pages.js::PLACEHOLDER_PAGES` 数据驱动批量挂载，
           全部指向共享骨架 `Placeholder.vue`（「开发中」卡，不写业务数据）。
           🔴 可见性的唯一真源在 `pages.js::PAGE_RULES`（**v472 起四区一律 `BOSS_ROLES + lock`**：
              开发期只给老板；此前是「`/funds/*` 窄名单、其余 BIZ_ROLES」），
              这里只负责路由可达 —— 两处都写是刻意的（与本仓 `/archive/*` 同一纪律：
              缺登记行 = 假入口，缺路由 = 假封锁）。
           🔴 某页落真身时：从 `PLACEHOLDER_PAGES` 移出 → 在 `PAGE_RULES` 写正式行 →
              这里换成真实组件（`pages.js` 合并循环会覆盖同键行，别两头都留）。
           ⚠️ `meta.area` 仅用于占位页副标题「XX · 规划能力」。 */
        ...PLACEHOLDER_PAGES.map(p => ({
          path: p.path.slice(1),                    // children 用相对路径：'/wh/inbound' → 'wh/inbound'
          component: Placeholder,
          meta: { title: p.title, area: p.area }
        }))
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
