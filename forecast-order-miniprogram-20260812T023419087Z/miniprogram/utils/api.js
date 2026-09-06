/* 统一请求封装：带 token + 租户头 + 错误信封解析 */
const app = getApp()
const { reportError } = require('./track')

function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    const token = app.globalData.token || wx.getStorageSync('fs_token') || ''
    // v108-fix: 租户 ID 从登录响应动态获取，不再硬编码
    const tenantId = app.globalData.tenantId || wx.getStorageSync('fs_tenant_id') || ''
    wx.request({
      url: app.globalData.apiBase + path,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(tenantId ? { 'X-Tenant-Id': String(tenantId) } : {})
      },
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 401) {
          // F2 修复：401 同时清掉用户/租户态并跳登录页，避免卡在无权限态
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
          wx.reLaunch({ url: '/pages/login/login' })
          reportError('登录已过期', 'api.401')
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
        reportError(err.errMsg || 'network', 'api.fail')
        reject(new Error(err.errMsg || '网络错误'))
      }
    })
  })
}

module.exports = { request }
