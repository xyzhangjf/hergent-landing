const app = getApp()
const { request } = require('../../utils/api')
const { track, pageView, EVENTS } = require('../../utils/track')
const { isApprover, roleText } = require('../../utils/roles')

const STATUS_TEXT = {
  pending: '待审批',
  approved: '已通过',
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
      canManage: isApprover(u.role)        // 二期: 审批/汇总入口布尔化，wxml 不再硬编码 role
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
  // 撤回（仅本人 pending 可撤回，后端二次校验）——loading 按单条 id 防整页闪烁
  async recall(e) {
    const id = +e.currentTarget.dataset.id
    if (this.data.recallingId) return
    const ok = await new Promise(res => wx.showModal({
      title: '撤回预报单',
      content: '撤回后该预报单将不再进入汇总与审批，确定撤回？',
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
    app.globalData.token = ''
    app.globalData.user = null
    app.globalData.tenantId = ''
    wx.removeStorageSync('fs_token')
    wx.removeStorageSync('fs_user')
    wx.removeStorageSync('fs_tenant_id')
    // E2 + 二期: 清除本机会话偏好 + 按门店/期次隔离的购物车与快照（fs_cart_*/fs_last_cart_*/fs_sub_*），
    // 避免退出后残留导致下一个账号串店/看到上个账号的上次报单
    try {
      const info = wx.getStorageInfoSync()
      const keys = (info && info.keys) || []
      for (const k of keys) {
        if (k === 'fs_cart' || k === 'fs_period_id' || k === 'fs_store_id' || k === 'fs_redirect' ||
            k.indexOf('fs_cart_') === 0 || k.indexOf('fs_last_cart_') === 0 || k.indexOf('fs_sub_') === 0) {
          wx.removeStorageSync(k)
        }
      }
    } catch (e) { console.warn('[mine] logout cleanup failed:', e) }
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
