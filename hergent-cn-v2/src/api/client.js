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

export async function register(company, phone, password, code = '888888') {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company, phone, password, code })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || data.message || '注册失败')
  auth.token = data.token || ''
  auth.user = data.user || null
  if (data.csrf_token) localStorage.setItem('hergent_v2_csrf', data.csrf_token)
  return data
}

export async function demoLogin() {
  const res = await fetch('/api/auth/demo-login', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || data.message || '演示入口暂不可用')
  auth.token = data.token || ''
  auth.user = data.user || null
  auth.demo = !!data.demo
  return data
}

/* 统一 api()：带 Bearer + CSRF、错误信封、超时
 *
 * 契约（统一错误信封）：
 *   后端统一返回 { success: boolean, data?, detail?, message? }。
 *   - 成功且 data 存在：return data.data（即业务载荷）。
 *   - 成功但无 data（如 DELETE / 空响应）：return 整包（兼容裸响应）。
 *   - 失败（!res.ok）：抛 Error(detail || message || 状态文案)。
 *   raw: true 时直接 return 整包（供需要读取外层 success/message 的调用方，如上传接口）。
 *
 * body 类型：
 *   - FormData：透传（不 JSON.stringify、不设 Content-Type，由浏览器补 multipart 边界）。
 *   - 其它：JSON.stringify 并设 application/json。
 *
 * silent401：
 *   后台轮询/心跳等场景不希望 401 直接踢回登录页；置 true 时仅清空 token 并 throw，
 *   不跳转。主动请求保持默认（401 即跳登录）。
 */
export async function api(path, opts = {}) {
  const { method = 'GET', body, timeout = 20000, raw = false, silent401 = false } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  const csrf = localStorage.getItem('hergent_v2_csrf') || ''
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  try {
    const headers = {
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...(csrf && method !== 'GET' ? { 'X-CSRF-Token': csrf } : {})
    }
    if (!isForm) headers['Content-Type'] = 'application/json'
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? (isForm ? body : JSON.stringify(body)) : undefined,
      signal: ctrl.signal
    })
    if (res.status === 401) {
      auth.token = ''
      if (!silent401) window.location.hash = '#/login'
      throw new Error('登录已过期，请重新登录')
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // 后端错误信封字段不统一：部分端点用 detail/message，部分用 error；
      // 任一有值都优先展示，避免降级成「请求失败 (N)」丢失可读信息。
      // 同时把 HTTP 状态与原始响应体挂到 Error 上，供上层按状态码精确处理
      // （如 409 冲突可读取 payload.conflicts 明细）。
      const err = new Error(data.detail || data.message || data.error || `请求失败 (${res.status})`)
      err.status = res.status
      err.payload = data
      throw err
    }
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

/* Hermes 流式超时分级（P1）：普通对话 3 分钟；长任务（对账/复盘/报表等
   工具循环）5 分钟。hermesChat 默认 300000 保持兼容，调用方按任务轻重显式传 timeout。 */
export const CHAT_TIMEOUT_NORMAL = 180000
export const CHAT_TIMEOUT_LONG = 300000

export async function hermesChat(messages, { onDelta, model, system, timeout = 300000 } = {}) {
  const key = hermesKey || localStorage.getItem('hermes_v2_key') || ''
  const ctrl = new AbortController()
  // 长任务（复杂对账/报表）会让 Hermes 工具循环跑数分钟；120s 硬杀会中途断流
  // 并误报离线（P0 评审炸弹 #4）。放宽到 5 分钟，由调用方按需覆盖。
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const finalMessages = system ? [{ role: 'system', content: system }, ...messages] : messages
    const res = await fetch('/hermes/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: JSON.stringify({
        model: model || 'hermes-agent',
        messages: finalMessages,
        stream: true
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      // 把 HTTP 状态码前置到 message，便于上层区分「鉴权失败(401/403)」「服务不可用(502/503/504)」「临时错误」
      throw new Error(`[HTTP ${res.status}] ` + (e.detail || e.message || 'Hermes 上游错误'))
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

/* 统一 Hermes REST 请求（非流式）：models / 配置校验等
 * 与 hermesChat 共享同一套 Hermes Key 鉴权，避免各组件裸 fetch /hermes/*。
 * path 形如 '/hermes/v1/models'（经 Vite 代理 /hermes -> Hermes API server）。
 * 返回 { ok, status, data }，由调用方决定 UI 文案（401 等不强制跳转登录）。
 */
export async function hermesRequest(path, opts = {}) {
  const { method = 'GET', body, timeout = 20000 } = opts
  const key = hermesKey || localStorage.getItem('hermes_v2_key') || ''
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } finally {
    clearTimeout(timer)
  }
}

/* ============================================================
   表格全量计算已上移至服务端（方案 A）：
   Hermes 通过 spreadsheet MCP server（/opt/hergent-mcp-spreadsheet）直接调用
   后端 _run_query 对【整张表】精确计算。前端只把上传文件的 file_id 以软提示形式
   透传给 Hermes，由它自行规划参数并调用 spreadsheet_summary / spreadsheet_query
   工具，避免前端替模型做脆弱的意图推断与参数猜测，也避免预览被截断导致瞎算。
   前端不再实现任何表格计算逻辑（见 CopilotDrawer.spreadsheetSoftHint）。
   ============================================================ */

