/* ============================================================
   api.js — 统一请求封装
   对接现有后端 hergent-erp（/api/*，Bearer Token 鉴权）
   ============================================================ */

const TOKEN_KEY = 'hergent_v2_token'
const TENANT_KEY = 'hergent_v2_tenant'

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY) || '' },
  set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY) },
  get user() {
    try { return JSON.parse(localStorage.getItem('hergent_v2_user') || 'null') } catch { return null }
  },
  set user(v) { v ? localStorage.setItem('hergent_v2_user', JSON.stringify(v)) : localStorage.removeItem('hergent_v2_user') },
  get tenant() { return localStorage.getItem(TENANT_KEY) || '' },
  set tenant(v) { v ? localStorage.setItem(TENANT_KEY, String(v)) : localStorage.removeItem(TENANT_KEY) }
}

/* ---- 租户上下文（2026-09-05）----------------------------------------------
   后端解析租户的优先级：X-Tenant-Id 头 → hergent_tenant cookie → 按 token 推导。
   风险：cookie 是隐式来源，一旦残留了当前账号无权访问的租户 id（典型场景：先在
   本站点过「先看看演示效果」，后端 set-cookie hergent_tenant=<演示租户>；之后换
   真实账号登录但沿用旧会话 token 未重登，cookie 不会被覆盖），所有 /api/ 业务接口
   会被 403 TENANT_FORBIDDEN「无权访问该租户」整体锁死，表现即「交叉表加载失败」。
   对策：
     1) 登录/注册/演示登录后把后端返回的 tenant_id 存本地，后续请求显式带
        X-Tenant-Id 头（头优先级高于 cookie），彻底摆脱不可控的 cookie；
     2) 万一仍撞上 403，自愈一次：清空租户上下文后重试，让后端回落到按 token
        推导用户所属租户（见 api() 内的 TENANT_FORBIDDEN 分支）。
   ------------------------------------------------------------------------ */

/** 清掉可能残留的 hergent_tenant cookie（非 HttpOnly，JS 可清） */
export function clearTenantCookie() {
  try {
    const host = window.location.hostname
    const base = 'hergent_tenant=; Max-Age=0; path=/; SameSite=lax'
    document.cookie = base
    document.cookie = `${base}; domain=${host}`
    document.cookie = `${base}; domain=.${host}`
  } catch { /* 非浏览器环境或禁用了 cookie：忽略，后续由 api() 自愈兜底 */ }
}

/** 清空本地租户上下文（localStorage + cookie） */
export function resetTenantContext() {
  auth.tenant = ''
  clearTenantCookie()
}

/** 启动自愈：已有登录态却没有 tenant_id（老会话/演示残留）→ 清掉失效的租户 cookie */
export function bootstrapTenantContext() {
  if (auth.token && !auth.tenant) clearTenantCookie()
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
  if (data.tenant_id) auth.tenant = data.tenant_id   // 显式租户上下文（优先于 cookie）
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
  if (data.tenant_id) auth.tenant = data.tenant_id
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
  if (data.tenant_id) auth.tenant = data.tenant_id
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
/** 复核当前会话是否仍然有效（401 时用于区分「偶发」与「真的掉线」） */
async function probeSession() {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch('/api/auth/me', {
      headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
      signal: ctrl.signal
    })
    clearTimeout(timer)
    return r.ok
  } catch { return false }
}

export async function api(path, opts = {}) {
  const { method = 'GET', body, timeout = 20000, raw = false, silent401 = false } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  const csrf = localStorage.getItem('hergent_v2_csrf') || ''
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  try {
    const headers = {
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      // 显式租户上下文：优先级高于后端的 hergent_tenant cookie，避免残留 cookie 锁死请求
      ...(auth.tenant ? { 'X-Tenant-Id': String(auth.tenant) } : {}),
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
      // 401 不再「一票否决」。旧逻辑只要任一请求返回 401 就立刻清 token + 整页踢回登录页，
      // 首屏并发 6~9 个请求时，只要有一个偶发 401（后端同时支持 cookie erp_token 与
      // Authorization 头，两者短暂不一致即会触发），用户就被弹回登录页，表现为
      // 「反复登录又回到登录页」。改为：先用 /api/auth/me 复核会话是否真的失效，
      // 仍有效则只让本次请求失败，不毁掉会话。
      if (!opts._authRechecked) {
        const alive = await probeSession()
        if (alive) {
          const e = new Error('请求未授权 (401)')
          e.status = 401
          throw e
        }
        return api(path, { ...opts, _authRechecked: true })
      }
      auth.token = ''
      auth.tenant = ''
      if (!silent401 && !window.location.hash.startsWith('#/login')) window.location.hash = '#/login'
      throw new Error('登录已过期，请重新登录')
    }
    const data = await res.json().catch(() => ({}))
    if (res.status === 403 && data.error_code === 'TENANT_FORBIDDEN' && !opts._tenantRetried) {
      // 租户上下文（本地 tenant_id 或残留 cookie）对当前登录账号无效 → 清空后重试一次，
      // 让后端回落到「按 token 推导用户所属租户」，用户无需手动清 cookie/重登即可恢复。
      resetTenantContext()
      return api(path, { ...opts, _tenantRetried: true })
    }
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

