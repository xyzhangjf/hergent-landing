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

/** 清掉可能残留的 hergent_tenant cookie（非 HttpOnly，JS 可清）。
 *  仅本模块内部使用（resetTenantContext / bootstrapTenantContext），故不对外导出。 */
function clearTenantCookie() {
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

/* 认证类接口的统一错误文案。
   nginx 层按 IP 限流（conf.d/hergent-ratelimit.conf）返回的是 HTML 429，不是 JSON，
   res.json() 解析失败后 data 为空对象；若直接回落成「登录失败」，用户会误以为
   密码错了。按状态码补一条可读文案。后端自身的 429（账户锁定）带 detail，优先展示。 */
function _authErrText(res, data, fallback) {
  return data.detail || data.message || (res.status === 429 ? '操作过于频繁，请稍后再试' : fallback)
}

/* 登录（复用现有后端 /api/auth/login，字段与后端 routers/auth.py 一致）

   v307：网页端必须自报家门 `X-Client: web`。
   🔴 为什么必须带：后端「登录范围」判据里，**缺头一律视为小程序**（fail-open）——
     存量小程序客户端不带这个头且已备案上线，改成"必带头"会当场切断所有存量小程序登录，
     所以只能由**随时可发版的网页端**来补。不带 ⇒ 网页端被当成小程序，
     于是「仅网页端」的账号登不进来、而「仅小程序」的账号反而能从网页端登进去。
   🔴 这条头只是**自报家门**（客户端可伪造），不是安全边界；真正的边界仍是后端模块权限。 */
export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client': 'web' },
    body: JSON.stringify({ username, password })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(_authErrText(res, data, '登录失败'))
  auth.token = data.access_token || data.token || ''
  // 后端返回 user: {id, username, display_name, role}；存 CSRF 供写操作
  auth.user = data.user || null
  if (data.tenant_id) auth.tenant = data.tenant_id   // 显式租户上下文（优先于 cookie）
  if (data.csrf_token) localStorage.setItem('hergent_v2_csrf', data.csrf_token)
  return data
}

/** 当前注册校验方式：invite（邀请码，内测）/ sms（短信）/ open（免验证）。
 *  由后端 /api/auth/register-mode 下发，前端不硬编码 —— 日后切真短信时前端零改动。 */
export async function fetchRegisterMode() {
  const fallback = { mode: 'invite', need_invite: true, need_sms: false, hint: '' }
  try {
    const res = await fetch('/api/auth/register-mode')
    if (!res.ok) return fallback
    const d = await res.json().catch(() => ({}))
    return d && d.mode ? d : fallback
  } catch (e) {
    return fallback
  }
}

export async function register(company, phone, password, { inviteCode = '', smsCode = '' } = {}) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company, phone, password, invite_code: inviteCode, code: smsCode })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(_authErrText(res, data, '注册失败'))
  auth.token = data.token || ''
  auth.user = data.user || null
  if (data.tenant_id) auth.tenant = data.tenant_id
  if (data.csrf_token) localStorage.setItem('hergent_v2_csrf', data.csrf_token)
  return data
}

/** 发送短信验证码（仅 REGISTER_MODE=sms 时可用；invite 模式下后端会明确拒绝）。 */
export async function sendCode(phone) {
  const res = await fetch('/api/auth/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(_authErrText(res, data, '验证码发送失败'))
  return data
}

/* 修改密码（首次登录强制改密 与 设置页改密 共用）
   POST /api/auth/password，body { old_password, new_password }。
   成功后后端会置 password_changed=1，并删除该用户其它会话（保留当前会话）。 */
export async function changePassword(oldPassword, newPassword) {
  const csrf = localStorage.getItem('hergent_v2_csrf') || ''
  const res = await fetch('/api/auth/password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...(auth.tenant ? { 'X-Tenant-Id': String(auth.tenant) } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {})
    },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(_authErrText(res, data, '修改密码失败'))
  return data
}

export async function demoLogin() {
  const res = await fetch('/api/auth/demo-login', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(_authErrText(res, data, '演示入口暂不可用'))
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
  } catch (e) {
    /* v196：把「到点 abort」转成**可读、可判定**的错误。
       fetch 在 signal abort 时抛的是 DOMException(name='AbortError')，message 为英文
       （"signal is aborted without reason" / "The user aborted a request."）——
       既无「超时」也无 timeout/network/fetch 字样 ⇒ 上层任何按文案分类的兜底逻辑
       都会把它归成「网络或服务器异常」，用户看到一条与真实原因（超时）无关的提示
       （v194b 真机实测即此形态；改单保存 140 秒撞 20 秒超时就是这样报出来的）。
       统一在此转换，全站受益。⚠️ 只改失败路径，成功路径与既有 401/403 分支一字不动。 */
    if (e && e.name === 'AbortError') {
      const err = new Error(`请求超时（${Math.round(timeout / 1000)} 秒未响应）`)
      err.name = 'TimeoutError'
      err.timeout = true
      err.status = 0
      throw err
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/* ============================================================
   Hermes 通道 —— 一律经**本仓后端代理** `/api/ai/copilot/chat`
   （后端再直连 127.0.0.1:18765；网关凭据只存在于服务端 .env）
   AI 能力 100% 由 Hermes 提供，前端不实现任何 AI 逻辑
   🔴 v281（2026-09-26）：原先前端还持有网关 Key（`hermesKey`/`hermes_v2_key`）并把
      `/hermes/*` 当作直连通道 —— 因该路径「对公网无鉴权且带 terminal/file 工具集」
      已被封堵；Key 与直连路径一并撤除，前端不再持有任何网关凭据。
   ============================================================ */

/* Hermes 流式超时分级（P1）：普通对话 3 分钟；长任务（对账/复盘/报表等
   工具循环）5 分钟。hermesChat 默认 300000 保持兼容，调用方按任务轻重显式传 timeout。 */
export const CHAT_TIMEOUT_NORMAL = 180000
export const CHAT_TIMEOUT_LONG = 300000

/* 🔴 v309（2026-09-28）外部中止信号支持 —— 让「停止生成」成为可能。
   对齐 WorkBuddy 的做法（其 SendButton 是 `handleClick = loading ? onCancel : onSend`，
   停止真正落地靠三件事：① 取消 SSE reader ② `abortController.abort()` 掐断 fetch
   ③ 再向服务端发一条 DELETE 拆除服务端那次运行）。我们只有 ①② 这一条路
   （后端是同步直通代理，浏览器 abort 会让 Starlette 关闭上游生成器并 `resp.close()`），
   所以**中止信号必须真的传到 fetch**，否则按钮是个摆设。
   ⚠️ 与内部超时共用 AbortController：两者都表现为 `AbortError` ⇒ 调用方无法区分
   「我等了 3 分钟没动静」和「我自己按的停止」。这里主动区分：**外部信号触发的**中止
   抛 `StoppedError`（带 `stopped=true`），内部超时仍抛原生 `AbortError`。 */
function _abortError() {
  const e = new Error('已停止生成')
  e.name = 'StoppedError'
  e.stopped = true
  return e
}

/** 合并两个 AbortSignal（优先 `AbortSignal.any`；老浏览器回退成手工转发，绝不静默丢弃外部信号） */
function _mergeSignal(external, internal) {
  if (!external) return internal
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([external, internal])
  }
  if (external.aborted) return external   // 已中止 ⇒ 直接用它（fetch 会立刻抛 AbortError）
  external.addEventListener('abort', () => internal.abort(), { once: true })
  return internal
}

export async function hermesChat(messages, { onDelta, onTool, onReasoning, model, system, timeout = 300000, signal } = {}) {
  const ctrl = new AbortController()
  // 长任务（复杂对账/报表）会让 Hermes 工具循环跑数分钟；120s 硬杀会中途断流
  // 并误报离线（P0 评审炸弹 #4）。放宽到 5 分钟，由调用方按需覆盖。
  const timer = setTimeout(() => ctrl.abort(), timeout)
  // 外部 signal（用户点「停止」）与内部超时 signal 合并后交给 fetch；
  // 谁先 abort 都掐断请求，但抛出的错误类型按下方 catch 区分。
  const sig = _mergeSignal(signal, ctrl.signal)
  try {
    const finalMessages = system ? [{ role: 'system', content: system }, ...messages] : messages
    // 🔴 v281（2026-09-26）**只走本仓后端代理**，直连通道已整条撤除。
    //   原先后备有两条"保险"，都已删除：
    //   ① 「无 chat 权限账号自动退回 `/hermes/`」——那条路径是 nginx 上**对公网零鉴权直通生产
    //      网关**（带 terminal/file 工具集，实测外网零凭据可执行命令）⇒ 已封堵，退回也没有意义；
    //   ② 「localStorage.hergent_copilot_proxy='0' 紧急回滚」——应急开关改由**后端环境变量**承担，
    //      用户侧不再持有能绕过后端 `ai_mode` 权威判定的开关。
    //   密钥不再经前端：网关凭据只存在于服务端（.env），后端经 127.0.0.1 直连网关。
    const payload = { model: model || 'hermes-agent', messages: finalMessages, stream: true }
    const proxyHdrs = { 'Content-Type': 'application/json' }
    const _t = localStorage.getItem('hergent_v2_token') || ''
    if (_t) proxyHdrs.Authorization = `Bearer ${_t}`   // Bearer 免 CSRF
    const post = (url, hdrs) => fetch(url, {
      method: 'POST', headers: hdrs, body: JSON.stringify(payload), signal: sig
    })
    const res = await post('/api/ai/copilot/chat', proxyHdrs)
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
    let pendingEvent = ''   // 跟踪上一行的 event: 类型（OpenAI Responses 风格）
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (t.startsWith('event:')) { pendingEvent = t.slice(6).trim(); continue }
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          // 文本增量（Chat Completions 格式，既有链路，保持不变）
          const delta = j.choices?.[0]?.delta?.content || ''
          if (delta) { full += delta; onDelta && onDelta(delta, full) }
          // 推理流（DeepSeek 的 `reasoning_content`）：模型在吐答案前先流式输出思考。
          // 🔴 2026-09-25 实测：模型侧**确实在流**（直连 api.deepseek.com 能看到逐字
          //    reasoning_content），但 **Hermes 目前没有把它转发到对客户端的 SSE**
          //    （其 `_thinking` 事件只是把助手正文回传、用于子智能体转播，不是推理流）。
          //    故此处按协议备好解析：**Hermes 一旦转发即自动生效**，无需再改前端。
          const rdel = j.choices?.[0]?.delta?.reasoning_content || ''
          if (rdel) { onReasoning && onReasoning(rdel) }
          // 工具调用生命周期（OpenAI Responses 风格 event:）
          if (onTool && pendingEvent === 'response.output_item.added') {
            const item = j.item
            if (item && item.type === 'function_call') {
              if (item.status === 'in_progress')
                onTool({ phase: 'start', name: item.name || '', args: item.arguments || '' })
              else if (item.status === 'completed')
                onTool({ phase: 'done', name: item.name || '' })
            } else if (item && item.type === 'function_call_output') {
              onTool({ phase: 'result', name: item.name || '', result: item.output || '' })
            }
          } else if (onTool && pendingEvent === 'response.output_item.done') {
            const item = j.item
            if (item && item.type === 'function_call' && item.status === 'completed')
              onTool({ phase: 'done', name: item.name || '' })
          } else if (onTool && pendingEvent === 'hermes.tool.progress') {
            // 🔴 Hermes **原生**工具进度事件。实测事件名就是 `hermes.tool.progress`，
            //   payload = {tool, emoji, label, toolCallId, status:'running'|'completed'}。
            //   此前这里只认 OpenAI Responses 风格的 `response.output_item.added` ⇒ **事件名对不上**，
            //   实测一轮「查库存」对话里 14 个过程事件被**全部丢弃**，老板在 26 秒里只看到
            //   三个跳动的点（2026-09-25 定位并修复）。
            if (j && j.tool) {
              onTool({
                phase: j.status === 'completed' ? 'done' : 'start',
                id: j.toolCallId || '',
                name: j.tool,
                emoji: j.emoji || '',
                label: j.label || '',
              })
            }
          }
        } catch { /* 忽略不完整行 */ }
        pendingEvent = ''   // 一条 data 消费后清空，避免误用到下一帧
      }
    }
    return full
  } catch (e) {
    // 外部信号（用户点「停止」/ 按 Esc）导致的中止 —— 与内部超时区分开，
    // 否则调用方会把「我自己按的停止」显示成「回答生成超时」。
    if (e && e.name === 'AbortError' && signal && signal.aborted) throw _abortError()
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/* 🔴 v281（2026-09-26）`hermesRequest(path)` 已**删除**。
   它用于向 `/hermes/*` 发非流式请求（唯一调用点是设置页的「测试连接」）。
   该路径已被封堵（对公网无鉴权直通生产网关），且前端不再持有网关 Key；
   设置页的测试改为直接打后端真实链路（`/api/ai/skills`）。 */

/* ============================================================
   表格全量计算已上移至服务端（方案 A）：
   Hermes 通过 spreadsheet MCP server（/opt/hergent-mcp-spreadsheet）直接调用
   后端 _run_query 对【整张表】精确计算。前端只把上传文件的 file_id 以软提示形式
   透传给 Hermes，由它自行规划参数并调用 spreadsheet_summary / spreadsheet_query
   工具，避免前端替模型做脆弱的意图推断与参数猜测，也避免预览被截断导致瞎算。
   前端不再实现任何表格计算逻辑（见 CopilotDrawer.spreadsheetSoftHint）。
   ============================================================ */

