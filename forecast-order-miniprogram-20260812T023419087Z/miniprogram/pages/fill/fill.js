const app = getApp()
const { request } = require('../../utils/api')
const { track, EVENTS } = require('../../utils/track')

Page({
  data: {
    stores: [], storeIdx: 0, store: {},
    periods: [], periodIdx: 0, period: {},  // A 方案：报单期次（对齐到货窗口）
    kw: '', results: [], hot: [],
    cart: [], cartCount: 0,
    submitting: false, autoFocus: false,
    recentStores: [],          // M10: 最近报单门店快捷入口
    pendingSubmit: false,      // M11: 存在未提交草稿（离线/失败），待联网补传
    lastReported: ''           // M9: 今日已报回执文本
  },
  cartMap: {},
  _seq: 0,           // F3: 搜索请求序号，用于丢弃过期响应
  _searchTimer: null,

  onShow() {
    const token = app.globalData.token || wx.getStorageSync('fs_token')
    if (!token) { wx.reLaunch({ url: '/pages/login/login' }); return }
    this.restoreCart()       // M8: 恢复持久化购物车（跨页面销毁不丢）
    this.loadStores()
    this.loadPeriods()       // A 方案：拉取当前可报单期次
    this.loadProducts('')
    this.loadRecentStores()  // M10
  },

  /* A 方案：拉取当前可报单的开放期次（status=open 且今天在窗口内） */
  async loadPeriods() {
    try {
      const d = await request('/api/forecast-submissions/open-periods')
      const periods = d.periods || []
      const savedId = wx.getStorageSync('fs_period_id')
      let idx = 0
      if (savedId !== '' && savedId != null && savedId !== undefined) {
        const found = periods.findIndex(p => String(p.id) === String(savedId))
        if (found >= 0) idx = found
      }
      this.setData({ periods, period: periods[idx] || {}, periodIdx: idx })
    } catch (e) {
      // D1: 不再静默吞错。期次是提交的必填项，加载失败必须让用户知道
      console.warn('[fill] loadPeriods failed:', e && e.message)
      if (!this._periodWarned && (!this.data.periods || !this.data.periods.length)) {
        this._periodWarned = true
        wx.showToast({ title: '报单期次加载失败，请返回重试', icon: 'none' })
      }
    }
  },

  /* A 方案：切换报单期次 */
  onPeriodChange(e) {
    const i = +e.detail.value
    const period = this.data.periods[i] || {}
    this.setData({ period, periodIdx: i })
    wx.setStorageSync('fs_period_id', period.id !== undefined ? period.id : '')
    this.setData({ lastReported: '' })   // 切换期次后清除旧回执
  },

  /* M8: 购物车持久化到 Storage，页面销毁/重进不丢 */
  restoreCart() {
    try {
      const saved = wx.getStorageSync('fs_cart')
      if (saved && saved.length) {
        this.cartMap = {}
        for (const c of saved) this.cartMap[c.key] = c
        this.syncCart()
      }
    } catch (e) { console.warn('[fill] restoreCart failed:', e) }
  },

  async loadStores() {
    try {
      const d = await request('/api/forecast-submissions/stores')
      const stores = d.stores || []
      // F1 修复：保留上次选中的门店，不强制重置为 stores[0]
      const savedId = wx.getStorageSync('fs_store_id')
      let idx = 0
      if (savedId !== '' && savedId !== null && savedId !== undefined) {
        const found = stores.findIndex(s => String(s.id) === String(savedId))
        if (found >= 0) idx = found
      }
      this.setData({ stores, store: stores[idx] || {}, storeIdx: idx })
    } catch (e) {
      wx.showToast({ title: e.message || '门店加载失败', icon: 'none' })
    }
  },

  async loadProducts(keyword) {
    // F3 修复：请求序号，响应返回时若已不是最新请求则丢弃，避免竞态覆盖
    const seq = (this._seq = (this._seq || 0) + 1)
    try {
      // M7 优化：单接口返回 商品+库存+日均，替代「模糊匹配 + 列表」两次串行请求（减少 RTT 与竞态）
      const q = keyword ? `?q=${encodeURIComponent(keyword)}` : '?limit=20'
      const d = await request('/api/products/fill-search' + q)
      if (seq !== this._seq) return
      const list = d.items || []
      if (seq !== this._seq) return
      const hot = list.slice(0, 6)
      this.setData({ hot })
      if (keyword) this.setData({ results: list.slice(0, 20) })
    } catch (e) {
      wx.showToast({ title: e.message || '商品加载失败', icon: 'none' })
    }
  },

  onSearch(e) {
    const kw = e.detail.value
    this.setData({ kw })
    if (kw) {
      if (this._searchTimer) clearTimeout(this._searchTimer)
      this._searchTimer = setTimeout(() => this.loadProducts(kw), 300)
    } else {
      this.setData({ results: [] })
    }
  },

  /* M10: 拉取我的历史报单，提取最近报单门店作为快捷入口 */
  async loadRecentStores() {
    try {
      const d = await request('/api/forecast-submissions/my?limit=20')
      const recs = d.records || []
      const seen = []
      const names = []
      for (const r of recs) {
        const nm = r.store_name || r.store || ''
        if (nm && names.indexOf(nm) < 0) { names.push(nm); seen.push({ name: nm }) }
        if (seen.length >= 4) break
      }
      if (seen.length) this.setData({ recentStores: seen })
    } catch (e) { console.warn('[fill] loadRecentStores failed:', e && e.message) }
  },

  onStoreChange(e) {
    const i = +e.detail.value
    const store = this.data.stores[i] || {}
    this.setData({ store, storeIdx: i })
    wx.setStorageSync('fs_store_id', store.id !== undefined ? store.id : '')
    this.setData({ lastReported: '' })   // 切换门店后清除旧回执
  },

  /* M10: 点击最近报单门店快捷入口 */
  pickRecent(e) {
    const nm = e.currentTarget.dataset.name
    const i = this.data.stores.findIndex(s => s.name === nm)
    if (i >= 0) {
      this.setData({ storeIdx: i, store: this.data.stores[i] })
      wx.setStorageSync('fs_store_id', this.data.stores[i].id)
      this.setData({ lastReported: '' })
    }
  },

  quickAdd(e) {
    const p = this.data.hot[+e.currentTarget.dataset.i]
    this.addToCart(p)
  },

  addProd(e) {
    const p = this.data.results[+e.currentTarget.dataset.i]
    this.addToCart(p)
  },

  addToCart(p) {
    if (!p || !p.id) return
    const key = p.id + '|' + (p.unit || '件')
    if (this.cartMap[key]) {
      this.cartMap[key].qty += 1
    } else {
      this.cartMap[key] = { key, id: p.id, name: p.name, spec: p.spec || '', unit: p.unit || '件', qty: 1 }
    }
    this.syncCart()
  },

  plus(e) {
    const c = this.cartMap[e.currentTarget.dataset.key]
    if (c) { c.qty += 1; this.syncCart() }
  },
  minus(e) {
    const c = this.cartMap[e.currentTarget.dataset.key]
    if (!c) return
    c.qty -= 1
    if (c.qty <= 0) delete this.cartMap[e.currentTarget.dataset.key]
    this.syncCart()
  },
  removeItem(e) {
    delete this.cartMap[e.currentTarget.dataset.key]
    this.syncCart()
  },

  syncCart() {
    const cart = Object.values(this.cartMap)
    this.setData({
      cart,
      cartCount: cart.length
    })
    // M8: 购物车持久化到 Storage（跨页面销毁不丢）
    try { wx.setStorageSync('fs_cart', cart) } catch (e) { console.warn('[fill] syncCart failed:', e) }
  },

  async submit() {
    const { cart, store, period } = this.data
    if (!cart.length) return
    if (!store || !store.id) {
      wx.showToast({ title: '请先选择报单门店', icon: 'none' })
      return
    }
    if (!period || !period.id) {
      wx.showToast({ title: '请先选择报单期次', icon: 'none' })
      return
    }
    this.setData({ submitting: true, pendingSubmit: false })
    try {
      // v108-fix: 不再传 price/role（铁律①报单人不看金额；role 由后端按 token 校验）
      // A 方案：携带 period_id，后端校验期次并按其 order_start 落 order_date（对齐到货窗口）
      const items = cart.map(c => ({
        product_id: c.id, product_name: c.name, spec: c.spec,
        unit: c.unit, quantity: c.qty
      }))
      const d = await request('/api/forecast-submissions', 'POST', { store, items, period_id: period.id })
      const total = (d && d.total_qty != null) ? d.total_qty : cart.reduce((s, c) => s + c.qty, 0)
      // M9: 明确回执「今日 XX 店已报 N 件」，并给查看入口
      const msg = `今日 ${store.name} 已报 ${total} 件`
      this.setData({ lastReported: msg })
      track(EVENTS.SUBMIT, { store: store.name, qty: total })
      wx.showModal({
        title: '提交成功',
        content: `${msg}\n可在「我的」查看报单记录`,
        confirmText: '查看我的报单',
        cancelText: '继续填报',
        success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/summary/summary' }) }
      })
      this.cartMap = {}
      this.syncCart()
      this.setData({ pendingSubmit: false })
    } catch (e) {
      // M11: 提交失败（多为断网）保留购物车为草稿，联网后一键补传
      this.setData({ pendingSubmit: true })
      track(EVENTS.SUBMIT_FAIL, { msg: (e.message || '提交失败').slice(0, 80) })
      wx.showToast({ title: (e.message || '提交失败') + '，已存草稿', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  /* M11: 离线/失败草稿一键补传（购物车已持久化在 Storage，直接重新提交） */
  resumeDraft() {
    if (!this.data.cartCount) { this.setData({ pendingSubmit: false }); return }
    this.submit()
  },
  clearCart() {
    this.cartMap = {}
    this.syncCart()
    this.setData({ pendingSubmit: false, lastReported: '' })
  }
})
