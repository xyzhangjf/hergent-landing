<template>
  <router-view v-if="isLogin" />
  <div class="layout" v-else>
    <aside class="sidebar">
      <div class="brand">
        <img class="logo" :src="brandIcon" alt="Hergent" />
        <span>Hergent 管理后台</span>
      </div>
      <nav class="nav">
        <div class="nav-group-title">运营总览</div>
        <router-link
          v-for="item in mainNav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
        >
          <Icon :name="item.icon" />
          <span>{{ item.label }}</span>
        </router-link>
        <div class="nav-group-title">治理</div>
        <router-link
          v-for="item in govNav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
        >
          <Icon :name="item.icon" />
          <span>{{ item.label }}</span>
          <span v-if="item.to === '/registrations' && regCount > 0" class="badge">{{ regCount }}</span>
        </router-link>
      </nav>
      <div class="side-foot">Hergent ERP · 租户管理后台<br />v1.0 · 独立子站</div>
    </aside>

    <div class="content">
      <header class="topbar">
        <span class="title">{{ title }}</span>
        <span class="subtitle">{{ subtitle }}</span>
        <span class="spacer"></span>
        <div class="user">
          <span class="avatar">{{ initial }}</span>
          <span>{{ auth.username || '—' }}</span>
          <button class="btn sm ghost" @click="onLogout">退出</button>
        </div>
      </header>
      <main class="content-scroll">
        <router-view />
      </main>
    </div>
  </div>
  <ToastHost />
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './store/auth'
import ToastHost from './components/ToastHost.vue'
import Icon from './components/Icon.vue'
import { regApi } from './api/client'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const isLogin = computed(() => route.name === 'login')

const brandIcon = import.meta.env.BASE_URL + 'icons/brand-64.png'

const mainNav = [
  { to: '/', label: '平台总览', icon: 'dashboard' },
  { to: '/tenants', label: '租户管理', icon: 'building' },
]
const govNav = [
  { to: '/invite-codes', label: '邀请码管理', icon: 'ticket' },
  { to: '/registrations', label: '注册流水', icon: 'clipboard' },
  { to: '/audit-logs', label: '操作审计', icon: 'history' },
  { to: '/users', label: '平台用户', icon: 'users' },
]

const title = computed(() => route.meta.title || 'Hergent 管理后台')
const subtitle = computed(() => {
  if (route.name === 'tenant-detail') return '租户详情与用量'
  return ''
})
const initial = computed(() => (auth.username ? auth.username.charAt(0).toUpperCase() : 'A'))

// 侧栏待办徽标：注册流水条数（增强信息，拉取失败静默降级为不显示）
const regCount = ref(0)
async function loadRegCount() {
  try {
    const d = await regApi.list()
    regCount.value = ((d && d.registrations) || []).length
  } catch (e) {
    regCount.value = 0
  }
}
// App 在登录后不会重新挂载，因此用 watch 覆盖「首次进入已是后台」与「登录成功后切入」两种情况
watch(isLogin, (v) => { if (!v) loadRegCount() }, { immediate: true })

function isActive(to) {
  if (to === '/') return route.path === '/' || route.path === ''
  return route.path === to || route.path.startsWith(to + '/')
}
function onLogout() {
  auth.logout()
  router.push('/login')
}
</script>
