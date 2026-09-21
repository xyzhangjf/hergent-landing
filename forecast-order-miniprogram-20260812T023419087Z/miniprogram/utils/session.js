/* 退出登录 —— 本机清态 **+ 通知服务端销毁会话**。
 *
 * 🔴 为什么必须带上服务端那一步（2026-09-20 审计 P1-1）：
 *   原实现（`pages/mine/mine.js` 的 `logout()`、`privacy-settings` 的 `revoke()`）只清本机
 *   storage 与 globalData，**从不调 `/api/auth/logout`**（全仓 0 命中）。
 *   而 token 在服务端最长还能活 24 小时 ⇒ 点了「退出」的旧 token 依旧可用。
 *   手机丢失/借用场景下，「退出」这个动作必须**真的**让 token 失效。
 *   后端 `routers/auth.py` 的 `/logout` 本来就会 `DELETE FROM sessions`，是前端没调。
 *
 * 纪律：
 *   ① **先清本机、再发请求** —— 服务端那一步是 best-effort，网络不通也必须保证用户
 *      在本机已经退出（否则弱网下「点退出没反应」）。
 *   ② **失败不回滚** —— 清了就是退了；把 token 塞回去只会制造「退不出去」。
 *   ③ 顺带清掉权限缓存（`fs_perm`），避免换个账号登录后拿到上一个人的权限显示。
 */
const { clearPerms } = require('./perm')
const { clearQueue } = require('./track')

function _app() { return getApp() }
function _base() { return (_app() && _app().globalData.apiBase) || 'https://hergent.cn' }

/**
 * @param {Object} [opts]
 * @param {Function} [opts.success] 本机已清态后立即回调（无论服务端是否成功）
 */
function logout(opts) {
  opts = opts || {}
  const a = _app()
  const token = (a && a.globalData.token) || wx.getStorageSync('fs_token') || ''
  const tid = (a && a.globalData.tenantId) || wx.getStorageSync('fs_tenant_id') || ''

  // ---- ① 本机清态（同步、立即生效）----
  try {
    wx.removeStorageSync('fs_token')
    wx.removeStorageSync('fs_user')
    wx.removeStorageSync('fs_tenant_id')
    wx.removeStorageSync('fs_need_pwd_change')
    wx.removeStorageSync('fs_redirect')
    wx.removeStorageSync('fs_store_id')
  } catch (e) { console.warn('[session] clear storage failed:', e) }
  clearPerms()
  clearQueue()   // v211：别把上一个账号的事件带到下一个账号（标识会错位）
  if (a) {
    a.globalData.token = ''
    a.globalData.user = null
    a.globalData.tenantId = ''
    a.globalData.loginPw = ''
    a.globalData._fsCache = {}
  }
  if (typeof opts.success === 'function') opts.success()

  // ---- ② 通知服务端销毁会话（best-effort，失败也不回滚）----
  if (!token) return
  wx.request({
    url: _base() + '/api/auth/logout',
    method: 'POST',
    timeout: 6000,
    header: Object.assign({ Authorization: 'Bearer ' + token },
                          tid ? { 'X-Tenant-Id': String(tid) } : {}),
    fail(err) { console.warn('[session] server logout failed:', (err && err.errMsg) || err) }
  })
}

module.exports = { logout }
