/* ============================================================
   store.js — Pinia 全局状态（A5 迁移自 Vue reactive 单例）
   分区：ui / user / chat，避免扁平互相污染（蓝图 4.3）

   A5 说明：
   - 用 Pinia setup store 承载同一份状态，获得 devtools / 模块化 / SSR 安全。
   - 为向后兼容，仍导出 `store` 单例（指向 Pinia store 实例）与原有具名函数，
     现有 20+ 处 `store.ui.x` / `store.chat.x` 调用点无需改动。
   - demo 为 ref，`store.demo` 读写自动解包，行为与 reactive 一致。
   ============================================================ */
import { createPinia, defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { api, auth } from '../api/client'

/* Pinia 实例在模块级创建，main.js 复用同一实例 app.use(pinia)。
   这样 store/index.js 可在 createApp 之前被 import（setTheme 等）。 */
export const pinia = createPinia()

export const useAppStore = defineStore('app', () => {
  // ---- state ----
  const ui = reactive({
    sidebarOpen: true,     // 桌面侧栏
    theme: 'light',
    mobileDrawer: false,   // 手机"更多"抽屉
    copilotOpen: false,    // AI 副驾全局抽屉
    toast: null
  })
  const user = reactive({
    name: '',
    role: ''
  })
  const demo = ref(false)
  /* v206 (2026-09-19)：本账号在**当前租户**下的模块权限（如 payroll / hr / data…）。
     三条设计约束，缺一条就会做错事：
     ① `null` = **还不知道**（未登录 / 请求失败）⇒ `canModule()` 一律返回 true，
        即「不知道就不隐藏」。菜单隐藏只是体验优化，**权限边界永远在后端**；
        反过来写成 fail-closed，一次接口抖动就会把老板的菜单藏起来。
     ② 权限表已**按租户分叉**，故必须记住「这份权限属于哪个租户」（`permsTenant`），
        租户一变就重取 —— 否则切租户后会按上一个租户的权限显示菜单（串味）。
     ③ 只认后端 `/api/auth/permissions` 返回的模块名，**不另抄一份角色表**（那正是漂移源）。 */
  const perms = ref(null)
  const permsTenant = ref('')
  const chat = reactive({
    messages: [],          // {role:'user'|'assistant', content}
    streaming: false,
    error: '',
    sessions: [],          // 历史会话 [{id, title, messages, updated_at}]
    currentId: '',         // 当前会话 id（'' = 新对话）
    roles: [],             // AI 团队列表（来自 /api/ai/roles）
    currentRole: ''        // 当前团队 role_id（默认 copilot）
  })

  // ---- actions ----
  function toast(msg, type = 'info') {
    ui.toast = { msg, type, id: Date.now() }
    setTimeout(() => { ui.toast = null }, 3000)
  }

  function setTheme(t) {
    ui.theme = t
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(t)
    localStorage.setItem('hergent_theme', t)
  }

  /* ---- 模块权限：拉取 / 判定（v206）------------------------------------------
     调用点只需 `await store.loadPerms()`（幂等：同一租户只拉一次），
     再用 `store.canModule('payroll')` 决定入口是否渲染。 */
  async function loadPerms(force = false) {
    const tid = String(auth.tenant || '')
    if (!force && perms.value !== null && permsTenant.value === tid) return perms.value
    try {
      const d = await api('/api/auth/permissions')
      const list = Array.isArray(d && d.permissions) ? d.permissions : []
      perms.value = list
      permsTenant.value = tid
      const r = d && d.user && d.user.role
      if (r) user.role = r          // 顺带把角色落到 store（此前全仓无人赋值）
      if (d && d.user && !user.name) {
        user.name = d.user.display_name || d.user.username || user.name
      }
    } catch (e) {
      // 🔴 拉不到 ≠ 没权限。保持「未知」（fail-open），别把菜单错误地藏起来。
      perms.value = null
      permsTenant.value = ''
    }
    return perms.value
  }

  /** 该模块在当前租户下是否授权。未知（未加载/失败）⇒ true（不隐藏）。 */
  function canModule(m) {
    const p = perms.value
    if (!p) return true
    return p.indexOf('*') >= 0 || p.indexOf(m) >= 0
  }

  /* ---- AI 会话持久化 — localStorage 按会话分组，刷新不丢，可接着聊 ---- */
  const CHAT_KEY = 'hergent_chat_sessions_v1'

  function saveSessions() {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(chat.sessions.slice(0, 30)))
    } catch { /* 超限静默 */ }
  }

  function loadSessions() {
    try {
      const raw = localStorage.getItem(CHAT_KEY)
      if (raw) { chat.sessions = JSON.parse(raw); return }
    } catch { chat.sessions = [] }
    // 本地空 → 跨设备/清缓存后从服务端拉会话列表（第三期 P1-③）
    loadSessionsFromServer()
  }

  /* 服务端会话同步（第三期 P1-③）：本地优先，服务端兜底 + 双写。
     静默失败，绝不因网络/未登录干扰副驾本地使用。 */
  function syncSessionToServer(s) {
    if (!s || !s.id) return
    try {
      api('/api/ai/sessions', {
        method: 'POST', silent401: true,
        body: { session_id: s.id, title: s.title || '', messages: s.messages || [] }
      }).catch(() => {})
    } catch (_) {}
  }

  async function loadSessionsFromServer() {
    try {
      const d = await api('/api/ai/sessions', { silent401: true })
      const list = d && d.sessions
      if (Array.isArray(list) && list.length) {
        chat.sessions = list.map(s => ({
          id: s.session_id, title: s.title || '', messages: [], updated_at: s.updated_at || ''
        }))
      }
    } catch (_) {}
  }

  function saveCurrentSession() {
    const msgs = chat.messages.filter(m => m.content)
    if (!msgs.length) return
    const now = Date.now()
    if (chat.currentId) {
      const s = chat.sessions.find(x => x.id === chat.currentId)
      if (s) {
        s.messages = msgs
        s.updated_at = now
      }
    } else {
      chat.currentId = 's' + now
      chat.sessions.unshift({
        id: chat.currentId,
        title: msgs[0].content.slice(0, 24) + (msgs[0].content.length > 24 ? '…' : ''),
        messages: msgs,
        updated_at: now
      })
    }
    saveSessions()
    syncSessionToServer(chat.sessions.find(x => x.id === chat.currentId))
  }

  function newChatSession() {
    saveCurrentSession()
    chat.messages = []
    chat.currentId = ''
    chat.error = ''
  }

  function openChatSession(id) {
    saveCurrentSession()
    const s = chat.sessions.find(x => x.id === id)
    if (!s) return
    chat.currentId = id
    chat.error = ''
    if (s.messages && s.messages.length) {
      chat.messages = s.messages.map(m => ({ ...m }))
    } else {
      // 服务端会话（本地无全文，如换设备）→ 拉完整 messages
      chat.messages = []
      try {
        api(`/api/ai/sessions/${id}`, { silent401: true }).then(d => {
          const msgs = d && d.session && d.session.messages
          if (Array.isArray(msgs)) {
            chat.messages = msgs.map(m => ({ ...m }))
            s.messages = msgs
          }
        }).catch(() => {})
      } catch (_) {}
    }
  }

  function deleteChatSession(id) {
    chat.sessions = chat.sessions.filter(x => x.id !== id)
    if (chat.currentId === id) {
      chat.currentId = ''
      chat.messages = []
    }
    saveSessions()
    try {
      api(`/api/ai/sessions/${id}`, { method: 'DELETE', silent401: true }).catch(() => {})
    } catch (_) {}
  }

  /* ---- AI 团队（角色定位）多租户配置 ---- */
  async function loadAiRoles() {
    try {
      const d = await api('/api/ai/roles')
      const roles = (d && d.roles) || []
      chat.roles = roles
      const saved = localStorage.getItem('hergent_role') || 'copilot'
      const ok = roles.some(r => r.role_id === saved && r.is_active !== 0)
      const first = roles.find(r => r.is_active !== 0)
      chat.currentRole = ok ? saved : (first ? first.role_id : 'copilot')
    } catch (e) {
      chat.roles = []
      chat.currentRole = 'copilot'
    }
  }

  function setAiRole(rid) {
    chat.currentRole = rid
    try { localStorage.setItem('hergent_role', rid) } catch {}
  }

  return {
    ui, user, demo, chat,
    toast, setTheme,
    perms, permsTenant, loadPerms, canModule,
    loadSessions, saveCurrentSession, newChatSession, openChatSession, deleteChatSession,
    loadAiRoles, setAiRole
  }
})

/* ============================================================
   向后兼容导出（现有调用点无需改动）
   ============================================================ */
export const store = useAppStore(pinia)

// 具名函数导出：委托到单例 store 上的同名 action
export const toast = (...a) => store.toast(...a)
export const setTheme = (...a) => store.setTheme(...a)
export const loadSessions = (...a) => store.loadSessions(...a)
export const saveCurrentSession = (...a) => store.saveCurrentSession(...a)
export const newChatSession = (...a) => store.newChatSession(...a)
export const openChatSession = (...a) => store.openChatSession(...a)
export const deleteChatSession = (...a) => store.deleteChatSession(...a)
export const loadAiRoles = (...a) => store.loadAiRoles(...a)
export const setAiRole = (...a) => store.setAiRole(...a)
