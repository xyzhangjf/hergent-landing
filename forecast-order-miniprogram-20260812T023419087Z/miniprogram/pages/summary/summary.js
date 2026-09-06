const app = getApp()
const { request } = require('../../utils/api')

Page({
  data: { rows: [], date: '' },
  onShow() {
    const token = app.globalData.token || wx.getStorageSync('fs_token')
    if (!token) { wx.reLaunch({ url: '/pages/login/login' }); return }
    this.load()
  },
  async load() {
    try {
      const q = this.data.date ? `?date=${this.data.date}` : ''
      const d = await request('/api/forecast-submissions/summary' + q)
      this.setData({ rows: d.rows || [] })
    } catch (e) {
      if (e.message && e.message.includes('权限')) {
        wx.showToast({ title: '仅老板/管理员可看汇总', icon: 'none' })
      } else {
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      }
    }
  },
  onDate(e) {
    this.setData({ date: e.detail.value })
    this.load()
  },
  copyAll() {
    const { rows } = this.data
    if (!rows.length) { wx.showToast({ title: '没有数据可复制', icon: 'none' }); return }
    let text = '预报汇总总表 ' + (this.data.date || '今日') + '\n'
    text += '商品\t单位\t合计\tAI建议\n'
    for (const r of rows) {
      const ai = (r.ai_suggested_qty !== null && r.ai_suggested_qty !== undefined) ? r.ai_suggested_qty : ''
      text += `${r.product_name}${r.spec ? '(' + r.spec + ')' : ''}\t${r.unit}\t${r.total_qty}\t${ai}\n`
    }
    // 来源明细
    text += '\n来源明细\n'
    text += '角色\t门店\t商品\t数量\n'
    for (const r of rows) {
      for (const s of r.sources || []) {
        text += `${s.role || ''}\t${s.store || ''}\t${r.product_name}${r.spec ? '(' + r.spec + ')' : ''}(${r.unit})\t${s.qty}\n`
      }
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制完整表格', icon: 'success' })
    })
  }
})
