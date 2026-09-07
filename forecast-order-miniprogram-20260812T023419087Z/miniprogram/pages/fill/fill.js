const app = getApp()
const { request } = require('../../utils/api')
const { track, EVENTS } = require('../../utils/track')

Page({
  data: {
    stores: [], storeIdx: 0, store: {},
    periods: [], periodIdx: 0, period: {},  // A 方案：报单期次（对齐到货窗口）
    kw: '',
    // 全量铺开（2026-09-06）：进入即列出全部可预报商品，分页滚动加载，避免首屏卡顿
    products: [], total: 0, pageSize: 30, hasMore: true, loadingMore: false,
    cart: [], cartCount: 0, cartQty: 0, cartOpen: false,
    // P1-3: qtyMap 由 data 移入实例属性 _qtyMap（模板 0 引用），避免每次点击全量 setData
    submitting: false, autoFocus: false,
    showTop: false,          // P2-7: 滚动超一屏显示「回到顶部」
    initialLoading: false,   // P2-2: 商品首屏加载中（避免误显「没有找到商品」）
    loadError: '',           // P2-5: 商品首屏加载失败文案（非空时显示错误视图+重试）
    offline: false,          // P2-3/5: 断网提示（顶部横幅 + 恢复自动补传）
    recentStores: [],          // M10: 最近报单门店快捷入口
    pendingSubmit: false,      // M11: 存在未提交草稿（离线/失败），待联网补传
    lastReported: '',          // M9: 今日已报回执文本
    // 2026-09-06 跨期次沿用：提交后不清空，记住「上次报了什么」，下期可一键带入
    lastOrder: null,           // { periodId, periodName, at, count, qty, items[] } 同门店上次报单快照
    submittedInfo: null        // { sid, count, qty, at } 当前门店 + 当前期次已提交（防重复提交）
  },
  cartMap: {},
  _qtyMap: {},        // P1-3: 实例属性版 qtyMap（id -> 已填数量），供分页回填/行同步读取
  _prodIndex: {},     // P1-2: id -> products 下标索引，O(1) 定位免全表遍历
  _seq: 0,           // F3: 搜索请求序号，用于丢弃过期响应
  _searchTimer: null,
  _persistTimer: null, // P1-1: 购物车写盘防抖计时器
  _scrollTop: 0,      // P1-4: 页面滚动位置（切 tab 回来恢复）
  _lastShowTop: false, // P2-7: 回顶按钮显隐节流（避免每帧 setData）

  /* P2-3: 全局网络监听——断网提示 + 恢复后自动补传草稿（仅注册一次） */
  onLoad() {
    wx.getNetworkType({
      success: (r) => {
        const off = !r.networkType || r.networkType === 'none'
        if (off !== this.data.offline) this.setData({ offline: off })
      }
    })
    if (wx.onNetworkStatusChange) {
      wx.onNetworkStatusChange((res) => {
        this.setData({ offline: !res.isConnected })
        if (res.isConnected) {
          // 网络恢复：静默恢复本地购物车（不弹框）；自动补传交给 onShow（页面可见时）
          this._periodWarned = false
          // 二期: restoreCart 内部已按当前门店键恢复（fs_cart_<storeId>）
          if (!this.data.cartCount) this.restoreCart()
        }
      })
    }
  },
  /* P2-1: 下拉刷新——清缓存强制重拉门店/期次/商品 */
  onPullDownRefresh() {
    app.globalData._fsCache = {}
    this._periodWarned = false
    Promise.all([
      this.loadStores(),
      this.loadPeriods(),
      this.loadProducts('', false),
      this.loadRecentStores()
    ]).then(() => {
      wx.stopPullDownRefresh()
    }).catch(() => {
      wx.stopPullDownRefresh()
    })
  },
  onShow() {
    const token = app.globalData.token || wx.getStorageSync('fs_token')
    if (!token) { wx.reLaunch({ url: '/pages/login/login' }); return }
    this.restoreCart()       // M8: 恢复持久化购物车（跨页面销毁不丢）
    this.loadStores()        // P1-4: 内部带 5min 内存缓存
    this.loadPeriods()       // A 方案：拉取当前可报单期次（内部带 5min 缓存）
    // P1-4: 商品列表已有（从其它 tab 切回）则不重拉——保留滚动位置与已加载内容
    if (!this.data.products.length) this.loadProducts('', false)
    this.loadRecentStores()  // M10
    // P2-3: 页面可见 + 有网 + 有草稿 → 自动补传（网络恢复或重进页面时）
    if (this.data.pendingSubmit && this.data.cartCount && !this.data.offline) this.resumeDraft()
    // P1-4: 恢复切走前的滚动位置（150ms 等首帧渲染完成再滚）
    if (this._scrollTop > 0) {
      const st = this._scrollTop
      setTimeout(() => wx.pageScrollTo({ scrollTop: st, duration: 0 }), 150)
    }
  },
  onPageScroll(e) {
    const st = (e && e.scrollTop) || 0
    this._scrollTop = st
    const show = st > 600
    if (show !== this._lastShowTop) {
      this._lastShowTop = show
      this.setData({ showTop: show })
    }
  },
  backTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  /* 触底加载下一页（分页滚动，避免一次性渲染数百 SKU 卡顿） */
  onReachBottom() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    this.loadProducts(this.data.kw, true)
  },

  /* 拉取期次：Web 端所有 status='open' 的期次（含已过单日窗口的），
     有效期次排最前并默认选中；过期项在名称后标注「（已过窗口）」 */
  async loadPeriods() {
    try {
      const cached = this._fsCacheGet('periods')
      if (cached) { this._applyPeriods(cached); return }
      const d = await request('/api/forecast-submissions/open-periods')
      const periods = (d.periods || []).map(p => Object.assign({}, p, {
        display: (p.name || '') + (p.in_window === false ? '（已过窗口）' : '')
      }))
      this._fsCacheSet('periods', periods)
      this._applyPeriods(periods)
    } catch (e) {
      // D1: 不再静默吞错。期次是提交的必填项，加载失败必须让用户知道
      console.warn('[fill] loadPeriods failed:', e && e.message)
      if (!this._periodWarned && (!this.data.periods || !this.data.periods.length)) {
        this._periodWarned = true
        wx.showToast({ title: '报单期次加载失败，请返回重试', icon: 'none' })
      }
    }
  },
  _applyPeriods(periods) {
    const savedId = wx.getStorageSync('fs_period_id')
    // 二期: 默认选中「未过窗口」的有效期次 —— 用户上次停留在已过期期次时，
    // 重新进入不应默认选中过期项（否则填完提交必被后端 400 拒绝）
    let idx = 0
    if (savedId !== '' && savedId != null && savedId !== undefined) {
      const found = periods.findIndex(p => String(p.id) === String(savedId))
      if (found >= 0 && periods[found].in_window !== false) idx = found
      else {
        const openIdx = periods.findIndex(p => p.in_window !== false)
        if (openIdx >= 0) idx = openIdx
      }
    } else {
      const openIdx = periods.findIndex(p => p.in_window !== false)
      if (openIdx >= 0) idx = openIdx
    }
    this.setData({ periods, period: periods[idx] || {}, periodIdx: idx })
    // 同步选中值回 Storage，避免下次仍指向旧期次
    const sel = periods[idx]
    if (sel && sel.id !== undefined) wx.setStorageSync('fs_period_id', sel.id)
    this.refreshBanners()
  },

  /* A 方案：切换报单期次 */
  onPeriodChange(e) {
    const i = +e.detail.value
    const period = this.data.periods[i] || {}
    const oldId = (this.data.period || {}).id
    this.setData({ period, periodIdx: i })
    wx.setStorageSync('fs_period_id', period.id !== undefined ? period.id : '')
    this.setData({ lastReported: '' })   // 切换期次后清除旧回执
    this.refreshBanners()                // 期次变了，重新判断「本期是否已报」
    // 二期: 已填数量切到新期次 → 轻提示（数据保留可沿用，但别提交错期次）
    if (this.data.cartCount > 0 && period.id !== oldId && period.in_window !== false) {
      wx.showToast({
        title: `已切到「${period.name || ''}」，已填 ${this.data.cartCount} 项保留，提交前请核对期次`,
        icon: 'none', duration: 2500
      })
    }
    // 已过报单窗口的期次：提前告知（后端提交时仍会二次校验并 400 拒绝）
    if (period.in_window === false) {
      wx.showToast({
        title: '该期次报单窗口已过，提交会被拒绝',
        icon: 'none', duration: 2500
      })
    }
  },

  /* M8 二期: 购物车持久化到 Storage，按门店分键 fs_cart_<storeId>（根治串店）
     旧版 fs_cart 单份 → 首次进某店时自动迁移到 fs_cart_<storeId> 后删旧键
     force=true 仅在「主动切店」时用（无条件切到新店的车）；其余场景若已有进行中
     填报（cartMap 非空）则不覆盖，避免门店列表加载前就开始填报的数据被清掉 */
  _cartKey() {
    const s = this.data.store
    return (s && s.id != null) ? 'fs_cart_' + s.id : null
  },
  restoreCart(force) {
    const key = this._cartKey()
    // 门店未定（还没加载出列表）时不读写，避免把数据挂到 fs_cart_0 脏键
    if (!key) return
    if (!force && (this.data.cartCount || Object.keys(this.cartMap).length)) return
    let saved = null
    try {
      saved = wx.getStorageSync(key)
      // 迁移：历史单份版 → 当前店键（仅一次）
      if (!saved || !saved.length) {
        const legacy = wx.getStorageSync('fs_cart')
        if (legacy && legacy.length) {
          saved = legacy
          try { wx.setStorageSync(key, legacy); wx.removeStorageSync('fs_cart') } catch (e) { console.warn('[fill] migrate cart failed:', e) }
        }
      }
      if (saved && saved.length) {
        this.cartMap = {}
        for (const c of saved) this.cartMap[c.key] = c
      } else {
        this.cartMap = {}
      }
      this.syncCart()
    } catch (e) { console.warn('[fill] restoreCart failed:', e) }
  },

  /* P1-4: 门店/期次 5min 内存缓存——切 tab 回来不重拉，减少首屏等待 */
  _fsCacheGet(key) {
    const c = app.globalData._fsCache || (app.globalData._fsCache = {})
    const hit = c[key]
    if (hit && Date.now() - hit.t < 300000) return hit.data
    return null
  },
  _fsCacheSet(key, data) {
    const c = app.globalData._fsCache || (app.globalData._fsCache = {})
    c[key] = { t: Date.now(), data }
  },
  async loadStores() {
    const cached = this._fsCacheGet('stores')
    if (cached) { this._applyStores(cached); return }
    try {
      const d = await request('/api/forecast-submissions/stores')
      const stores = d.stores || []
      this._fsCacheSet('stores', stores)
      this._applyStores(stores)
    } catch (e) {
      wx.showToast({ title: e.message || '门店加载失败', icon: 'none' })
    }
  },
  _applyStores(stores) {
    // F1 修复：保留上次选中的门店，不强制重置为 stores[0]
    const savedId = wx.getStorageSync('fs_store_id')
    let idx = 0
    if (savedId !== '' && savedId !== null && savedId !== undefined) {
      const found = stores.findIndex(s => String(s.id) === String(savedId))
      if (found >= 0) idx = found
    }
    this.setData({ stores, store: stores[idx] || {}, storeIdx: idx })
    // 二期: 门店定案后再恢复该店的购物车（fs_cart_<storeId>，根治串店）
    this.restoreCart()
    this.refreshBanners()
  },

  /* ---- 2026-09-06 跨期次沿用：上次报单快照 + 本期已提交回执 ----
     需求：提交后不清空，下次报单时能看到「上次报了什么」，可一键带入后直接提交。
     - lastOrder  按「门店」维度存：换期次仍在，用于一键带入
     - submitted  按「门店+期次」维度存：本期已报过，提交前拦截防重复下单 */
  _lastKey() {
    const s = this.data.store
    return 'fs_last_cart_' + (s && s.id != null ? s.id : '0')
  },
  _subKey() {
    const s = this.data.store, p = this.data.period
    return 'fs_sub_' + (s && s.id != null ? s.id : '0') + '_' + (p && p.id != null ? p.id : '0')
  },
  refreshBanners() {
    let last = null, sub = null
    try {
      last = wx.getStorageSync(this._lastKey()) || null
      sub = wx.getStorageSync(this._subKey()) || null
    } catch (e) { console.warn('[fill] refreshBanners failed:', e) }
    if (last && (!last.items || !last.items.length)) last = null
    this.setData({ lastOrder: last, submittedInfo: sub })
  },
  /* 一键把上次报单内容带入当前填报（可再改，也可直接提交） */
  applyLastOrder() {
    const last = this.data.lastOrder
    if (!last || !last.items || !last.items.length) return
    this.cartMap = {}
    for (const it of last.items) {
      if (!it || !it.id || !(it.qty > 0)) continue
      const unit = it.unit || '件'
      const key = it.id + '|' + unit
      this.cartMap[key] = { key, id: it.id, name: it.name, spec: it.spec || '', unit, qty: it.qty }
    }
    this.syncCart()
    this.applyQtyToRows()
    wx.showToast({ title: `已带入 ${last.count} 项 / ${last.qty} 件`, icon: 'none' })
    track(EVENTS.SUBMIT, { action: 'apply_last_order', count: last.count, qty: last.qty })
  },
  /* 把已填数量回填到已加载的商品行（带入上次 / 翻页 / 搜索后用） */
  applyQtyToRows() {
    const qm = this._qtyMap || {}
    const patch = {}
    this.data.products.forEach((p, i) => {
      const v = qm[p.id] || 0
      if (p.qty !== v) patch['products[' + i + '].qty'] = v
    })
    if (Object.keys(patch).length) this.setData(patch)
  },

  /* 全量铺开 + 分页（2026-09-06）
     - keyword 为空：按 Web 端已配置（is_active）商品全量铺开，分页返回
     - keyword 非空：沿用原有模糊匹配（名称/规格/厂家编码/拼音首字母），
       仅作为对列表的过滤定位，不改变原搜索逻辑
     - append=true 时追加到已有列表末尾（滚动加载） */
  async loadProducts(keyword, append) {
    // F3 修复：请求序号，响应返回时若已不是最新请求则丢弃，避免竞态覆盖
    const seq = (this._seq = (this._seq || 0) + 1)
    const offset = append ? this.data.products.length : 0
    // P2-2: 首屏/重搜进入加载态（商品区此时为空，避免误显空态）
    if (!append && !this.data.products.length) this.setData({ initialLoading: true, loadError: '' })
    try {
      let q = `?limit=${this.data.pageSize}&offset=${offset}`
      if (keyword) q += `&q=${encodeURIComponent(keyword)}`
      const d = await request('/api/products/fill-search' + q)
      if (seq !== this._seq) return
      const qm = this._qtyMap || {}
      const list = (d.items || []).map(it => Object.assign({}, it, { qty: qm[it.id] || 0 }))
      const total = typeof d.total === 'number' ? d.total : list.length
      const products = append ? this.data.products.concat(list) : list
      // P1-2: 重建 id->下标索引（供 setQty/_syncRow O(1) 定位）
      const idx = {}
      products.forEach((p, i) => { idx[String(p.id)] = i })
      this._prodIndex = idx
      this.setData({
        products,
        total,
        hasMore: products.length < total,
        loadingMore: false,
        initialLoading: false,
        loadError: ''
      })
    } catch (e) {
      this.setData({ loadingMore: false, initialLoading: false })
      // P2-5: 首屏商品加载失败给错误视图（可重试），翻页失败仅 toast 不打扰
      if (!this.data.products.length) {
        this.setData({ loadError: e.message || '商品加载失败' })
      } else {
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      }
    }
  },

  /* P2-5: 错误视图「点此重试」 */
  reloadProducts() {
    this.setData({ loadError: '' })
    this.loadProducts('', false)
  },

  /* 搜索：对已铺开列表做过滤定位（防抖）
     最小触发长度：纯数字 3 位（后 4 位条码常见，2 位命中过多无意义）、其它 2 字符；
     未达阈值不请求，只有从"有效搜索"退回时才恢复全量，避免每敲一键都拉一次全表 */
  onSearch(e) {
    const kw = (e.detail.value || '').trim()
    this.setData({ kw })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    const minLen = /^\d+$/.test(kw) ? 3 : 2
    const wasSearching = this._lastKw != null && this._lastKw.length >= minLen
    this._lastKw = kw
    if (kw.length < minLen) {
      if (wasSearching) this._searchTimer = setTimeout(() => this.loadProducts('', false), 150)
      return
    }
    this._searchTimer = setTimeout(() => this.loadProducts(kw, false), 250)
  },

  clearSearch() {
    this.setData({ kw: '' })
    this._lastKw = ''
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this.loadProducts('', false)
  },

  /* M10: 拉取我的历史报单，提取最近报单门店作为快捷入口
     二期: 复用 _fsCache 5min 缓存（原每次 onShow 都发请求） */
  async loadRecentStores() {
    const cached = this._fsCacheGet('recentStores')
    if (cached) { this.setData({ recentStores: cached }); return }
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
      if (seen.length) {
        this._fsCacheSet('recentStores', seen)
        this.setData({ recentStores: seen })
      }
    } catch (e) { console.warn('[fill] loadRecentStores failed:', e && e.message) }
  },

  onStoreChange(e) {
    const i = +e.detail.value
    this._switchStore(i)
  },

  /* 二期: 切换门店统一入口 —— 先 flush 旧店购物车 → 换店 → 恢复新店购物车（防串店） */
  _switchStore(i) {
    const store = this.data.stores[i] || {}
    if (!store || !store.id) return
    if (store.id === (this.data.store || {}).id) return
    this.flushCart()                 // 旧店的已填数量先落盘（fs_cart_<旧id>）
    this.setData({ store, storeIdx: i, cartOpen: false, pendingSubmit: false, lastReported: '' })
    wx.setStorageSync('fs_store_id', store.id !== undefined ? store.id : '')
    this.restoreCart(true)           // 切店：无条件载入新店的购物车（fs_cart_<新id>）
    this.refreshBanners()            // 门店变了，读该门店的上次报单快照
  },

  /* M10: 点击最近报单门店快捷入口 */
  pickRecent(e) {
    const nm = e.currentTarget.dataset.name
    const i = this.data.stores.findIndex(s => s.name === nm)
    if (i >= 0) this._switchStore(i)
  },

  /* 行内填报（2026-09-06）：直接在铺开的商品行上填数量，无需先加入购物车再改
     后端 qty = int(quantity)，小数会被静默截断，因此这里只允许整数 */
  onQtyInput(e) {
    const id = e.currentTarget.dataset.id
    // 只取第一段连续数字：与后端 int(quantity) 行为一致（12.5 -> 12），不会拼成 125
    const m = String(e.detail.value == null ? '' : e.detail.value).match(/\d+/)
    let n = m ? parseInt(m[0], 10) : 0
    if (isNaN(n)) n = 0
    if (n > 99999) n = 99999
    this.setQty(id, n)
  },

  onQtyMinus(e) {
    const id = e.currentTarget.dataset.id
    const cur = (this._qtyMap || {})[id] || 0
    this.setQty(id, cur > 0 ? cur - 1 : 0)
  },

  onQtyPlus(e) {
    const id = e.currentTarget.dataset.id
    this.setQty(id, ((this._qtyMap || {})[id] || 0) + 1)
  },

  /* 统一入口：写入购物车 + 同步行内显示 + 持久化（防抖）
     P1-2: 通过 _prodIndex O(1) 定位商品行，不再全表 find */
  setQty(id, qty) {
    if (id === undefined || id === null) return
    const i = (this._prodIndex || {})[String(id)]
    if (i === undefined) return
    const p = this.data.products[i]
    if (!p) return
    const key = p.id + '|' + (p.unit || '件')
    if (qty > 0) {
      if (this.cartMap[key]) this.cartMap[key].qty = qty
      else this.cartMap[key] = { key, id: p.id, name: p.name, spec: p.spec || '', unit: p.unit || '件', qty }
    } else {
      delete this.cartMap[key]
    }
    this.syncCart()
    // 只更新这一行；值未变时不 setData，避免受控 input 光标跳动
    const val = qty > 0 ? qty : 0
    if (this.data.products[i].qty !== val) {
      this.setData({ ['products[' + i + '].qty']: val })
    }
  },

  toggleCart() { this.setData({ cartOpen: !this.data.cartOpen }) },

  plus(e) {
    const c = this.cartMap[e.currentTarget.dataset.key]
    if (c) { c.qty += 1; this._syncRow(c) }
  },
  minus(e) {
    const c = this.cartMap[e.currentTarget.dataset.key]
    if (!c) return
    c.qty -= 1
    if (c.qty <= 0) delete this.cartMap[e.currentTarget.dataset.key]
    this._syncRow(c)
  },
  removeItem(e) {
    const c = this.cartMap[e.currentTarget.dataset.key]
    delete this.cartMap[e.currentTarget.dataset.key]
    this._syncRow(c)
  },

  /* 购物车区的改动回写到铺开列表的对应行 */
  _syncRow(c) {
    this.syncCart()
    if (!c) return
    const i = (this._prodIndex || {})[String(c.id)]
    if (i === undefined) return
    const cur = this.cartMap[c.key]
    const val = cur ? cur.qty : 0
    if (this.data.products[i].qty !== val) this.setData({ ['products[' + i + '].qty']: val })
  },

  /* P1-1/P1-3: 同步渲染态（只推 cart/cartCount/cartQty 标量与数组，qtyMap 已转实例属性）；
     持久化走 300ms 防抖，连点 +/- 不再每次同步写盘卡顿 */
  syncCart() {
    const cart = Object.keys(this.cartMap).map(k => this.cartMap[k])
    const qtyMap = {}
    let cartQty = 0
    for (const c of cart) { qtyMap[c.id] = c.qty; cartQty += c.qty }
    this._qtyMap = qtyMap
    this.setData({ cart, cartCount: cart.length, cartQty })
    this._schedulePersist(cart, this._cartKey())
  },
  _schedulePersist(cart, key) {
    if (this._persistTimer) clearTimeout(this._persistTimer)
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null
      this._writeCart(cart, key)
    }, 300)
  },
  _writeCart(cart, key) {
    if (!key) return
    try { wx.setStorageSync(key, cart) } catch (e) { console.warn('[fill] persist cart failed:', e) }
  },
  /* 页面切走/销毁前把未落盘的购物车强制写入（防抖窗口内的最后一次不丢） */
  flushCart() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer)
      this._persistTimer = null
    }
    const cart = Object.keys(this.cartMap).map(k => this.cartMap[k])
    this._writeCart(cart, this._cartKey())
  },
  onHide() { this.flushCart() },
  onUnload() { this.flushCart() },

  /* 提交入口：外层兜底。此前前端异常（未定义变量等）会静默失败，表现为「点了没反应」，
     这里统一捕获并给出提示，同时保证 submitting 一定复位，避免按钮永久禁用。 */
  async submit() {
    try {
      await this._doSubmit()
    } catch (e) {
      console.error('[fill] submit error:', e)
      wx.showToast({ title: '提交异常：' + ((e && e.message) ? e.message.slice(0, 30) : '请重试'), icon: 'none' })
    } finally {
      if (this.data.submitting) this.setData({ submitting: false })
    }
  },

  async _doSubmit() {
    const { cart, store, period, cartQty } = this.data
    if (!cart.length) {
      wx.showToast({ title: '还没填数量，先在商品行填数量', icon: 'none' })
      return
    }
    if (!store || !store.id) {
      wx.showToast({ title: '请先选择报单门店', icon: 'none' })
      return
    }
    if (!period || !period.id) {
      wx.showToast({ title: '请先选择报单期次', icon: 'none' })
      return
    }
    // 2026-09-06：同一门店 + 同一期次已报过 —— 先确认，避免"数据留着"导致误重复下单
    const dup = wx.getStorageSync(this._subKey())
    let confirmed = false
    if (dup && dup.sid) {
      const ok = await new Promise(res => {
        wx.showModal({
          title: '本期已报过',
          content: `${store.name} 在「${period.name}」已报 ${dup.count} 项 / ${dup.qty} 件（单号 ${dup.sid}）。\n再提交会新增一单，确定继续？`,
          confirmText: '仍要提交', cancelText: '去查看',
          success: (r) => res(!!r.confirm),
          fail: () => res(false)
        })
      })
      if (!ok) { wx.switchTab({ url: '/pages/mine/mine' }); return }
      confirmed = true
    }
    // 二期 Q2: 首次提交也加一次性确认（展示门店/期次/数量摘要，防误触提交）
    if (!confirmed) {
      const ok = await new Promise(res => {
        wx.showModal({
          title: '确认提交预报？',
          content: `门店：${store.name}\n期次：${period.name || period.display || ''}\n共 ${cart.length} 项 / ${cartQty} 件`,
          confirmText: '确认提交', cancelText: '再检查',
          confirmColor: '#06b6d4',
          success: (r) => res(!!r.confirm),
          fail: () => res(false)
        })
      })
      if (!ok) return
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
      // 2026-09-06：提交成功后**不再清空**——数据留在页面上，方便查看/微调/下期沿用
      try {
        const snapshot = {
          periodId: period.id, periodName: period.name || '',
          at: new Date().toISOString().slice(0, 16).replace('T', ' '),
          count: cart.length, qty: total,
          items: cart.map(c => ({ id: c.id, name: c.name, spec: c.spec, unit: c.unit, qty: c.qty }))
        }
        wx.setStorageSync(this._lastKey(), snapshot)
        wx.setStorageSync(this._subKey(), {
          sid: (d && (d.id || d.submission_id)) || '', count: cart.length, qty: total,
          at: snapshot.at
        })
      } catch (e) { console.warn('[fill] save last order failed:', e) }
      this.refreshBanners()
      wx.showModal({
        title: '提交成功',
        content: `${msg}\n内容已保留在页面，可继续修改；换期次后也能一键带入上次报单。`,
        confirmText: '查看我的报单',
        cancelText: '留在本页',
        success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/mine/mine' }) }
      })
      this.setData({ pendingSubmit: false, cartOpen: false })
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
  /* 查看我的报单（mine 在 tabBar 内；summary 已移出 tabBar，只能 navigateTo） */
  goSummary() {
    wx.switchTab({ url: '/pages/mine/mine' })
  },
  clearCart() {
    this.cartMap = {}
    this.syncCart()
    this.clearRowQty()
    this.setData({ pendingSubmit: false, lastReported: '', cartOpen: false })
  },

  /* 清空所有行内已填数量（提交成功 / 清空购物车后） */
  clearRowQty() {
    const patch = {}
    this.data.products.forEach((p, i) => { if (p.qty) patch['products[' + i + '].qty'] = 0 })
    if (Object.keys(patch).length) this.setData(patch)
  }
})
