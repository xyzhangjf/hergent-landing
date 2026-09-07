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
    this.checkUpdate()
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
