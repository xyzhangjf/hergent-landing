/* 统一请求封装：带 token + 租户头 + 错误信封解析
   v2026-09-07(P0-2/P0-3)：请求超时 15s；401 先复核 /api/auth/me，
   确认 token 真失效才踢登录（防并发 401 多次 reLaunch / 后端偶发误判时误踢） */
const app = getApp()
const { reportError } = require('./track')

let _kicking = false   // 已在跳登录，防并发多次 reLaunch
let _probing = false   // 复核进行中，多个 401 只 probe 一次

/* v224（2026-09-21）：错误对象必须带上**可分级的**信息 —— 这是「提交后反馈」能分级的前提。
   背景：报单提交失败时原实现只有一句 `message`，调用方无从区分两类失败：
     · 「网络断了 / 超时」   → 重试有意义，"存草稿 + 联网自动补传"是对的；
     · 「业务拒绝 400/403/409」→ 重试一万次结果一样，必须**当场**把原因告诉用户。
   于是所有失败都被当成"网络问题"存成草稿并自动补传 ⇒ 用户每进一次页面被弹一次确认框，
   而真正的原因（商品不在本期清单 / 未录厂价 / 本期已定稿 / 无门店权限）他一次都没看到。
   ⚠️ 只**增加**字段，`message` 一字未动 —— 既有调用方全部只读 `e.message`，零破坏。 */
function httpError(msg, statusCode, body, isNetwork) {
  const e = new Error(msg)
  e.statusCode = statusCode || 0
  e.payload = body || null
  e.code = (body && (body.code || body.error_code)) || 0
  e.isNetwork = !!isNetwork
  // 「值不值得再试一次」的唯一判据：网络层失败、或服务端 5xx。
  // 4xx（含 200 + success:false 的信封）一律是业务拒绝 —— 重试无意义，必须让用户看到原因。
  e.retryable = !!isNetwork || statusCode >= 500
  return e
}

function doKick() {
  if (_kicking) return
  _kicking = true
  wx.removeStorageSync('fs_token')
  wx.removeStorageSync('fs_user')
  wx.removeStorageSync('fs_tenant_id')
  app.globalData.token = ''
  app.globalData.user = null
  app.globalData.tenantId = ''
  // M12: 记录当前页面路径，登录成功后回跳原页面（而非强制首页）
  try {
    const pages = getCurrentPages()
    const cur = pages[pages.length - 1]
    if (cur && cur.route) wx.setStorageSync('fs_redirect', '/' + cur.route)
  } catch (e) { console.warn('[api] set fs_redirect failed:', e) }
  wx.reLaunch({
    url: '/pages/login/login',
    complete: () => { _kicking = false }
  })
}

/* 401 复核：token 仍有效则后端只是偶发误判，仅本次报错不踢；
   真失效（/auth/me 401/网络错）才清态跳登录 */
function probeSession() {
  return new Promise((resolve) => {
    const token = wx.getStorageSync('fs_token') || app.globalData.token || ''
    if (!token) { resolve(false); return }
    wx.request({
      url: app.globalData.apiBase + '/api/auth/me',
      method: 'GET',
      header: { Authorization: 'Bearer ' + token },
      timeout: 8000,
      success: (r) => resolve(r.statusCode === 200),
      fail: () => resolve(false)
    })
  })
}

function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    const token = app.globalData.token || wx.getStorageSync('fs_token') || ''
    // v108-fix: 租户 ID 从登录响应动态获取，不再硬编码
    const tenantId = app.globalData.tenantId || wx.getStorageSync('fs_tenant_id') || ''
    wx.request({
      url: app.globalData.apiBase + path,
      method,
      data,
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(tenantId ? { 'X-Tenant-Id': String(tenantId) } : {})
      },
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 401) {
          reportError('登录已过期', 'api.401')
          // P0-3: 复核而非直接踢——并发 401 只 probe 一次，防多次 reLaunch；
          // token 仍有效时（后端偶发误判）不打断会话
          if (!_probing) {
            _probing = true
            probeSession().then((valid) => {
              _probing = false
              if (!valid) doKick()
            })
          }
          reject(httpError('登录已过期，请重新登录', 401, body, false))
          return
        }
        if (res.statusCode >= 400 || body.success === false || body.ok === false) {
          const msg = body.error || body.detail || body.message || `请求失败(${res.statusCode})`
          reportError(msg, 'api.' + (res.statusCode || 'err'))
          // v224：带上状态码与整个响应体 —— 调用方据此分级（并读 body.violations 等结构化原因）
          reject(httpError(msg, res.statusCode, body, false))
          return
        }
        resolve(body)
      },
      fail(err) {
        const em = (err && err.errMsg) || ''
        // P0-2: 区分超时与普通网络错误，给用户可理解的文案
        const msg = /timeout/i.test(em) ? '网络超时，请重试' : (em || '网络错误')
        reportError(msg, 'api.fail')
        // v224：isNetwork=true ⇒ retryable ⇒ 调用方才允许"存草稿 + 自动补传"
        reject(httpError(msg, 0, null, true))
      }
    })
  })
}

module.exports = { request }
