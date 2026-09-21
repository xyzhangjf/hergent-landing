const { pageView, statDisabled, OPT_OUT_KEY } = require('../../utils/track')
const { logout: doLogout } = require('../../utils/session')

// 隐私设置页（P0 2026-09-19）
// 承载：协议查阅、非必要信息（使用统计）开关、撤回同意、注销途径说明。
Page({
  data: { statOn: false },

  onLoad() {
    pageView('privacy_settings')
  },

  onShow() {
    this.setData({ statOn: !statDisabled() })
  },

  goPrivacy() { wx.navigateTo({ url: '/pages/legal/privacy' }) },
  goTerms() { wx.navigateTo({ url: '/pages/legal/terms' }) },

  // 非必要信息开关：关 = 写 opt-out 标记，utils/track.js 由此不再上报 wx.reportAnalytics
  onStat(e) {
    const on = !!(e.detail && e.detail.value)
    try {
      if (on) wx.removeStorageSync(OPT_OUT_KEY)
      else wx.setStorageSync(OPT_OUT_KEY, '1')
    } catch (err) {
      console.warn('[privacy] stat toggle failed:', err)
    }
    this.setData({ statOn: on })
    wx.showToast({ title: on ? '已开启统计' : '已关闭统计', icon: 'none' })
  },

  // 撤回同意：清同意标记 + 一并关闭非必要项 + 退出登录态，使登录页重新弹出协议弹窗。
  // 本地清理口径与 mine.js 的 logout 保持一致（token / user / tenant + 按门店期次隔离的
  // 购物车与快照缓存），避免撤回后残留上个账号的报单草稿。
  async revoke() {
    const ok = await new Promise(res => wx.showModal({
      title: '撤回隐私同意',
      content: '撤回后将退出登录，需重新阅读并同意隐私政策才能继续使用。确定撤回？',
      confirmText: '撤回',
      cancelText: '取消',
      success: r => res(r.confirm)
    }))
    if (!ok) return

    try {
      wx.setStorageSync(OPT_OUT_KEY, '1')      // 撤同一揽子同意时，非必要项一并关掉
      wx.removeStorageSync('fs_privacy_agreed') // 关键：清掉它登录页才会重新弹窗
      // P1-1（2026-09-20）：会话清理改走 `utils/session.js` —— 除本机清态外**同时通知服务端
      // 销毁会话**。撤回同意后旧 token 若还能用 24 小时，与「撤回」二字的含义直接冲突。
      // 注意顺序：`doLogout` 要**先读 token 再清**，故必须在这些 removeStorage 之前调用。
      doLogout()
      const info = wx.getStorageInfoSync()
      const keys = (info && info.keys) || []
      for (const k of keys) {
        if (k === 'fs_cart' || k === 'fs_period_id' ||
            k.indexOf('fs_cart_') === 0 || k.indexOf('fs_last_cart_') === 0 || k.indexOf('fs_sub_') === 0) {
          wx.removeStorageSync(k)
        }
      }
    } catch (err) {
      console.warn('[privacy] revoke cleanup failed:', err)
    }

    // `app.globalData` 的重置已由 `doLogout()` 完成，此处不再重复

    wx.showToast({ title: '已撤回同意', icon: 'none' })
    setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 600)
  }
})
