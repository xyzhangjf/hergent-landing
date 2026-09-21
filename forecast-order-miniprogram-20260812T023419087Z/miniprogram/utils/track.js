/* 埋点（2026-09-20 用户拍板 B：**后端自建 `/api/track`**，替代微信原生统计）。
 *
 * 为什么换掉 `wx.reportAnalytics`：它的价值上限是「看一眼聚合数」，而埋点真正要回答的是
 * 「**谁**（哪个角色 / 哪个租户）卡在**哪一步**」—— 平台侧数据既拿不回来，也无法与租户、
 * 角色对齐；还得先在公众平台开「自定义分析」才生效（未开则静默退化成 console，
 * 实测悬空 13 天、小程序侧零可见度）。自建后：`POST /api/track` 落本租户 `mp_events`，
 * 读端 `GET /api/track/stats` 出「按角色 / 按事件 / 按人」。
 *
 * ⚠️ 本文件**不得 require `./api`** —— `api.js` 顶部 require 了本文件，反向依赖会成环
 *    （小程序 CommonJS 循环引用会拿到不完整导出，症状是埋点莫名 no-op）。
 *    故这里直接用 `wx.request`，并自行取 token / 租户头。
 *
 * ⚠️ 隐私口径（改这里必须同步改文案）：本模块把事件**上报到我们自己的服务器**，
 *    不再是「由微信平台处理、我们仅看聚合」。所以这些文案必须同步：
 *      · `pages/legal/privacy.wxml` 第四节
 *      · `pages/login/login.wxml` 的同意弹窗「非必要信息」段
 *      · `pages/privacy-settings/privacy-settings.wxml` 开关说明
 *    改漏一处 = 界面在骗用户（审计铁律：多申报与少申报都判风险）。
 *
 * 纪律：
 *   ① `fs_stat_opt_out` 为真时**不入队**（不是「攒着以后再发」）—— 承诺了能关就必须真关。
 *   ② 上报失败**保留队列**重试，但队列封顶（丢最旧的），避免离线时无限膨胀。
 *   ③ 埋点永不抛异常、永不阻塞主流程（全部包在 try 里，异步发送）。
 *   ④ 登录前的事件（隐私弹窗、登录失败）也入队 —— 登录成功后自然补传，
 *      否则「登录失败率」这个最该看的指标永远收不到。
 */
const OPT_OUT_KEY = 'fs_stat_opt_out'
const QUEUE_KEY = 'fs_track_q'
const MAX_QUEUE = 120      // 队列上限（条）
const BATCH = 20           // 单批上报条数（后端上限 50）
const MIN_GAP = 8000       // 两次上报最小间隔（ms），避免每次点击都打一次网络

function statDisabled() {
  try { return wx.getStorageSync(OPT_OUT_KEY) === '1' } catch (e) { return false }
}

const EVENTS = {
  APP_LAUNCH: 'app_launch',
  LOGIN: 'login_success',
  LOGIN_FAIL: 'login_fail',
  LOGIN_PERM: 'login_perm',        // 2026-09-20：登录后拿到的权限判定（can_report=0 即撞墙人群）
  SUBMIT: 'submit_success',
  SUBMIT_FAIL: 'submit_fail',
  APPROVE: 'approve_action',
  REJECT: 'reject_action',
  RECALL: 'recall_action',
  PAGE_VIEW: 'page_view',
  NO_PERMISSION_VIEW: 'no_permission_view',   // 无权限页曝光
  PASSWORD: 'password_action',
  API_ERROR: 'api_error'
}

const MAX_PROP = 400       // 单条 props 的 JSON 长度上限（与服务端 512 字节对齐，留余量）

function _base() {
  try { const a = getApp(); return (a && a.globalData && a.globalData.apiBase) || 'https://hergent.cn' }
  catch (e) { return 'https://hergent.cn' }
}
function _auth() {
  let token = '', tid = ''
  try {
    const a = getApp()
    token = (a && a.globalData && a.globalData.token) || ''
    tid = (a && a.globalData && a.globalData.tenantId) || ''
  } catch (e) { /* App 未就绪 */ }
  try {
    if (!token) token = wx.getStorageSync('fs_token') || ''
    if (!tid) tid = wx.getStorageSync('fs_tenant_id') || ''
  } catch (e) { /* ignore */ }
  return { token: token, tid: tid }
}
function _readQ() {
  try { const q = wx.getStorageSync(QUEUE_KEY); return Array.isArray(q) ? q : [] } catch (e) { return [] }
}
function _writeQ(q) {
  try { wx.setStorageSync(QUEUE_KEY, q.slice(-MAX_QUEUE)) } catch (e) { /* ignore */ }
}

function _curPage() {
  try {
    const ps = getCurrentPages()
    const p = ps && ps[ps.length - 1]
    return (p && p.route) || ''
  } catch (e) { return '' }
}

let _timer = null
let _sending = false

function _schedule() {
  if (_timer) return
  _timer = setTimeout(() => { _timer = null; flush() }, MIN_GAP)
}

/** 上报一批。成功才出队；失败保留（等下一次）。永不抛异常。 */
function flush() {
  if (_sending) return
  const q = _readQ()
  if (!q.length) return
  const { token, tid } = _auth()
  if (!token) return                 // 还没登录：留在队列里，登录后再补传
  const batch = q.slice(0, BATCH)
  _sending = true
  wx.request({
    url: _base() + '/api/track',
    method: 'POST',
    timeout: 8000,
    header: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                          tid ? { 'X-Tenant-Id': String(tid) } : {}),
    data: { events: batch },
    success(r) {
      const b = r.data || {}
      if (r.statusCode === 200 && b.success !== false) {
        // 只出队「已成功送出的这一批」——期间新入队的事件不能被误删
        const rest = _readQ().slice(batch.length)
        _writeQ(rest)
        if (rest.length >= BATCH) _schedule()
      } else {
        _schedule()   // 5xx/403 等：保留，稍后重试
      }
    },
    fail() { _schedule() },
    complete() { _sending = false }
  })
}

function track(event, data) {
  try {
    console.log('[track]', event, data)
    if (statDisabled()) return     // ① 关了就是关了：不入队
    const props = {}
    if (data && typeof data === 'object') {
      for (const k in data) {
        if (!Object.prototype.hasOwnProperty.call(data, k)) continue
        const v = data[k]
        if (v === undefined || v === null) continue
        if (typeof v === 'object') continue
        props[k] = String(v).slice(0, 120)
      }
    }
    let propsStr = ''
    try { propsStr = JSON.stringify(props) } catch (e) { propsStr = '' }
    if (propsStr.length > MAX_PROP) propsStr = ''
    const q = _readQ()
    q.push({
      event: String(event || '').slice(0, 64),
      props: propsStr ? JSON.parse(propsStr) : null,
      page: _curPage(),
      ts: Date.now()
    })
    _writeQ(q)
    if (q.length >= BATCH) flush()
    else _schedule()
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

/** 退出登录 / 撤回同意时清空队列（避免把上一账号的事件带到下一账号）。 */
function clearQueue() {
  try { wx.removeStorageSync(QUEUE_KEY) } catch (e) { /* ignore */ }
}

module.exports = {
  track, reportError, pageView, flush, clearQueue,
  statDisabled, OPT_OUT_KEY, EVENTS
}
