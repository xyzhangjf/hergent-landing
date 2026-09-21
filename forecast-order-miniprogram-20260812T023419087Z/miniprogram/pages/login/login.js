const app = getApp()
const { request } = require('../../utils/api')
const { track, flush, EVENTS } = require('../../utils/track')
const { loadPerms, peekPerms } = require('../../utils/perm')

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    error: '',
    showPrivacy: false,          // A3: 隐私同意弹窗
    privacyAgreed: false
  },
  redirect: '',
  onLoad(options) {
    // F2 修复：已登录用户打开 App 直接进填报页，不再见空登录框
    const token = app.globalData.token || wx.getStorageSync('fs_token')
    if (token) {
      // Q29（2026-09-19）：首次改密没做完就杀掉小程序再重进时，storage 里的 token 仍在 ——
      // 若只看 token 就放行进填报页，强制改密这道闸就被绕过了。故优先拦回改密页。
      if (wx.getStorageSync('fs_need_pwd_change')) {
        wx.reLaunch({ url: '/pages/password/password?force=1' })
        return
      }
      // M12: 已登录但带重定向目标（如 401 回跳）则跳回原页面
      const redirect = wx.getStorageSync('fs_redirect')
      // P0-2（2026-09-20）：已登录用户也要过权限闸 —— 角色可能在别处被改过。
      // 先用**缓存**判（零请求、无闪烁）：已确认无权限就直接进无权限页。
      const cached = peekPerms()
      if (cached.known && !cached.canReport) {
        if (redirect) wx.removeStorageSync('fs_redirect')
        wx.reLaunch({ url: '/pages/no-permission/no-permission' })
        return
      }
      if (redirect) { wx.removeStorageSync('fs_redirect'); wx.reLaunch({ url: redirect }) }
      else wx.reLaunch({ url: '/pages/fill/fill' })
      return
    }
    // M12: 记录重定向目标（来自 401 回跳或页面传入）
    this.redirect = (options && options.redirect) || wx.getStorageSync('fs_redirect') || ''
    // A3: 未同意隐私指引则拦截登录，弹窗要求先同意
    if (!wx.getStorageSync('fs_privacy_agreed')) {
      this.setData({ showPrivacy: true, privacyAgreed: false })
      // 若微信侧要求授权（公众平台已配置隐私指引），同步走官方授权流程
      if (typeof wx.getPrivacySetting === 'function') {
        wx.getPrivacySetting({
          success: (res) => {
            if (res && res.needAuthorization) {
              // 官方隐私授权（native 弹窗）；用户确认后写入本地同意标记
              if (typeof wx.requirePrivacyAuthorize === 'function') {
                wx.requirePrivacyAuthorize({
                  success: () => this.onAgreePrivacy(),
                  fail: () => {}
                })
              }
            }
          },
          fail: () => {}
        })
      }
    } else {
      this.setData({ privacyAgreed: true })
    }
  },
  onUsername(e) { this.setData({ username: e.detail.value }) },
  onPassword(e) { this.setData({ password: e.detail.value }) },
  // Q29（2026-09-19）：忘记密码 —— 用管理员发放的重置码自助重置（免登录路径）
  goForgot() { wx.navigateTo({ url: '/pages/forgot/forgot' }) },
  // P0（2026-09-19）：协议查阅入口。登录页常驻，已同意过的用户同样可点 ——
  // 此前协议只存在于一次性弹窗里，同意后再无处可查。
  goTerms() { wx.navigateTo({ url: '/pages/legal/terms' }) },
  goPrivacy() { wx.navigateTo({ url: '/pages/legal/privacy' }) },
  noop() {}, // A3: 阻断弹窗内部点击冒泡到遮罩
  // A3: 同意隐私指引
  onAgreePrivacy() {
    wx.setStorageSync('fs_privacy_agreed', '1')
    this.setData({ showPrivacy: false, privacyAgreed: true })
  },
  // A3: 不同意 —— 不能进入，提示后保持弹窗
  onDisagreePrivacy() {
    wx.showModal({
      title: '需同意后方可使用',
      content: '使用本程序需同意《隐私保护指引》。如不同意，将无法登录使用预报功能。',
      showCancel: false,
      confirmText: '我知道了'
    })
  },
  async login() {
    // A3: 双重保险——未同意不允许登录
    if (!wx.getStorageSync('fs_privacy_agreed')) {
      this.setData({ showPrivacy: true })
      return
    }
    const { username, password } = this.data
    if (!username || !password) { this.setData({ error: '请输入账号和密码' }); return }
    this.setData({ loading: true, error: '' })
    try {
      const d = await request('/api/auth/login', 'POST', { username, password })
      app.globalData.token = d.token
      app.globalData.user = d.user || {}
      app.globalData.tenantId = d.tenant_id || ''
      wx.setStorageSync('fs_token', d.token)
      wx.setStorageSync('fs_user', d.user || {})
      wx.setStorageSync('fs_tenant_id', d.tenant_id || '')
      track(EVENTS.LOGIN, { role: (d.user && d.user.role) || '' })
      flush()   // v211: 拿到 token 了，把登录前攒下的队列（app_launch / login_fail）一次性补传
      // Q29（2026-09-19）：密码仍是系统初始密码（password_changed=0）→ 必须先改密，
      // 不允许直接进填报页。与网页端 Login.vue 的强制改密弹窗对齐 ——
      // 此前小程序**完全没读** require_password_change 这个字段，
      // 于是这道闸在小程序侧形同虚设（员工带着初始密码一直用）。
      // 原密码暂存内存供改密页复用，不写 storage（避免明文密码留存在本机）。
      if (d.require_password_change) {
        app.globalData.loginPw = password
        wx.setStorageSync('fs_need_pwd_change', '1')
        wx.reLaunch({ url: '/pages/password/password?force=1' })
        return
      }
      wx.removeStorageSync('fs_need_pwd_change')
      // P0-2（2026-09-20）：**权限闸**。登录成功 ≠ 能用 —— 认证走 `/api/auth`（在
      // `_PUBLIC_PATHS`，RBAC 豁免），而业务端点按中间件的**模块**判据放行，小程序 7 个
      // 业务端点全映射 `data`；`accountant`/`guide`/`driver` 没有 `data` ⇒ 登得进、干不了。
      // 这里问一次后端（`/api/auth/permissions`），无权限就进**说明清楚**的页面，
      // 而不是把人扔进一个到处报错的填报页。
      // ⚠️ 放在强制改密之后：初始密码必须换（账号在网页端同样可用），不能因为无报单权限
      //    就跳过改密。
      const perm = await loadPerms(true)
      track(EVENTS.LOGIN_PERM, { role: perm.role || '', can_report: perm.canReport ? 1 : 0 })
      if (perm.known && !perm.canReport) {
        wx.reLaunch({ url: '/pages/no-permission/no-permission' })
        return
      }
      // M12: 登录成功后回跳原页面（401 场景），否则进填报页
      const redirect = this.redirect || wx.getStorageSync('fs_redirect')
      wx.removeStorageSync('fs_redirect')
      wx.reLaunch({ url: redirect || '/pages/fill/fill' })
    } catch (e) {
      track(EVENTS.LOGIN_FAIL, { msg: (e.message || '登录失败').slice(0, 80) })
      this.setData({ error: e.message || '登录失败' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
