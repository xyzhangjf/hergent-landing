const app = getApp()
const { request } = require('../../utils/api')
const { track, pageView, EVENTS } = require('../../utils/track')

const APPROVER_ROLES = ['admin', 'boss', 'accountant', 'supervisor']

Page({
  data: { list: [], loading: false, noAuth: false, acting: 0 },
  onShow() {
    pageView('approval')
    const token = app.globalData.token || wx.getStorageSync('fs_token')
    const role = (app.globalData.user && app.globalData.user.role) || wx.getStorageSync('fs_user').role || ''
    if (!token) { wx.reLaunch({ url: '/pages/login/login' }); return }
    if (APPROVER_ROLES.indexOf(role) < 0) {
      this.setData({ noAuth: true, list: [] })
      return
    }
    this.load()
  },
  async load() {
    this.setData({ loading: true })
    try {
      const d = await request('/api/forecast-submissions/pending')
      this.setData({ list: d.records || [], noAuth: false })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  async approve(e) {
    const id = +e.currentTarget.dataset.id
    if (this.data.acting) return
    this.setData({ acting: id })
    try {
      await request(`/api/forecast-submissions/${id}/approve`, 'POST', {})
      track(EVENTS.APPROVE, { id })
      wx.showToast({ title: '已通过', icon: 'success' })
      this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ acting: 0 })
    }
  },
  async reject(e) {
    const id = +e.currentTarget.dataset.id
    if (this.data.acting) return
    const r = await new Promise(res => wx.showModal({
      title: '驳回预报单',
      editable: true,
      placeholderText: '驳回原因（选填）',
      success: m => res(m.confirm ? (m.content || '') : null)
    }))
    if (r === null) return
    this.setData({ acting: id })
    try {
      await request(`/api/forecast-submissions/${id}/reject`, 'POST', { reason: r })
      track(EVENTS.REJECT, { id })
      wx.showToast({ title: '已驳回', icon: 'success' })
      this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ acting: 0 })
    }
  }
})
