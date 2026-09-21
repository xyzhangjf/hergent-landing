const app = getApp()
const { request } = require('../../utils/api')
const { track, pageView, EVENTS } = require('../../utils/track')
const { isApprover, roleText } = require('../../utils/roles')
const { logout: doLogout } = require('../../utils/session')

// 2026-09-07：审批模块下线后，pending 不再表示「等人审批」，而是「已提交并计入本期汇总」
const STATUS_TEXT = {
  pending: '已提交',
  approved: '已定稿',
  rejected: '已驳回',
  recalled: '已撤回'
}

Page({
  data: { user: {}, avatarChar: '', roleName: '', canManage: false, records: [], expandedId: 0, recallingId: 0 },
  onShow() {
    pageView('mine')
    const token = app.globalData.token || wx.getStorageSync('fs_token')
    if (!token) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const u = app.globalData.user || {}
    // WXML Mustache 不支持 (expr)[0] 索引语法，这里算出首字再渲染
    const name = u.display_name || u.username || '员'
    this.setData({
      user: u,
      avatarChar: (name || '员').slice(0, 1),
      roleName: roleText(u.role),          // 二期: 角色中文名（单一事实源 utils/roles.js）
      canManage: isApprover(u.role)        // 汇总入口布尔化（审批模块已下线），wxml 不再硬编码 role
    })
    this.load()
  },
  /* 二期: 下拉刷新 */
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },
  async load() {
    try {
      const d = await request('/api/forecast-submissions/my?limit=50')
      const records = (d.records || []).map(r => ({ ...r, statusText: STATUS_TEXT[r.status] || r.status || '' }))
      this.setData({ records })
    } catch (e) { wx.showToast({ title: e.message, icon: 'none' }) }
  },
  // 展开/收起明细
  goSummary() {
    wx.navigateTo({ url: '/pages/summary/summary' })
  },
  // Q29（2026-09-19）：小程序内自助改密 —— 业务员 / 分销商 / 导购可能只登小程序、
  // 不分配网页端权限，改密不能只依赖网页端
  goPassword() {
    wx.navigateTo({ url: '/pages/password/password' })
  },
  // P0（2026-09-19）：隐私设置入口 —— 协议查阅 / 撤回同意 / 非必要信息开关
  goPrivacySettings() {
    wx.navigateTo({ url: '/pages/privacy-settings/privacy-settings' })
  },
  toggleExpand(e) {
    const id = +e.currentTarget.dataset.id
    this.setData({ expandedId: this.data.expandedId === id ? 0 : id })
  },
  // 撤回（仅本人 pending 可撤回，后端二次校验）——loading 按单条 id 防整页闪烁
  async recall(e) {
    const id = +e.currentTarget.dataset.id
    if (this.data.recallingId) return
    const ok = await new Promise(res => wx.showModal({
      title: '撤回预报单',
      content: '撤回后该预报单将不再进入本期汇总，确定撤回？',
      confirmText: '撤回', cancelText: '取消',
      success: r => res(r.confirm)
    }))
    if (!ok) return
    this.setData({ recallingId: id })
    try {
      await request(`/api/forecast-submissions/${id}/recall`, 'POST', {})
      track(EVENTS.RECALL, { id })
      wx.showToast({ title: '已撤回', icon: 'success' })
      this.setData({ expandedId: 0 })
      this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '撤回失败', icon: 'none' })
    } finally {
      this.setData({ recallingId: 0 })
    }
  },
  logout() {
    // P1-1（2026-09-20）：改走 `utils/session.js` —— 除本机清态外**同时通知服务端销毁会话**。
    // 原实现只清本机（全仓 `/api/auth/logout` **0 命中**）⇒ 点过「退出」的 token 在服务端
    // 仍可继续使用最长 24 小时；手机丢失/借用场景下，「退出」必须真的让 token 失效。
    // 下面那段「按门店/期次隔离的购物车与快照」清理保持原样（它是本机隐私清理，与会话无关）。
    doLogout({
      success: () => {
        try {
          const info = wx.getStorageInfoSync()
          const keys = (info && info.keys) || []
          for (const k of keys) {
            if (k === 'fs_cart' || k === 'fs_period_id' ||
                k.indexOf('fs_cart_') === 0 || k.indexOf('fs_last_cart_') === 0 || k.indexOf('fs_sub_') === 0) {
              wx.removeStorageSync(k)
            }
          }
        } catch (e) { console.warn('[mine] logout cleanup failed:', e) }
        wx.reLaunch({ url: '/pages/login/login' })
      }
    })
  }
})
