const { track, flush, EVENTS } = require('./utils/track')
const { loadPerms } = require('./utils/perm')

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
    // v307：顺带**按需**刷新权限（缓存未过期则不会真的发请求，见 `loadPerms` 的 TTL 逻辑）。
    //   为什么加这一条：管理员在网页端改了某角色的权限后，小程序侧原来**最多要等 5 分钟**
    //   （缓存 TTL），而用户看到的是"网页端改了、手机没变"。
    //   🔴 刻意 `force=false`：小程序没有"切标签页"这种高频时机，若每次回前台都强拉，
    //      一天几十次请求纯属浪费；TTL 过期才真拉，既对齐网页端又省流量。
    //   🔴 失败静默（loadPerms 永不 reject 且 fail-open）：一次刷新失败不该打扰用户。
    if (this.globalData.token) loadPerms(false)
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
