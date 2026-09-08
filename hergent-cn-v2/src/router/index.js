/* ============================================================
   router.js — 蓝图副驾路由（hash 模式，无需服务端配置）
   全部页面懒加载（code-splitting）：首屏只加载登录/外壳必需代码，
   其余页面（含 1401 行的 Forecast、1239 行的 ConnectCenter）按需加载，
   显著降低首屏 JS 体积（P0 评审清单）。
   ============================================================ */
import { createRouter, createWebHashHistory } from 'vue-router'

const Login = () => import('../pages/Login.vue')
const Shell = () => import('../components/Shell.vue')
const Workbench = () => import('../pages/Workbench.vue')
const Forecast = () => import('../pages/Forecast.vue')
const Rebate = () => import('../pages/Rebate.vue')
const Dashboard = () => import('../pages/Dashboard.vue')
const ConnectCenter = () => import('../pages/ConnectCenter.vue')
const Reconciliation = () => import('../pages/Reconciliation.vue')
const LossWorkflow = () => import('../pages/LossWorkflow.vue')
const PayrollWorkflow = () => import('../pages/PayrollWorkflow.vue')
const DataFill = () => import('../pages/DataFill.vue')
const EmployeeArchive = () => import('../pages/EmployeeArchive.vue')
const CustomerArchive = () => import('../pages/CustomerArchive.vue')
const Archive = () => import('../pages/Archive.vue')
const Settings = () => import('../pages/Settings.vue')
const CronJobs = () => import('../pages/CronJobs.vue')
const RoleManage = () => import('../pages/RoleManage.vue')
const BidRadar = () => import('../pages/BidRadar.vue')
const AiHub = () => import('../pages/AiHub.vue')

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
        { path: 'dashboard', component: Dashboard, meta: { title: '经营趋势' } },
        { path: 'connect', component: ConnectCenter, meta: { title: '能力中心' } },
        { path: 'roles', component: RoleManage, meta: { title: 'AI 团队' } },
        { path: 'reconciliation', component: Reconciliation, meta: { title: '对账工作流' } },
        { path: 'loss', component: LossWorkflow, meta: { title: '货损计算工作流' } },
        { path: 'payroll', component: PayrollWorkflow, meta: { title: '算工资工作流' } },
        { path: 'data-fill', component: DataFill, meta: { title: '库存效期补录' } },
        { path: 'archive', redirect: '/archive/employees' },
        { path: 'archive/employees', component: Archive, meta: { title: '档案管理' } },
        { path: 'archive/customers', component: Archive, meta: { title: '档案管理' } },
        { path: 'archive/brands', component: Archive, meta: { title: '档案管理' } },
        { path: 'archive/products', component: Archive, meta: { title: '档案管理' } },
        { path: 'cron', component: CronJobs, meta: { title: '定时任务' } },
        { path: 'ai-hub', component: AiHub, meta: { title: 'AI 中心' } },
        { path: 'settings', component: Settings, meta: { title: '设置' } },
        { path: 'bid-radar', component: BidRadar, meta: { title: '招投标雷达' } }
      ]
    }
  ]
})

router.beforeEach((to) => {
  const token = localStorage.getItem('hergent_v2_token')
  if (!token && to.path !== '/login') return '/login'
  if (token && to.path === '/login') return '/'
  return true
})
