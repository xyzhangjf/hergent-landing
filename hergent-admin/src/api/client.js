// Hergent 管理后台 API 客户端
// 鉴权契约（与主站一致）：Bearer token 自动绕过 CSRF（后端 csrf_middleware 已确认），
// 因此写操作只需带 Authorization: Bearer，无需额外 X-CSRF-Token。

const TOKEN_KEY = 'hergent_admin_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = 'Bearer ' + token
  const opts = { method, headers }
  if (body !== undefined) opts.body = JSON.stringify(body)
  let resp
  try {
    resp = await fetch('/api' + path, opts)
  } catch (e) {
    throw new ApiError('网络错误，无法连接服务器', 0, 'NETWORK')
  }
  let data = null
  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    try { data = await resp.json() } catch (e) { data = null }
  }
  if (resp.status === 401) {
    setToken('')
    if (location.hash.indexOf('#/login') === -1) {
      location.href = '/admin/#/login'
    }
    throw new ApiError('登录已失效，请重新登录', 401, 'UNAUTHORIZED')
  }
  if (!resp.ok) {
    const msg = (data && (data.message || data.detail)) || ('请求失败 (' + resp.status + ')')
    throw new ApiError(msg, resp.status, data && data.code)
  }
  return data
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
}

// ---------- 鉴权 ----------
export const authApi = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  whoami: () => api.get('/platform/whoami'),
}

// ---------- 平台统计 ----------
export const statsApi = {
  overview: () => api.get('/platform/stats'),
}

// ---------- 租户 ----------
export const tenantApi = {
  list: (activeOnly = false) => api.get('/tenants?active_only=' + (activeOnly ? 'true' : 'false')),
  get: (id) => api.get('/tenants/' + id),
  create: (b) => api.post('/tenants', b),
  update: (id, b) => api.put('/tenants/' + id, b),
  members: (id) => api.get('/tenants/' + id + '/members'),
  addMember: (id, b) => api.post('/tenants/' + id + '/members', b),
  removeMember: (id, uid) => api.del('/tenants/' + id + '/members/' + uid),
  usage: (id) => api.get('/tenants/' + id + '/usage'),
}

// ---------- 邀请码 ----------
export const inviteApi = {
  list: () => api.get('/platform/invite-codes'),
  create: (b) => api.post('/platform/invite-codes', b),
  setStatus: (b) => api.post('/platform/invite-codes/status', b),
  remove: (code) => api.del('/platform/invite-codes/' + encodeURIComponent(code)),
}

// ---------- 注册流水 ----------
export const regApi = {
  list: () => api.get('/platform/registrations'),
}

// ---------- 平台用户 ----------
export const userApi = {
  list: () => api.get('/users'),
}
