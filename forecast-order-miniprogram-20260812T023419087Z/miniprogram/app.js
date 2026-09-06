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
  }
})
