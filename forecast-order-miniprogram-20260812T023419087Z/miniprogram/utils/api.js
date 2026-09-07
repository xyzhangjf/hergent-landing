/* 统一请求封装：带 token + 租户头 + 错误信封解析
   v2026-09-07(P0-2/P0-3)：请求超时 15s；401 先复核 /api/auth/me，
   确认 token 真失效才踢登录（防并发 401 多次 reLaunch / 后端偶发误判时误踢） */
const app = getApp()
const { reportError } = require('./track')

let _kicking = false   // 已在跳登录，防并发多次 reLaunch
let _probing = false   // 复核进行中，多个 401 只 probe 一次

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
          reject(new Error('登录已过期，请重新登录'))
          return
        }
        if (res.statusCode >= 400 || body.success === false || body.ok === false) {
          const msg = body.error || body.detail || body.message || `请求失败(${res.statusCode})`
          reportError(msg, 'api.' + (res.statusCode || 'err'))
          reject(new Error(msg))
          return
        }
        resolve(body)
      },
      fail(err) {
        const em = (err && err.errMsg) || ''
        // P0-2: 区分超时与普通网络错误，给用户可理解的文案
        const msg = /timeout/i.test(em) ? '网络超时，请重试' : (em || '网络错误')
        reportError(msg, 'api.fail')
        reject(new Error(msg))
      }
    })
  })
}

module.exports = { request }
