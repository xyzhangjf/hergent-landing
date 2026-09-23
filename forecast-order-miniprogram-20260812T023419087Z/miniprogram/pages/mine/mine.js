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

// v259 左滑删除：删除按钮宽度（rpx）。与 wxss 里 .swipe-act 的宽度**必须一致** ——
// 按钮露出多少、内容左移多少，两边是同一个数，写死在两个文件里靠注释互相对齐。
const DEL_RPX = 160
// 轴向锁定阈值（px）：第一次位移超过它才判定这一手势是「横向滑动」还是「纵向滚动」。
// 太小会在手指微抖时误判成横向，太大则跟手感变差。8px 是列表左滑的常用取值。
const AXIS_LOCK_PX = 8

Page({
  data: {
    user: {}, avatarChar: '', roleName: '', canManage: false, records: [], expandedId: 0, recallingId: 0,
    // v259 左滑删除：swipeId = 当前展开的那一项 id（0 = 没有），swipeX = 位移量（px，负值），
    // dragging = 手指按下中（跟手，关掉过渡动画），deletingId = 正在请求删除的那一项（防重复点）
    swipeId: 0, swipeX: 0, dragging: false, deletingId: 0
  },
  onLoad() {
    // 把删除按钮的露出宽度从 rpx 折成 px：触摸事件上报的是 px，滑动距离与按钮宽度
    // 必须是同一把尺子，否则会出现「划到底按钮只露一半」或「划过头露出白边」。
    let ww = 375
    try {
      ww = (wx.getWindowInfo && wx.getWindowInfo().windowWidth) || wx.getSystemInfoSync().windowWidth || 375
    } catch (e) { /* 取不到就用 375：只影响滑动距离上限，不影响功能可用 */ }
    this._maxX = Math.round(ww * DEL_RPX / 750)
  },
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
      // 重新拉列表时一并收起左滑：列表可能整体变了（删/撤/新增），
      // 留着 swipeId 会指向一条已经不在列表里的单据（下次滑动就"对不上号"）。
      this.setData({ records, swipeId: 0, swipeX: 0 })
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
  // 备案号标注（2026-09-22 备案通过后新增）：点一下把工信部备案查询网址复制到剪切板。
  // 为什么不直接跳转：小程序无法直跳 beian.miit.gov.cn（业务域名需在该站放校验文件，放不上去）；
  // wx.setClipboardData 已在隐私申报范围内（「读取你的剪切板」），故不新增申报项。
  copyBeian() {
    wx.setClipboardData({
      data: 'https://beian.miit.gov.cn',
      success: () => wx.showToast({ title: '已复制备案查询网址', icon: 'none' })
    })
  },
  toggleExpand(e) {
    const id = +e.currentTarget.dataset.id
    this.setData({
      expandedId: this.data.expandedId === id ? 0 : id,
      // v259：点卡片时顺手收起左滑 —— 展开明细与删除按钮同时挂着很挤，
      // 也符合「点了别处就收起」的直觉
      swipeId: 0, swipeX: 0
    })
  },

  /* ===== v259：左滑删除 =====
     手势与列表纵向滚动的冲突，靠「轴向锁定」解决：小程序 touchmove 没有 preventDefault，
     只能在第一次明显位移时定调 —— 横向归滑动、纵向归滚动，判定为纵向就彻底放手让页面滚。
     （不锁的话，手指斜着划会一边开按钮一边滚列表，两边都不跟手。） */
  onSwipeStart(e) {
    // data-* 传布尔会变成字符串（"false" 也判为真），故 WXML 里传 1/0，这里按数字比
    const can = +e.currentTarget.dataset.can === 1
    this._axis = ''
    // 不可删（不是本人报的单 / 期次已定稿）⇒ 完全不接管手势，页面该怎么滚怎么滚
    this._sid = can ? +e.currentTarget.dataset.id : 0
    if (!can) return
    const t = e.touches[0] || {}
    this._sx = t.clientX || 0
    this._sy = t.clientY || 0
    // 起点接上当前偏移：这一项若本来就展开着，要接着往下拖，不能先"跳"回 0 再滑
    this._startX = this.data.swipeId === this._sid ? this.data.swipeX : 0
  },
  onSwipeMove(e) {
    if (!this._sid) return
    const t = e.touches[0] || {}
    const dx = (t.clientX || 0) - this._sx
    const dy = (t.clientY || 0) - this._sy
    if (!this._axis) {
      // 还没到判定阈值就不动，避免手指微抖把按钮蹭开
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
      this._axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (this._axis === 'y') {
        // 纵向：交还页面滚动，并收起已展开的项（否则滚动时按钮跟着乱开）
        this._sid = 0
        if (this.data.swipeId) this.setData({ swipeId: 0, swipeX: 0 })
        return
      }
      // 横向：接管。展开权收到这一项 —— 其它项因 swipeId 不匹配会自动合上
      this.setData({ dragging: true, swipeId: this._sid })
    }
    if (this._axis !== 'x') return
    let x = this._startX + dx
    if (x > 0) x = 0                        // 右边没有东西，不允许右滑
    if (x < -this._maxX) x = -this._maxX    // 最多露出删除按钮那么宽，再多会露出白底
    // 位移不足 1px 就不 setData —— 手指每动一下都过一次渲染层，列表会卡
    if (Math.abs(x - this.data.swipeX) >= 1) this.setData({ swipeX: Math.round(x) })
  },
  onSwipeEnd() {
    const id = this.data.swipeId
    const axis = this._axis
    this._axis = ''
    this._sid = 0
    if (axis !== 'x') return   // 纵向滚动 / 根本没动 ⇒ 保持原状
    // 松手吸附：划过一半就展开，否则弹回
    const open = this.data.swipeX <= -this._maxX / 2
    this.setData({ dragging: false, swipeId: open ? id : 0, swipeX: open ? -this._maxX : 0 })
  },
  async onDeleteTap(e) {
    const id = +e.currentTarget.dataset.id
    const index = +e.currentTarget.dataset.index
    if (this.data.deletingId) return   // 上一次还没回来，防连点
    const ok = await new Promise(res => wx.showModal({
      title: '删除预报单',
      content: '删除后不可恢复，确定删除单号 ' + id + ' 的预报单？',
      confirmText: '确认删除', cancelText: '取消',
      confirmColor: '#ff3b30',
      success: r => res(r.confirm)
    }))
    if (!ok) {
      // 取消：只收起左滑，**不删除**（请求都不发）
      this.setData({ swipeId: 0, swipeX: 0 })
      return
    }
    const records = this.data.records.slice()
    const removed = records[index]
    if (!removed) { this.load(); return }
    // 乐观移除：手指一松就有反馈，不必等转圈；失败再按原索引插回（见 catch）
    records.splice(index, 1)
    this.setData({ records, swipeId: 0, swipeX: 0, expandedId: 0, deletingId: id })
    try {
      await request(`/api/forecast-submissions/${id}/delete`, 'POST', {})
      track(EVENTS.DELETE, { id })
      wx.showToast({ title: '已删除', icon: 'success' })
      // 删完仍回拉一次：拿服务端权威列表（顺带落到空列表状态），
      // 也避免本地乐观结果在服务端其实失败时被一直留在页面上
      this.load()
    } catch (err) {
      // 回滚：按**原索引**插回原位，收起左滑，并原样透出服务端拒绝原因
      // （期次已定稿 / 不是本人报的单 / 网络失败，文案由服务端给，不在这里瞎猜）
      const back = this.data.records.slice()
      back.splice(index, 0, removed)
      this.setData({ records: back })
      wx.showToast({ title: err.message || '删除失败', icon: 'none' })
    } finally {
      this.setData({ deletingId: 0 })
    }
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
