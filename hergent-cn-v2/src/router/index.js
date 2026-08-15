/* ============================================================
   router.js — 蓝图副驾路由（hash 模式，无需服务端配置）
   ============================================================ */
import { createRouter, createWebHashHistory } from 'vue-router'

import Login from '../pages/Login.vue'
import Shell from '../components/Shell.vue'
import Workbench from '../pages/Workbench.vue'
import Forecast from '../pages/Forecast.vue'
import Rebate from '../pages/Rebate.vue'
import Dashboard from '../pages/Dashboard.vue'
import ConnectCenter from '../pages/ConnectCenter.vue'
import Reconciliation from '../pages/Reconciliation.vue'
import LossWorkflow from '../pages/LossWorkflow.vue'
import PayrollWorkflow from '../pages/PayrollWorkflow.vue'
import Settings from '../pages/Settings.vue'
import CronJobs from '../pages/CronJobs.vue'

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
        { path: 'rebate', component: Rebate, meta: { title: '目标与返利政策' } },
        { path: 'dashboard', component: Dashboard, meta: { title: '数据看板' } },
        { path: 'connect', component: ConnectCenter, meta: { title: '连接中心' } },
        { path: 'reconciliation', component: Reconciliation, meta: { title: '对账工作流' } },
        { path: 'loss', component: LossWorkflow, meta: { title: '货损计算工作流' } },
        { path: 'payroll', component: PayrollWorkflow, meta: { title: '算工资工作流' } },
        { path: 'cron', component: CronJobs, meta: { title: '定时任务' } },
        { path: 'settings', component: Settings, meta: { title: '设置' } }
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
