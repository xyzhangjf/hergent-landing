const { pageView } = require('../../utils/track')

// 隐私政策页（微信小程序版）
// 正文全部写在 privacy.wxml 里（静态结构、零运行时拼接），本文件只负责埋点与返回。
// 之所以不放 JS 字符串数组再 wx:for 渲染：协议页要能被审核员直接看懂渲染结果，
// 静态 wxml 也便于 .workbuddy/tools/miniprogram-legal-consistency-check.py 做文本比对。
Page({
  onLoad() {
    pageView('legal_privacy')
  },
  back() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/login/login' })
  }
})
