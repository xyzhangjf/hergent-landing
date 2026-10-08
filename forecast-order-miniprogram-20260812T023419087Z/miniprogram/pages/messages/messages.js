/* 我的通知（v318 新建）
 *
 * 为什么必须有这一页（需求原文：「整个预报订单定稿后，通过小程序向对应人员发送加单或减单明细」）：
 *   ① 小程序此前**没有任何消息页**（`app.json` 的 10 个页面里没有），`message_center` 只有网页端
 *      顶栏铃铛能看到 ⇒ 「通过小程序发送」这句话在系统里**无处可落**。
 *   ② 微信订阅消息对「工具→效率」类目**拿不到长期订阅**（只能一次性授权），
 *      不适合做系统主动通知的主渠道 —— 这一点在 `pages/fill/fill.js` 里已记录过。
 *   ③ 而销售**每天必开小程序报单** ⇒ 「页面内可见」是**零授权、必达**的那一条。
 *      （同款模式先例：v304 的本期报单进度提醒条。）
 *
 * 数据源 = `GET /api/messages`（`hergent-erp/server/routers/messages.py`）。
 *   🔴 可见性由**服务端**收口（`_visible_where`：recipients 为空 = 广播；非空 = 只认
 *      `users.id`/`username`，命中不上就**看不见**）。前端**不做也不该做**第二套过滤 ——
 *      在客户端"筛一遍"只会造成「服务端认为能看、前端藏起来」这种两套口径。
 *   🔴 收件人键的历史坑：写端曾把 `employee_id` 当 `users.id` 用（v318 已修，改为经
 *      `employee_account_map()` 解析）。本页读到的就是修好之后的结果；若某位员工**没关联
 *      登录账号**，他收不到通知 —— 这不是本页的问题，要在「员工档案」里补关联。
 *
 * 已读语义：点开某条即算已读（调 `/api/messages/{id}/read`）。失败**静默**（下次刷新对齐
 *   服务端真相）—— 已读与否是辅助状态，不该因为它让用户看到报错。
 */
const app = getApp()
const { request } = require('../../utils/api')
const { pageView } = require('../../utils/track')

const PAGE_SIZE = 30

function pad2(n) { return (n < 10 ? '0' : '') + n }

/* 后端 `message_center.created_at` 是本地时间字符串 `YYYY-MM-DD HH:MM:SS`
   （`datetime('now','localtime')`）⇒ 这里只做**展示级**格式化，不引入时区换算。 */
function fmtTime(s) {
  const t = String(s || '')
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!m) return t
  const now = new Date()
  const today = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate())
  if (m[1] + '-' + m[2] + '-' + m[3] === today) return '今天 ' + m[4] + ':' + m[5]
  return m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5]
}

/* 通知种类标签。判据取自**内容**而不是只有 id：
   · 加单/减单 —— event_key 前缀 `forecast_extra_alloc`（见后端 `notify_extra_allocs_finalized`）；
     方向再从标题里的「减单」二字判（标题由后端拼「本期加单：X」/「本期减单：X」）。
   · 其余按系统通知显示。 */
function kindOf(m) {
  const ekey = String((m && m.event_key) || '')
  const title = String((m && m.title) || '')
  if (ekey.indexOf('forecast_extra_alloc') === 0) {
    return title.indexOf('减单') >= 0
      ? { tag: '减单', cls: 'cut' }
      : { tag: '加单', cls: 'add' }
  }
  return { tag: '通知', cls: 'sys' }
}

Page({
  data: {
    items: [],
    total: 0,
    unread: 0,
    hasMore: false,
    unreadOnly: false,
    loading: false,        // 首屏 / 下拉刷新
    loadingMore: false,    // 触底
    openId: 0,             // 当前展开的那一条（0 = 全收起）
    err: ''
  },

  onLoad() { pageView('messages') },

  onShow() {
    const token = app.globalData.token || wx.getStorageSync('fs_token')
    if (!token) { wx.reLaunch({ url: '/pages/login/login' }); return }
    this.load(true)
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) this.load(false)
  },

  /* `first=true` 重新拉第一页（并重算未读数/总数），否则接在后面。 */
  async load(first) {
    if (this.data.loading || this.data.loadingMore) return
    const offset = first ? 0 : this.data.items.length
    this.setData(first ? { loading: true } : { loadingMore: true })
    try {
      const d = await request('/api/messages?unread_only=' + (this.data.unreadOnly ? 1 : 0)
        + '&limit=' + PAGE_SIZE + '&offset=' + offset)
      const rows = (d.items || []).map(m => {
        const k = kindOf(m)
        const body = String(m.content || '')
        return {
          id: m.id,
          title: m.title || '',
          content: body,
          // 收起态的摘要：把换行折成空格后交给 CSS 做两行截断
          // （`white-space:pre-wrap` 与 `-webkit-line-clamp` 不能同时用，故在 js 里先折）
          preview: body.replace(/\s*\n\s*/g, '　'),
          sender: m.sender || '',
          timeText: fmtTime(m.last_at || m.created_at),
          triggers: Number(m.triggers || 1),
          unread: !Number(m.is_read || 0),
          tag: k.tag,
          tagCls: k.cls
        }
      })
      this.setData({
        items: first ? rows : this.data.items.concat(rows),
        total: Number(d.total || 0),
        unread: Number(d.unread_count || 0),
        hasMore: !!d.has_more,
        err: ''
      })
    } catch (e) {
      /* 🔴 「读不到」必须说出来，不能显示成「没有通知」—— 两者对用户是**完全不同**的结论
         （前者要去查权限/网络，后者代表"确实没人通知我"）。空列表 + 一句错误条最诚实。 */
      this.setData({ err: (e && e.message) || '读取通知失败' })
    } finally {
      this.setData({ loading: false, loadingMore: false })
    }
  },

  setTab(e) {
    const only = String(e.currentTarget.dataset.only) === '1'
    if (only === this.data.unreadOnly) return
    this.setData({ unreadOnly: only, openId: 0 })
    this.load(true)
  },

  /* 点一条 = 展开/收起；展开时若未读则置已读 */
  async toggle(e) {
    const id = Number(e.currentTarget.dataset.id)
    const openId = this.data.openId === id ? 0 : id
    this.setData({ openId })
    if (!openId) return
    const it = this.data.items.find(x => x.id === id)
    if (!it || !it.unread) return
    // 乐观置已读：手指一落就有反馈；服务端失败也不回滚（下次刷新拿真相）
    this.setData({
      items: this.data.items.map(x => (x.id === id ? Object.assign({}, x, { unread: false }) : x)),
      unread: Math.max(0, this.data.unread - 1)
    })
    try {
      await request('/api/messages/' + id + '/read', 'POST', {})
    } catch (err) { /* 静默：已读是辅助状态，不值得打扰 */ }
  },

  async markAll() {
    if (!this.data.unread) { wx.showToast({ title: '没有未读通知', icon: 'none' }); return }
    try {
      await request('/api/messages/read-all', 'POST', {})
      wx.showToast({ title: '已全部标为已读', icon: 'success' })
      this.load(true)
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' })
    }
  }
})
