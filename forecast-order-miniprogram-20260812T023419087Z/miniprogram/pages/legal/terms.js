const { pageView } = require('../../utils/track')

// 用户服务协议页（微信小程序版）
// 正文静态写在 terms.wxml 中，本文件只负责埋点与返回。
Page({
  onLoad() {
    pageView('legal_terms')
  },
  back() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/login/login' })
  }
})
