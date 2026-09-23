import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../store/auth'

import Login from '../views/Login.vue'
import Overview from '../views/Overview.vue'
import Tenants from '../views/Tenants.vue'
import TenantDetail from '../views/TenantDetail.vue'
import InviteCodes from '../views/InviteCodes.vue'
import Registrations from '../views/Registrations.vue'
import Users from '../views/Users.vue'

const routes = [
  { path: '/login', name: 'login', component: Login, meta: { public: true } },
  { path: '/', name: 'overview', component: Overview, meta: { title: '平台总览' } },
  { path: '/tenants', name: 'tenants', component: Tenants, meta: { title: '租户管理' } },
  { path: '/tenants/:id', name: 'tenant-detail', component: TenantDetail, meta: { title: '租户详情' } },
  { path: '/invite-codes', name: 'invite-codes', component: InviteCodes, meta: { title: '邀请码管理' } },
  { path: '/registrations', name: 'registrations', component: Registrations, meta: { title: '注册流水' } },
  { path: '/users', name: 'users', component: Users, meta: { title: '平台用户' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (to.meta.public) return true
  // 首次进入时校验 token 是否有效 + 是否平台管理员
  if (!auth.checked) {
    const ok = await auth.verify()
    if (!ok) return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (!auth.isLoggedIn || !auth.platformAdmin) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
