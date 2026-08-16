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
  demo: false,
  chat: {
    messages: [],          // {role:'user'|'assistant', content}
    streaming: false,
    error: '',
    sessions: [],          // 历史会话 [{id, title, messages, updated_at}]
    currentId: ''          // 当前会话 id（'' = 新对话）
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

/* ============================================================
   AI 会话持久化 — localStorage 按会话分组，刷新不丢，可接着聊
   ============================================================ */
const CHAT_KEY = 'hergent_chat_sessions_v1'

function saveSessions() {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(store.chat.sessions.slice(0, 30)))
  } catch { /* 超限静默 */ }
}

export function loadSessions() {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (raw) store.chat.sessions = JSON.parse(raw)
  } catch { store.chat.sessions = [] }
}

export function saveCurrentSession() {
  const msgs = store.chat.messages.filter(m => m.content)
  if (!msgs.length) return
  const now = Date.now()
  if (store.chat.currentId) {
    const s = store.chat.sessions.find(x => x.id === store.chat.currentId)
    if (s) {
      s.messages = msgs
      s.updated_at = now
    }
  } else {
    store.chat.currentId = 's' + now
    store.chat.sessions.unshift({
      id: store.chat.currentId,
      title: msgs[0].content.slice(0, 24) + (msgs[0].content.length > 24 ? '…' : ''),
      messages: msgs,
      updated_at: now
    })
  }
  saveSessions()
}

export function newChatSession() {
  saveCurrentSession()
  store.chat.messages = []
  store.chat.currentId = ''
  store.chat.error = ''
}

export function openChatSession(id) {
  saveCurrentSession()
  const s = store.chat.sessions.find(x => x.id === id)
  if (!s) return
  store.chat.messages = s.messages.map(m => ({ ...m }))
  store.chat.currentId = id
  store.chat.error = ''
}

export function deleteChatSession(id) {
  store.chat.sessions = store.chat.sessions.filter(x => x.id !== id)
  if (store.chat.currentId === id) {
    store.chat.currentId = ''
    store.chat.messages = []
  }
  saveSessions()
}
