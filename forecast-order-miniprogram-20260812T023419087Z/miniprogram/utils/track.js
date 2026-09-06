/* 轻量埋点：基于微信原生 wx.reportAnalytics（公众平台「自定义分析」开启后生效，
   未开启时静默 no-op，不报错）。无独立后端，零依赖。 */
const EVENTS = {
  APP_LAUNCH: 'app_launch',
  LOGIN: 'login_success',
  LOGIN_FAIL: 'login_fail',
  SUBMIT: 'submit_success',
  SUBMIT_FAIL: 'submit_fail',
  APPROVE: 'approve_action',
  REJECT: 'reject_action',
  RECALL: 'recall_action',
  PAGE_VIEW: 'page_view',
  API_ERROR: 'api_error'
}

function track(event, data = {}) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.reportAnalytics === 'function') {
      wx.reportAnalytics(event, data)
    } else {
      console.log('[track]', event, data)
    }
  } catch (e) {
    // 埋点失败绝不影响主流程
    console.warn('[track] failed:', e)
  }
}

function reportError(message, ctx = '') {
  console.error('[error]', ctx, message)
  track(EVENTS.API_ERROR, { msg: String(message).slice(0, 120), ctx: String(ctx).slice(0, 60) })
}

function pageView(page) {
  track(EVENTS.PAGE_VIEW, { page: String(page || '') })
}

module.exports = { track, reportError, pageView, EVENTS }
