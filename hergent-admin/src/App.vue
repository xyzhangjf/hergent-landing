<template>
  <router-view v-if="isLogin" />
  <ToastHost v-if="isLogin" />
  <div class="layout" v-else>
    <aside class="sidebar">
      <div class="brand">
        <span class="logo">H</span>
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
          <svg class="ico" viewBox="0 0 24 24" v-html="item.icon"></svg>
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
          <svg class="ico" viewBox="0 0 24 24" v-html="item.icon"></svg>
          <span>{{ item.label }}</span>
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
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './store/auth'
import ToastHost from './components/ToastHost.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const isLogin = computed(() => route.name === 'login')

const mainNav = [
  { to: '/', label: '平台总览', icon: '<path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z"/>' },
  { to: '/tenants', label: '租户管理', icon: '<path d="M3 21V7l9-4 9 4v14M9 21v-6h6v6"/>' },
]
const govNav = [
  { to: '/invite-codes', label: '邀请码管理', icon: '<path d="M4 7h16M4 12h16M4 17h10"/>' },
  { to: '/registrations', label: '注册审核', icon: '<path d="M9 11l3 3 8-8M3 5h18v14H3z"/>' },
  { to: '/users', label: '平台用户', icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 11l2 2 4-4"/>' },
]

const title = computed(() => route.meta.title || 'Hergent 管理后台')
const subtitle = computed(() => {
  if (route.name === 'tenant-detail') return '租户详情与用量'
  return ''
})
const initial = computed(() => (auth.username ? auth.username.charAt(0).toUpperCase() : 'A'))

function isActive(to) {
  if (to === '/') return route.path === '/' || route.path === ''
  return route.path === to || route.path.startsWith(to + '/')
}
function onLogout() {
  auth.logout()
  router.push('/login')
}
</script>
