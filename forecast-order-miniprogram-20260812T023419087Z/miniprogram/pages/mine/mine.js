const app = getApp()
const { request } = require('../../utils/api')
const { track, pageView, EVENTS } = require('../../utils/track')

const STATUS_TEXT = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  recalled: '已撤回'
}

Page({
  data: { user: {}, records: [], expandedId: 0, recalling: false },
  onShow() {
    pageView('mine')
    const token = app.globalData.token || wx.getStorageSync('fs_token')
    if (!token) { wx.reLaunch({ url: '/pages/login/login' }); return }
    this.setData({ user: app.globalData.user || {} })
    this.load()
  },
  async load() {
    try {
      const d = await request('/api/forecast-submissions/my')
      const records = (d.records || []).map(r => ({ ...r, statusText: STATUS_TEXT[r.status] || r.status || '' }))
      this.setData({ records })
    } catch (e) { wx.showToast({ title: e.message, icon: 'none' }) }
  },
  // 展开/收起明细
  goApproval() {
    wx.navigateTo({ url: '/pages/approval/approval' })
  },
  goSummary() {
    wx.navigateTo({ url: '/pages/summary/summary' })
  },
  toggleExpand(e) {
    const id = +e.currentTarget.dataset.id
    this.setData({ expandedId: this.data.expandedId === id ? 0 : id })
  },
  // 撤回（仅本人 pending 可撤回，后端二次校验）
  async recall(e) {
    const id = +e.currentTarget.dataset.id
    if (this.data.recalling) return
    const ok = await new Promise(res => wx.showModal({
      title: '撤回预报单',
      content: '撤回后该预报单将不再进入汇总与审批，确定撤回？',
      confirmText: '撤回', cancelText: '取消',
      success: r => res(r.confirm)
    }))
    if (!ok) return
    this.setData({ recalling: true })
    try {
      await request(`/api/forecast-submissions/${id}/recall`, 'POST', {})
      track(EVENTS.RECALL, { id })
      wx.showToast({ title: '已撤回', icon: 'success' })
      this.setData({ expandedId: 0 })
      this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '撤回失败', icon: 'none' })
    } finally {
      this.setData({ recalling: false })
    }
  },
  logout() {
    app.globalData.token = ''
    app.globalData.user = null
    app.globalData.tenantId = ''
    wx.removeStorageSync('fs_token')
    wx.removeStorageSync('fs_user')
    wx.removeStorageSync('fs_tenant_id')
    // E2: 清除本机会话偏好，避免退出后残留门店/期次/购物车/重定向上下文导致串店或越权
    wx.removeStorageSync('fs_period_id')
    wx.removeStorageSync('fs_store_id')
    wx.removeStorageSync('fs_cart')
    wx.removeStorageSync('fs_redirect')
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
