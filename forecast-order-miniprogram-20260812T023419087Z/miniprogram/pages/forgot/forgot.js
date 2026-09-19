/* 忘记密码 · 用管理员发放的一次性重置码自助重置

   🔴 本页走的是**免登录**路径，调 /api/auth/forgot-reset 时本来也没有 token
   （用户很可能正是因为登不进来才来这里）。后端已把该路径列进 CSRF 白名单，
   因为未登录请求既无 Bearer 也无 CSRF cookie，否则会被 403 掉。

   为什么是"向管理员要一个码"而不是短信/微信手机号：短信网关是占位域名、
   生产没有真实手机号，而手机号还会牵动已提交的隐私申报与备案材料。
   管理员只发码、不知道员工最终设了什么密码 —— 责任边界比"管理员代改"清楚。 */
const { request } = require('../../utils/api')
const { track, pageView, EVENTS } = require('../../utils/track')

Page({
  data: { username: '', code: '', newPw: '', newPw2: '', error: '', saving: false },
  onLoad() {
    pageView('forgot')
  },
  onUser(e) { this.setData({ username: e.detail.value }) },
  onCode(e) { this.setData({ code: e.detail.value }) },
  onNew(e) { this.setData({ newPw: e.detail.value }) },
  onNew2(e) { this.setData({ newPw2: e.detail.value }) },
  back() { wx.reLaunch({ url: '/pages/login/login' }) },
  async submit() {
    const username = (this.data.username || '').trim()
    const code = (this.data.code || '').trim()
    const np = (this.data.newPw || '').trim()
    // 本地先拦一道，与后端 _validate_password 规则一致，省一次往返
    if (!username) { this.setData({ error: '请输入账号' }); return }
    if (!code) { this.setData({ error: '请输入重置码' }); return }
    if (np.length < 8) { this.setData({ error: '密码至少需要 8 位' }); return }
    if (!(/[0-9]/.test(np) && /[a-zA-Z]/.test(np))) { this.setData({ error: '密码需要同时包含数字和字母' }); return }
    if (np !== (this.data.newPw2 || '').trim()) { this.setData({ error: '两次输入的新密码不一致' }); return }

    this.setData({ saving: true, error: '' })
    try {
      await request('/api/auth/forgot-reset', 'POST',
                    { username, code, new_password: np })
      track(EVENTS.PASSWORD, { act: 'forgot_reset' })
      // 后端已清空该账号全部会话 —— 所有设备都需要用新密码重新登录
      wx.showModal({
        title: '密码已重置',
        content: '请用新密码重新登录。',
        showCancel: false,
        confirmText: '去登录',
        success: () => wx.reLaunch({ url: '/pages/login/login' })
      })
    } catch (e) {
      this.setData({ error: e.message || '重置失败，请重试' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
