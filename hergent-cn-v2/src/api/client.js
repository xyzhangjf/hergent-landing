/* ============================================================
   api.js — 统一请求封装
   对接现有后端 hergent-erp（/api/*，Bearer Token 鉴权）
   ============================================================ */

const TOKEN_KEY = 'hergent_v2_token'

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY) || '' },
  set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY) },
  get user() {
    try { return JSON.parse(localStorage.getItem('hergent_v2_user') || 'null') } catch { return null }
  },
  set user(v) { v ? localStorage.setItem('hergent_v2_user', JSON.stringify(v)) : localStorage.removeItem('hergent_v2_user') }
}

/* 登录（复用现有后端 /api/auth/login，字段与后端 routers/auth.py 一致） */
export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || data.message || '登录失败')
  auth.token = data.access_token || data.token || ''
  // 后端返回 user: {id, username, display_name, role}；存 CSRF 供写操作
  auth.user = data.user || null
  if (data.csrf_token) localStorage.setItem('hergent_v2_csrf', data.csrf_token)
  return data
}

/* 统一 api()：带 Bearer + CSRF、错误信封、超时 */
export async function api(path, opts = {}) {
  const { method = 'GET', body, timeout = 20000, raw = false } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  const csrf = localStorage.getItem('hergent_v2_csrf') || ''
  try {
    const res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        ...(csrf && method !== 'GET' ? { 'X-CSRF-Token': csrf } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
    if (res.status === 401) {
      auth.token = ''
      window.location.hash = '#/login'
      throw new Error('登录已过期，请重新登录')
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail || data.message || `请求失败 (${res.status})`)
    return raw ? data : (data.data !== undefined ? data.data : data)
  } finally {
    clearTimeout(timer)
  }
}

/* ============================================================
   Hermes 通道 — OpenAI 兼容 /v1/chat/completions
   经 Vite 代理 /hermes -> Hermes API server :8642
   AI 能力 100% 由 Hermes 提供，前端不实现任何 AI 逻辑
   ============================================================ */

let hermesKey = ''

export function setHermesKey(k) { hermesKey = k }

export async function hermesChat(messages, { onDelta, model } = {}) {
  const key = hermesKey || localStorage.getItem('hermes_v2_key') || ''
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120000)
  try {
    const res = await fetch('/hermes/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: JSON.stringify({
        model: model || 'hermes-agent',
        messages,
        stream: true
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      throw new Error(e.detail || e.message || `Hermes 错误 (${res.status})`)
    }
    if (!onDelta) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
      }
      return full
    }
    // SSE 流式解析
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          const delta = j.choices?.[0]?.delta?.content || ''
          if (delta) { full += delta; onDelta(delta, full) }
        } catch { /* 忽略不完整行 */ }
      }
    }
    return full
  } finally {
    clearTimeout(timer)
  }
}
