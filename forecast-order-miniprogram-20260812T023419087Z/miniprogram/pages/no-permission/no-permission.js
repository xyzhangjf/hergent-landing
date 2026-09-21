/* 无报单权限页 —— 把「你不能用」变成**可理解 + 可解锁**的界面。
 *
 * 为什么需要这一页（2026-09-20 审计 P0-2）：
 *   `accountant` / `guide` / `driver` 在 `core._DEFAULT_PERMS` 里**没有 `data`**，
 *   而小程序 7 个业务端点全映射 `data` ⇒ 他们登录成功后**每个动作都 403**。
 *   原实现下他们看到的是：门店选择器空白 + 一个说不清原因的 toast + 「我的提交」空列表，
 *   完全无法判断「是我操作错了 / 系统坏了 / 还是我本来就没权限」。
 *   用户 2026-09-20 拍板：这些人**不报单**（不给 `data`），但必须**说清楚**。
 *
 * 三条设计纪律：
 *   ① **单向门必须给解锁动作** —— 只告诉用户「不行」是最坏的约束；本页给出「谁去改、改什么」。
 *   ② **判据来自后端**（`utils/perm.js` → `/api/auth/permissions`），不在前端硬编码角色名。
 *   ③ 退出登录必须**真的销毁服务端会话**（`utils/session.js`）—— 无权限用户尤其需要干净退出。
 */
const { loadPerms } = require('../../utils/perm')
const { logout } = require('../../utils/session')
const { roleText } = require('../../utils/roles')
const { track, pageView, EVENTS } = require('../../utils/track')

/* 角色 → 「为什么没权限、怎么开通」的一句话。缺键时**不猜**，走通用说明。 */
const REASON = {
  accountant: '会计岗位的账号不参与报单（报单由业务员与主管负责）。',
  driver: '司机岗位的账号不参与报单（报单由业务员与主管负责）。',
  guide: '导购岗位的账号不参与报单（报单由业务员与主管负责）。'
}

Page({
  data: {
    role: '',
    roleText: '',
    reason: '',
    permissions: [],
    checking: false
  },
  onLoad() {
    this.render()
    // 这一条是**产品决策的直接依据**：谁撞到墙、撞了几次。没有它，「会计/导购/司机该不该
    // 给报单权限」就只能靠猜（用户 2026-09-20 拍板先关门、待真实数据再决定是否放权）。
    track(EVENTS.NO_PERMISSION_VIEW, { role: this.data.role })
    pageView('no_permission')
    // 进页面顺手刷一次：若管理员**刚刚**给了权限，用户不用做任何事就能继续。
    this.recheck(true)
  },
  render() {
    const app = getApp()
    const u = (app && app.globalData.user) || wx.getStorageSync('fs_user') || {}
    const role = u.role || ''
    this.setData({
      role: role,
      roleText: roleText(role) || '当前角色',
      reason: REASON[role] ||
        '当前角色没有「报单数据」的使用权限，因此无法使用报单功能。'
    })
  },
  /* silent=true 时不弹 toast（进页面自动刷新用） */
  async recheck(silent) {
    if (this.data.checking) return
    this.setData({ checking: true })
    try {
      const p = await loadPerms(true)
      if (p.known && p.canReport) {
        wx.reLaunch({ url: '/pages/fill/fill' })
        return
      }
      if (!silent) {
        wx.showToast({ title: '暂时还没有权限，请联系管理员', icon: 'none', duration: 2500 })
      }
    } finally {
      this.setData({ checking: false })
    }
  },
  onRecheck() { this.recheck(false) },
  /* 复制一段可直接发给管理员的话 —— 降低「说不清」的沟通成本 */
  copyHint() {
    const t = this.data.roleText
    wx.setClipboardData({
      data: '我的小程序账号角色是「' + t + '」，现在用不了报单功能。如果需要我报单，' +
            '麻烦在网页端【员工档案 → 角色权限】给我开通「报单数据」，或把我的角色改成业务员 / 主管。',
      success: () => wx.showToast({ title: '已复制，发给管理员即可', icon: 'none' })
    })
  },
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新输入账号密码。确定退出吗？',
      confirmText: '退出',
      confirmColor: '#ff3b30',
      success: (r) => {
        if (!r.confirm) return
        logout({ success: () => wx.reLaunch({ url: '/pages/login/login' }) })
      }
    })
  }
})
