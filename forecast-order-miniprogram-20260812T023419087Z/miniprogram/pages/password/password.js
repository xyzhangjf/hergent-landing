/* 修改密码（两个场景共用本页）
   1. 日常改密：从「我的」页进入，需输入原密码；
   2. 首次登录强制改密：登录响应 require_password_change=true 时 reLaunch 到
      ?force=1，**不可跳过**（不显示返回按钮，成功后直接进填报页）。

   🔴 强制模式为什么还要处理「没有原密码」的情况：
   登录页把刚输入的原密码暂存在 app.globalData.loginPw（内存，不落盘）供本页复用，
   但用户完全可能在改密前**杀掉小程序**再重进 —— 此时 globalData 已清空，
   而 storage 里的 token 仍在。若 login 页只看 token 就放行进填报页，
   这道闸就被绕过了，所以：
     a) 登录成功时把 `fs_need_pwd_change` 落 storage，改密成功才清除；
     b) login 页 onLoad 见到该标记仍拦回本页；
     c) 本页在拿不到暂存原密码时，把「原密码」输入框显示出来让用户自己填。
   三者缺一，强制改密都只是"看起来有"。 */
const app = getApp()
const { request } = require('../../utils/api')
const { track, pageView, EVENTS } = require('../../utils/track')

Page({
  data: {
    force: false,      // true = 首次登录强制改密（不可跳过）
    needOld: true,     // 是否显示「原密码」输入框
    oldPw: '',
    newPw: '',
    newPw2: '',
    error: '',
    saving: false
  },
  onLoad(options) {
    pageView('password')
    const token = app.globalData.token || wx.getStorageSync('fs_token')
    if (!token) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const force = String((options && options.force) || '') === '1' ||
                  !!wx.getStorageSync('fs_need_pwd_change')
    // 强制模式下若登录时暂存过原密码，就不必让用户再敲一遍
    const cached = force ? (app.globalData.loginPw || '') : ''
    this.setData({ force, oldPw: cached, needOld: !cached })
  },
  onOld(e) { this.setData({ oldPw: e.detail.value }) },
  onNew(e) { this.setData({ newPw: e.detail.value }) },
  onNew2(e) { this.setData({ newPw2: e.detail.value }) },
  back() { wx.navigateBack({ delta: 1 }) },
  async submit() {
    const { force, oldPw, newPw, newPw2 } = this.data
    const np = (newPw || '').trim()
    const op = (oldPw || '').trim()
    // 校验顺序与后端 _validate_password 对齐，先在本地拦一道少一次往返
    if (!op) { this.setData({ error: '请输入原密码' }); return }
    if (!np) { this.setData({ error: '请输入新密码' }); return }
    if (np.length < 8) { this.setData({ error: '密码至少需要 8 位' }); return }
    if (!(/[0-9]/.test(np) && /[a-zA-Z]/.test(np))) { this.setData({ error: '密码需要同时包含数字和字母' }); return }
    if (np !== (newPw2 || '').trim()) { this.setData({ error: '两次输入的新密码不一致' }); return }
    if (np === op) { this.setData({ error: '新密码不能与原密码相同' }); return }

    this.setData({ saving: true, error: '' })
    try {
      await request('/api/auth/password', 'POST', { old_password: op, new_password: np })
      // 后端已置 password_changed=1，并删除该用户其它会话（保留当前会话）
      app.globalData.loginPw = ''
      wx.removeStorageSync('fs_need_pwd_change')
      track(EVENTS.PASSWORD, { act: force ? 'first_change' : 'change' })
      wx.showToast({ title: '密码已修改', icon: 'success' })
      setTimeout(() => {
        if (force) wx.reLaunch({ url: '/pages/fill/fill' })
        else wx.navigateBack({ delta: 1 })
      }, 700)
    } catch (e) {
      this.setData({ error: e.message || '修改密码失败' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
