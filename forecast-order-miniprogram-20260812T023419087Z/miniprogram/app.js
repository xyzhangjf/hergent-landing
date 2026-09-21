const { track, flush, EVENTS } = require('./utils/track')

App({
  globalData: {
    apiBase: 'https://hergent.cn',
    token: '',
    user: null,
    tenantId: ''
  },
  onLaunch() {
    const t = wx.getStorageSync('fs_token')
    const u = wx.getStorageSync('fs_user')
    const tid = wx.getStorageSync('fs_tenant_id')
    if (t) {
      this.globalData.token = t
      this.globalData.user = u || null
      this.globalData.tenantId = tid || ''
    }
    // v211（2026-09-20）：埋点改为上报自建后端。启动即补传上次遗留的队列
    // —— `onHide` 里那次 flush 可能因为进程被立刻回收而没发出去。
    track(EVENTS.APP_LAUNCH, { has_token: t ? 1 : 0 })
    flush()
    this.checkUpdate()
  },
  onShow() {
    // 回到前台：把离线期间攒下的事件送一次
    flush()
  },
  onHide() {
    // 退到后台：小程序可能被随时回收，这是最可靠的发送时机
    flush()
  },
  /* P0-1: 版本更新检测——有新版本提示重启，避免老用户永远停在旧版 */
  checkUpdate() {
    if (!wx.canIUse('getUpdateManager')) return
    const um = wx.getUpdateManager()
    um.onUpdateReady(() => {
      wx.showModal({
        title: '发现新版本',
        content: '新版本已准备好，重启后即可使用最新功能。',
        confirmText: '立即重启',
        cancelText: '稍后再说',
        confirmColor: '#06b6d4',
        success: (r) => { if (r.confirm) um.applyUpdate() }
      })
    })
    um.onUpdateFailed(() => {
      // 静默：新版拉取失败（弱网），下次启动再试，不打扰用户
      console.warn('[app] update download failed')
    })
  }
})
