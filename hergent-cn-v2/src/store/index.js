/* ============================================================
   store.js — 极简响应式状态（Vue reactive）
   分区：ui / user / chat，避免扁平互相污染（蓝图 4.3）
   ============================================================ */
import { reactive } from 'vue'

export const store = reactive({
  ui: {
    sidebarOpen: true,     // 桌面侧栏
    theme: 'light',
    mobileDrawer: false,   // 手机“更多”抽屉
    copilotOpen: false,    // AI 副驾全局抽屉
    toast: null
  },
  user: {
    name: '',
    role: ''
  },
  chat: {
    messages: [],          // {role:'user'|'assistant', content}
    streaming: false,
    error: ''
  }
})

export function toast(msg, type = 'info') {
  store.ui.toast = { msg, type, id: Date.now() }
  setTimeout(() => { store.ui.toast = null }, 3000)
}

export function setTheme(t) {
  store.ui.theme = t
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(t)
  localStorage.setItem('hergent_theme', t)
}
