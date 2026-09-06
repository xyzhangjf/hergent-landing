const app = getApp()
const { request } = require('../../utils/api')
const { track, EVENTS } = require('../../utils/track')

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
      // M12: 已登录但带重定向目标（如 401 回跳）则跳回原页面
      const redirect = wx.getStorageSync('fs_redirect')
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
      // M12: 登录成功后回跳原页面（401 场景），否则进填报页
      const redirect = this.redirect || wx.getStorageSync('fs_redirect')
      wx.removeStorageSync('fs_redirect')
      wx.reLaunch({ url: redirect || '/pages/fill/fill' })
      track(EVENTS.LOGIN, { role: (d.user && d.user.role) || '' })
    } catch (e) {
      track(EVENTS.LOGIN_FAIL, { msg: (e.message || '登录失败').slice(0, 80) })
      this.setData({ error: e.message || '登录失败' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
