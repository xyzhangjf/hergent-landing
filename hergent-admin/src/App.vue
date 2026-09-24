<template>
  <router-view v-if="isLogin" />
  <div class="layout" v-else>
    <div v-if="menuOpen" class="sidebar-backdrop" @click="menuOpen = false" aria-hidden="true"></div>
    <aside class="sidebar" :class="{ open: menuOpen }">
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
          :aria-current="isActive(item.to) ? 'page' : undefined"
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
          :aria-current="isActive(item.to) ? 'page' : undefined"
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
        <button type="button" class="menu-btn" aria-label="打开导航菜单" @click="menuOpen = true">
          <Icon name="menu" :size="18" />
        </button>
        <span class="title">{{ title }}</span>
        <span class="subtitle">{{ subtitle }}</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm palette-trigger" aria-label="打开命令面板" @click="paletteOpen = true">
          <Icon name="search" :size="14" />
          <span class="palette-hint">搜索 / 命令</span>
          <span class="kbd">{{ modKey }}K</span>
        </button>
        <button
          type="button" class="btn sm icon-only"
          :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          :title="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          @click="toggleTheme"
        >
          <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="15" />
        </button>
        <button
          type="button" class="btn sm icon-only"
          :aria-label="density === 'compact' ? '切换到宽松密度' : '切换到紧凑密度'"
          :title="density === 'compact' ? '切换到宽松密度' : '切换到紧凑密度'"
          @click="toggleDensity"
        >
          <Icon name="rows" :size="15" />
        </button>
        <div class="user">
          <span class="avatar">{{ initial }}</span>
          <span>{{ auth.username || '—' }}</span>
          <button class="btn sm ghost" @click="onLogout">退出</button>
        </div>
      </header>
      <main class="content-scroll">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
  <CommandPalette :show="paletteOpen" @close="paletteOpen = false" @run="onPaletteRun" />
  <ToastHost />
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './store/auth'
import ToastHost from './components/ToastHost.vue'
import CommandPalette from './components/CommandPalette.vue'
import Icon from './components/Icon.vue'
import { regApi } from './api/client'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const isLogin = computed(() => route.name === 'login')

// 移动端侧栏抽屉开关（≤768px 生效；路由切换后自动收起）
const menuOpen = ref(false)
watch(() => route.path, () => { menuOpen.value = false })

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

// ---------- 主题 / 密度（持久化到 localStorage，首次跟随系统偏好） ----------
const THEME_KEY = 'hergent_admin_theme'
const DENSITY_KEY = 'hergent_admin_density'
const prefersDark = typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-color-scheme: dark)').matches
const theme = ref(localStorage.getItem(THEME_KEY) || (prefersDark ? 'dark' : 'light'))
const density = ref(localStorage.getItem(DENSITY_KEY) || 'comfortable')

function applyTheme() { document.documentElement.setAttribute('data-theme', theme.value) }
function applyDensity() { document.documentElement.setAttribute('data-density', density.value) }
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  localStorage.setItem(THEME_KEY, theme.value)
  applyTheme()
}
function toggleDensity() {
  density.value = density.value === 'compact' ? 'comfortable' : 'compact'
  localStorage.setItem(DENSITY_KEY, density.value)
  applyDensity()
}
applyTheme()
applyDensity()

// ---------- 命令面板 + 全局快捷键 ----------
const paletteOpen = ref(false)
const modKey = computed(() => (/mac/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+'))

function onPaletteRun(it) {
  if (it.action === 'theme') { toggleTheme(); return }
  if (it.action === 'density') { toggleDensity(); return }
  if (it.to) router.push(it.to)
}

let gPending = false
const GOTO = { o: '/', t: '/tenants', i: '/invite-codes', r: '/registrations', a: '/audit-logs', u: '/users' }

function onKey(e) {
  if (isLogin.value) return
  // ⌘K / Ctrl+K —— 任何位置都可唤起（含输入框内）
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
    return
  }
  const tag = (e.target && e.target.tagName) || ''
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    || (e.target && e.target.isContentEditable)
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return
  // g 前缀跳转：g 然后 o/t/i/r/a/u（1.2s 内有效）
  if (e.key === 'g') { gPending = true; setTimeout(() => { gPending = false }, 1200); return }
  if (gPending) {
    const dest = GOTO[String(e.key).toLowerCase()]
    gPending = false
    if (dest) { e.preventDefault(); router.push(dest) }
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// 侧栏待办徽标：注册流水条数（只取 1 条 + total，避免为拿一个数字拉全量）
const regCount = ref(0)
async function loadRegCount() {
  try {
    const d = await regApi.list({ limit: 1 })
    regCount.value = (d && (d.total != null ? d.total : (d.registrations || []).length)) || 0
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

<style scoped>
.palette-trigger { gap: 8px; color: var(--text-2); }
.palette-trigger .kbd { margin-left: 2px; }
@media (max-width: 900px) {
  .palette-trigger .palette-hint { display: none; }
}
</style>
