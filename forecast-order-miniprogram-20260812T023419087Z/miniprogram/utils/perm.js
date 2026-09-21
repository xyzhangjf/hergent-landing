/* 🔴 权限查询 —— 小程序侧**唯一**的「我能用这个 App 吗」判据来源。
 *
 * 为什么需要它（2026-09-20 全量审计 P0-2/P0-3）：
 *   小程序的 7 个业务端点在后端 `_PATH_MODULE_MAP` 里**全部**映射 `data` 模块，
 *   而 `core._DEFAULT_PERMS` 里 **accountant / guide / driver 都没有 `data`** ⇒
 *   这三种角色**能登录**（`/api/auth` 在 `_PUBLIC_PATHS`，RBAC 完全豁免）但
 *   **每个动作都 403** —— 用户看到的是「登进去了，然后一片空白/到处报错」。
 *   后端判据是对的（不该给这些人 `data`，那是个宽模块），**错的是前端假装他们能用**。
 *
 * 判据链条（三层，缺一层就退化成现在的样子）：
 *   ① 后端 `_check_perm`（真边界，永远在）→ 403
 *   ② 本模块（**诚实反馈**：提前问、提前说清「为什么不行、找谁」）
 *   ③ 无权限页（把 ② 的结论呈现出来）
 *   ②③ 都不是安全边界，它们修的是「界面承诺 ≠ 实际能力」。
 *
 * 🔴 三态语义（照抄 v206 Web 端约定，混了就会出问题）：
 *   - `known=false` = **还不知道**（未登录 / 请求失败）⇒ `canReport=true`（fail-open）
 *     —— 一次接口抖动不能把能干活的人挡在门外；真无权限的用户仍会被后端 403 兜住。
 *   - `known=true, canReport=false` = **已确认无权限** ⇒ 进无权限页。
 *   - `known=true, canReport=true` ⇒ 正常放行。
 *   `undefined`/`null`/`{}`/`[]` 一律当「不知道」，**不要**把空数组当「无权限」。
 *
 * 缓存：内存 + Storage（带 TTL）。键里带上 username + tenantId —— 否则换账号/换租户后
 * 会拿上一个人的权限显示（与 v205/v206 那个「串味」同族）。
 */
const CACHE_KEY = 'fs_perm'
const TTL = 5 * 60 * 1000      // 5 分钟：管理员刚给权限时最多等这么久（无权限页有「重新检查」按钮可立即刷新）

function _app() { return getApp() }
function _base() { return (_app() && _app().globalData.apiBase) || 'https://hergent.cn' }

function _curIdentity() {
  const a = _app()
  const u = (a && a.globalData.user) || wx.getStorageSync('fs_user') || {}
  const t = (a && a.globalData.tenantId) || wx.getStorageSync('fs_tenant_id') || ''
  return { username: u.username || '', tenantId: String(t || '') }
}

function _canReportFrom(perms) {
  if (!perms || !perms.length) return false
  if (perms.indexOf('*') >= 0) return true
  return perms.indexOf('data') >= 0
}

/** 读缓存。身份不符 / 过期 / 无缓存 → null（= 还不知道）。 */
function readCache() {
  let raw = null
  try { raw = wx.getStorageSync(CACHE_KEY) } catch (e) { raw = null }
  if (!raw || typeof raw !== 'object') return null
  const id = _curIdentity()
  if (String(raw.username || '') !== id.username) return null
  if (String(raw.tenantId || '') !== id.tenantId) return null
  if (!raw.at || (Date.now() - raw.at) > TTL) return null
  if (!Array.isArray(raw.permissions)) return null
  return {
    known: true,
    role: raw.role || '',
    permissions: raw.permissions,
    canReport: _canReportFrom(raw.permissions),
    fromCache: true
  }
}

/** 同步取「已确认的权限状态」。未加载/过期 → `{known:false}`（调用方按 fail-open 处理）。 */
function peekPerms() {
  return readCache() || { known: false, role: '', permissions: [], canReport: true }
}

function _write(role, permissions) {
  const id = _curIdentity()
  try {
    wx.setStorageSync(CACHE_KEY, {
      username: id.username, tenantId: id.tenantId,
      role: role || '', permissions: permissions || [], at: Date.now()
    })
  } catch (e) { /* 缓存写失败不影响主流程 */ }
}

let _inflight = null

/**
 * 拉取权限。force=true 忽略缓存（登录成功后 / 无权限页「重新检查」）。
 * 永不 reject —— 失败时返回 `{known:false, canReport:true}`（fail-open）。
 */
function loadPerms(force) {
  if (!force) {
    const c = readCache()
    if (c) return Promise.resolve(c)
  }
  if (_inflight) return _inflight
  _inflight = new Promise((resolve) => {
    const a = _app()
    const token = (a && a.globalData.token) || wx.getStorageSync('fs_token') || ''
    const tid = (a && a.globalData.tenantId) || wx.getStorageSync('fs_tenant_id') || ''
    if (!token) { resolve({ known: false, role: '', permissions: [], canReport: true }); return }
    wx.request({
      // `/api/auth/*` 在 `_PUBLIC_PATHS` 里 ⇒ **RBAC 豁免**，无 `data` 权限的角色也能读到
      // 自己的权限清单。这正是「让反馈诚实」能成立的技术前提。
      url: _base() + '/api/auth/permissions',
      method: 'GET',
      timeout: 8000,
      header: Object.assign({ Authorization: 'Bearer ' + token },
                            tid ? { 'X-Tenant-Id': String(tid) } : {}),
      success(r) {
        const b = r.data || {}
        if (r.statusCode === 200 && Array.isArray(b.permissions)) {
          const role = (b.user && b.user.role) || ''
          _write(role, b.permissions)
          resolve({ known: true, role: role, permissions: b.permissions,
                    canReport: _canReportFrom(b.permissions), fromCache: false })
        } else {
          // 非 200：**不**据此断定无权限（可能只是网关抖动）⇒ fail-open
          resolve({ known: false, role: '', permissions: [], canReport: true })
        }
      },
      fail() { resolve({ known: false, role: '', permissions: [], canReport: true }) },
      complete() { _inflight = null }
    })
  })
  return _inflight
}

/** 清缓存（退出登录 / 切租户时调）。 */
function clearPerms() {
  try { wx.removeStorageSync(CACHE_KEY) } catch (e) { }
}

module.exports = { loadPerms, peekPerms, readCache, clearPerms, canReportFrom: _canReportFrom, CACHE_KEY }
