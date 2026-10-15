#!/usr/bin/env node
/* v393 判据台：小程序「提交前明细核对层」
   （pages/fill/fill.js + fill.wxml + fill.wxss）

   v421（2026-10-09）扩展：补 S8/S9 —— 层内「未填项」点击后的**定位链**。
   🔴 要守住的那件事：用户点它就是为了**不自己找**。v420 的实现在目标尚未被
      分页加载时会弹「请在列表里找这一项」并把活儿推回用户 —— S9 就是钉住这条
      假实现的回归测试（目标不在 `_prodIndex` 里 ⇒ 必须走搜索把它拉进首屏并定位）。

   用户原话：「提交报单的时候，弹窗里边能不能显示本次提交的这个订单的明细，让用户可以
             检查自己。如果不合适，可以直接点取消，然后返回去再修改。」

   做法（照 v279 / v298 判据台范式，**不重写实现**）：
     · 把**整份真实 fill.js** 用 `vm` 装载进一个最小沙箱（mock 掉 `wx` / `getApp` / `require`），
       捕获它交给 `Page()` 的那个对象 —— 验的就是线上那份代码，不是"我以为的实现"。
     · 每个场景都从干净 storage 起跑，断言走**真实 `_doSubmit()`**。
   🔴 反例对照是硬要求：S7 用同一份数据跑一条**故意写错的期望**，
      它必须 FAIL —— 否则说明断言没有判别力，前面的 PASS 全都不算数。

   用法：node v393-miniprogram-confirm-sheet-harness.mjs
   退出码：0 = 全绿；1 = 有 FAIL
*/
import fs from 'node:fs'
import vm from 'node:vm'

const MP = '/Users/zhangjunfeng/Documents/laozhangai-product/forecast-order-miniprogram-20260812T023419087Z/miniprogram'
const FILL_JS = MP + '/pages/fill/fill.js'
const FILL_WXML = MP + '/pages/fill/fill.wxml'
const FILL_WXSS = MP + '/pages/fill/fill.wxss'

let PASS = 0, FAIL = 0
function ck(desc, got, exp) {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  if (ok) PASS++; else FAIL++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${desc}`)
  if (!ok) console.log(`         实测 = ${JSON.stringify(got)}\n         期望 = ${JSON.stringify(exp)}`)
}

/* ---------------- 沙箱 ---------------- */
let captured = null
let modalQueue = []
const modalCalls = []
const requests = []
const toasts = []
const switchTabs = []
let storage = Object.create(null)

const pageScrolls = []
const wx = {
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v },
  removeStorageSync: (k) => { delete storage[k] },
  showModal: (o) => {
    modalCalls.push({ title: o.title, content: o.content, confirmText: o.confirmText, cancelText: o.cancelText })
    const ans = modalQueue.length ? modalQueue.shift() : true
    if (o.success) o.success({ confirm: ans })
  },
  showToast: (o) => toasts.push(o),
  switchTab: (o) => switchTabs.push(o),
  navigateTo: () => {}, showLoading: () => {}, hideLoading: () => {},
  setClipboardData: (o) => { if (o.success) o.success({}) },
  createSelectorQuery: () => ({
    in: () => ({
      select: () => ({ boundingClientRect: () => ({}) }),
      selectViewport: () => ({ scrollOffset: () => ({}) }),
      exec: (cb) => cb([{ top: 100 }, { scrollTop: 0 }]),
    }),
  }),
  pageScrollTo: (o) => { pageScrolls.push(o) },
}
/* v421：判据台自己的「本期商品清单」—— `_locateRow()` 的搜索兜底会真的打
   `/products/fill-search?q=...`，这里按 keyword 做同样的「包含」过滤。
   🔴 必须让这条链能走完（找得到 ⇒ 进首屏 ⇒ 定位），否则判据台只会看到空列表，
      变成"实现错了也通过"。999 刻意**不在** BASE 的 3 行里 —— 它模拟
      「本期有目标、但排在 pageSize=30 之后、还没被加载」的商品（= 用户报的那个现场）。 */
const CATALOG = [
  { id: 101, name: '蒙牛纯甄原味', unit: '件' },
  { id: 102, name: '蒙牛特仑苏', unit: '件' },
  { id: 103, name: '简爱裸酸奶', unit: '件' },
  { id: 999, name: '没填的目标品', unit: '件' },
]
const requireMock = (p) => {
  if (/utils\/api$/.test(p)) {
    return {
      request: async (url, method, body) => {
        requests.push({ url, method, body })
        if (String(url).indexOf('/products/fill-search') >= 0) {
          const m = String(url).match(/[?&]q=([^&]*)/)
          const kw = m ? decodeURIComponent(m[1]) : ''
          const items = CATALOG.filter(it => !kw || it.name.indexOf(kw) >= 0)
          return { items, total: items.length, scope: 'period' }
        }
        const q = (body.items || []).reduce((s, i) => s + i.quantity, 0)
        return { id: 'FS20261007001', total_qty: q, created: true }
      },
    }
  }
  if (/utils\/track$/.test(p)) return { track: () => {}, EVENTS: new Proxy({}, { get: (_t, k) => String(k) }) }
  if (/utils\/perm$/.test(p)) return { peekPerms: () => ({}) }
  return {}
}
const sandbox = {
  Page: (o) => { captured = o },
  getApp: () => ({ globalData: {} }),
  require: requireMock,
  wx, console, setTimeout, clearTimeout,
  Date, Math, JSON, Promise, Number, String, Object, Array, RegExp, isNaN, parseInt, parseFloat,
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(FILL_JS, 'utf8'), sandbox, { filename: 'fill.js' })
if (!captured) { console.log('装载失败：没捕获到 Page()'); process.exit(1) }

/* ---------------- 最小 Page 壳 ---------------- */
function applyPatch(data, patch) {
  for (const k of Object.keys(patch)) {
    const m = k.match(/^([A-Za-z_$][\w$]*)((?:\[\d+\]|\.[\w$]+)*)$/)
    if (!m || !m[2]) { data[k] = patch[k]; continue }
    const segs = m[2].match(/\[\d+\]|\.[\w$]+/g)
    let cur = data[m[1]]
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i]
      cur = s[0] === '[' ? cur[Number(s.slice(1, -1))] : cur[s.slice(1)]
    }
    const last = segs[segs.length - 1]
    if (last[0] === '[') cur[Number(last.slice(1, -1))] = patch[k]
    else cur[last.slice(1)] = patch[k]
  }
}
function makePage(over = {}) {
  const inst = {}
  for (const k of Object.keys(captured)) if (k !== 'data') inst[k] = captured[k]
  inst.data = JSON.parse(JSON.stringify(captured.data))
  Object.assign(inst.data, over.data || {})
  inst._avgMap = over._avgMap || null
  inst._avgMapPid = over._avgMapPid || ''
  inst._prodIndex = over._prodIndex || {}
  if (over._avgHolder !== undefined) inst._avgHolder = over._avgHolder
  inst.setData = function (patch) { applyPatch(this.data, patch) }
  return inst
}
const CART = [
  { key: '101|件', id: 101, name: '蒙牛纯甄原味', spec: '200g*12', unit: '件', qty: 3 },
  { key: '102|件', id: 102, name: '蒙牛特仑苏', spec: '250ml*12', unit: '件', qty: 5 },
  { key: '103|件', id: 103, name: '简爱裸酸奶', spec: '135g*8', unit: '件', qty: 25 },
]
const BASE = () => ({
  store: { id: 5, name: '永诺旗舰店' },
  period: { id: 19, name: '2026-10 第 1 期' },
  cart: JSON.parse(JSON.stringify(CART)),
  cartCount: 3, cartQty: 33,
  products: [
    { id: 101, name: '蒙牛纯甄原味', unit: '件', qty: 3 },
    { id: 102, name: '蒙牛特仑苏', unit: '件', qty: 5 },
    { id: 103, name: '简爱裸酸奶', unit: '件', qty: 25 },
  ],
})
const PROD_INDEX = { '101': 0, '102': 1, '103': 2 }
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
function reset() {
  modalCalls.length = 0; requests.length = 0; toasts.length = 0; switchTabs.length = 0
  modalQueue = []; storage = Object.create(null)
}

/* ---------------- 场景 ---------------- */
async function s1() {
  console.log('\n=== S1 首次提交（无目标 / 无 dup）⇒ 打开明细层，且不落库 ===')
  reset()
  const inst = makePage({ data: BASE() })
  inst._prodIndex = PROD_INDEX
  const p = inst._doSubmit()
  await tick(4)
  ck('未弹任何原生弹窗（无目标、无改单）', modalCalls.length, 0)
  ck('明细层已打开', inst.data.confirmOpen, true)
  ck('明细行数 = 本次填报项数', inst.data.confirmRows.length, 3)
  ck('明细行（名称/数量/单位，顺序与填报一致）',
    inst.data.confirmRows.map(r => [r.name, r.qty, r.unit]),
    [['蒙牛纯甄原味', 3, '件'], ['蒙牛特仑苏', 5, '件'], ['简爱裸酸奶', 25, '件']])
  ck('无改单提示', inst.data.confirmDup, null)
  ck('无未达标汇总', inst.data.confirmLow, 0)
  ck('此刻尚未发起提交请求', requests.length, 0)

  inst.cancelConfirm()
  await p
  ck('点「返回修改」⇒ 不落库', requests.length, 0)
  ck('已填数量一项未动', inst.data.cart.map(c => c.qty), [3, 5, 25])
  ck('商品行内数量未动（第 3 行）', inst.data.products[2].qty, 25)
  ck('明细层已关闭', inst.data.confirmOpen, false)
}

async function s2() {
  console.log('\n=== S2 明细层点「确认提交」⇒ 明细与提交内容逐项一致 ===')
  reset()
  const inst = makePage({ data: BASE() })
  inst._prodIndex = PROD_INDEX
  const p = inst._doSubmit()
  await tick(4)
  inst.confirmSubmit()
  await p
  ck('提交请求发出 1 次', requests.length, 1)
  ck('提交内容与核对层逐项一致（id + 数量，同序）',
    requests[0].body.items.map(i => [i.product_id, i.quantity]),
    [[101, 3], [102, 5], [103, 25]])
  ck('提交后出现结果卡单号', (inst.data.submitResult || {}).sid, 'FS20261007001')
  ck('明细层已关闭', inst.data.confirmOpen, false)
}

async function s3() {
  console.log('\n=== S3 改单（本期已报过）⇒ 不弹原生弹窗、直接进明细层（v419 方案 2）===')
  reset()
  const inst = makePage({ data: BASE() })
  inst._prodIndex = PROD_INDEX
  storage['fs_sub_5_19'] = { sid: 'FS2026OLD', count: 2, qty: 9, at: '2026-10-07 09:00' }
  const p = inst._doSubmit()
  await tick(4)
  ck('不再弹原生弹窗（两条提醒已并进层内）', modalCalls.length, 0)
  ck('改单路径也打开了明细层', inst.data.confirmOpen, true)
  ck('层内带改单提示（单号不变）', (inst.data.confirmDup || {}).sid, 'FS2026OLD')
  ck('层内带「已报 n 项 / M 件」（原弹窗正文的信息）',
    [(inst.data.confirmDup || {}).count, (inst.data.confirmDup || {}).qty], [2, 9])
  inst.cancelConfirm()
  await p
  ck('点「返回修改」⇒ 不落库', requests.length, 0)
}

async function s4() {
  console.log('\n=== S4 层内点「去查看」⇒ 关层、跳「我的提交」、不落库 ===')
  reset()
  const inst = makePage({ data: BASE() })
  inst._prodIndex = PROD_INDEX
  storage['fs_sub_5_19'] = { sid: 'FS2026OLD', count: 2, qty: 9, at: '2026-10-07 09:00' }
  const p = inst._doSubmit()
  await tick(4)
  ck('层已打开（改单不再有前置弹窗）', inst.data.confirmOpen, true)
  inst.goMine()
  await p
  ck('关层', inst.data.confirmOpen, false)
  ck('跳转到「我的报单」', switchTabs.map(s => s.url), ['/pages/mine/mine'])
  ck('不落库', requests.length, 0)
}

async function s5() {
  console.log('\n=== S5 未达标商品在明细里标红；未填的目标商品不进明细 ===')
  reset()
  const inst = makePage({
    data: BASE(),
    _avgMap: {
      '101': { product_name: '蒙牛纯甄原味', flags: {}, avg_per_unit: { '件': 12 } },
      '999': { product_name: '没填的目标品', flags: {}, avg_per_unit: { '件': 10 } },
    },
    _avgMapPid: 19,
  })
  inst._prodIndex = PROD_INDEX
  const p = inst._doSubmit()
  await tick(4)
  ck('不再弹原生弹窗（v419 方案 2：提醒并进层内）', modalCalls.length, 0)
  ck('层内标题「低于均单目标」（D21/D25/D27 锚点：只有「低于」时保持原文案）',
    /低于均单目标/.test(inst.data.confirmLowTitle || ''), true)
  ck('层内列出未达标明细行（原弹窗正文的信息）', inst.data.confirmLowRows.length, 1)
  ck('明细层打开', inst.data.confirmOpen, true)
  ck('未达标行被标出',
    (inst.data.confirmRows.find(r => r.name === '蒙牛纯甄原味') || {}).low, '未达标')
  ck('未填的目标商品不进明细（它不属于本单）',
    inst.data.confirmRows.some(r => r.name === '没填的目标品'), false)
  ck('未达标计数 = 1', inst.data.confirmLow, 1)
  inst.cancelConfirm()
  await p
}

function s6() {
  console.log('\n=== S6 静态面：既有验收文案与层级关系 ===')
  const wxml = fs.readFileSync(FILL_WXML, 'utf8')
  const wxss = fs.readFileSync(FILL_WXSS, 'utf8')
  const js = fs.readFileSync(FILL_JS, 'utf8')
  ck('wxml 标题仍为「确认提交预报？」（D21/D22/D24 锚点）', wxml.includes('确认提交预报？'), true)
  ck('wxml 面板拦冒泡 catchtap="noop"', wxml.includes('catchtap="noop"'), true)
  ck('wxml 遮罩拦滚动穿透 catchtouchmove="noop"', wxml.includes('catchtouchmove="noop"'), true)
  ck('js 有 noop()', /noop\(\)\s*\{\}/.test(js), true)
  ck('js 有 confirmSubmit / cancelConfirm', js.includes('confirmSubmit()') && js.includes('cancelConfirm()'), true)
  /* v419 方案 2：两条提醒（未达标 / 已报过）从「原生弹窗」搬进层内 —— 文案一字未改，只换载体。 */
  ck('wxml 保留 D30 锚点串「本期已报过，这次是更新同一单」',
    wxml.includes('本期已报过，这次是更新同一单'), true)
  ck('wxml 保留「（单号 … 不变，不会多出一条）」', wxml.includes('不变，不会多出一条'), true)
  ck('wxml 有层内「去查看」出口（catchtap="goMine"）', wxml.includes('catchtap="goMine"'), true)
  ck('js 有 goMine()', js.includes('goMine()'), true)
  ck('wxml 有未达标提醒清单 .cf-warn（v419）', wxml.includes('cf-warn'), true)
  ck('wxml 清单绑定 confirmLowRows', wxml.includes('confirmLowRows'), true)
  ck('js 层内标题取值 confirmLowTitle（v419）', js.includes('confirmLowTitle'), true)
  ck('js 中 wx.showModal 调用只剩样单路径 1 处（提交链路已无原生弹窗）',
    (js.match(/wx\.showModal\(\{/g) || []).length, 1)
  ck('wxss 有 .cf-warn 样式（新类名不漏定义）', /\.cf-warn\{/.test(wxss), true)
  const zi = (cls) => {
    const m = wxss.match(new RegExp('\\.' + cls + '\\{[^}]*z-index:(\\d+)'))
    return m ? Number(m[1]) : null
  }
  console.log(`         （z-index 实测：cf-mask=${zi('cf-mask')} bottom-dock=${zi('bottom-dock')} back-top=${zi('back-top')}）`)
  ck('明细层层级高于底部提交栏', zi('cf-mask') > zi('bottom-dock'), true)
  ck('明细层层级高于回到顶部按钮', zi('cf-mask') > zi('back-top'), true)
}

async function s7(rowsLen) {
  console.log('\n=== S7 判别力自证：故意写错的期望必须 FAIL ===')
  ck('正向：明细行数 = 3（应 PASS）', rowsLen, 3)
  const before = FAIL
  ck('负向：明细行数 = 4（预期 FAIL）', rowsLen, 4)
  const hasPower = (FAIL === before + 1)
  console.log(hasPower
    ? '  [PASS] 判别力自证：负向断言确实 FAIL ⇒ 断言有判别力'
    : '  [FAIL] 判别力自证：负向断言竟然通过 ⇒ 断言无判别力，前面结果不可信')
  FAIL = before
  if (hasPower) PASS++; else FAIL++
}

async function s8() {
  console.log('\n=== S8 v421 点「未填」项（目标已在列表里）→ 关层 + 滚动/高亮/聚焦 + 不落库 ===')
  reset()
  const inst = makePage({
    data: Object.assign(BASE(), {
      products: BASE().products.concat([{ id: 999, name: '没填的目标品', unit: '件', qty: 0 }]),
    }),
    _avgMap: {
      '101': { product_name: '蒙牛纯甄原味', unit: '件', flags: {}, avg_per_unit: { '件': 3 } },
      '999': { product_name: '没填的目标品', unit: '件', flags: {}, avg_per_unit: { '件': 10 } },
    },
    _avgMapPid: 19,
  })
  inst._prodIndex = Object.assign({ '999': 3 }, PROD_INDEX)   // 目标已在当前列表里 ⇒ 不该再发搜索
  modalQueue = []
  const p = inst._doSubmit()
  await tick(4)
  ck('明细层打开', inst.data.confirmOpen, true)
  ck('层内有未填项（confirmLowRows）', inst.data.confirmLowRows.length, 1)
  const row = inst.data.confirmLowRows[0]
  const targetId = row.id
  ck('未填项 id = 999', targetId, 999)
  ck('未填项带 name（v421 定位兜底要用它）', row.name, '没填的目标品')
  pageScrolls.length = 0
  requests.length = 0
  toasts.length = 0
  inst.jumpToLow({ currentTarget: { dataset: { id: targetId, name: row.name } } })
  ck('点后关层（= 返回修改语义，不落库不动数量）', inst.data.confirmOpen, false)
  ck('未落库（没提交）', requests.length, 0)
  await sleep(300)   // 等 `_scrollTo` 的「先滚动、后聚焦」那 220ms
  ck('触发主列表滚动定位（pageScrollTo 被调用 1 次）', pageScrolls.length, 1)
  ck('高亮 flashId = 目标商品', inst.data.flashId, targetId)
  ck('聚焦 focusId = 目标商品（键盘直接弹到这一行）', inst.data.focusId, targetId)
  ck('已在列表里 ⇒ 一次到位、零提示', toasts.length, 0)
}

async function s9() {
  console.log('\n=== S9 v421（用户报的现场）目标尚未被分页加载 → 必须搜索定位，绝不甩回用户 ===')
  reset()
  const inst = makePage({
    data: BASE(),
    _avgMap: {
      '101': { product_name: '蒙牛纯甄原味', unit: '件', flags: {}, avg_per_unit: { '件': 3 } },
      '999': { product_name: '没填的目标品', unit: '件', flags: {}, avg_per_unit: { '件': 10 } },
    },
    _avgMapPid: 19,
  })
  inst._prodIndex = PROD_INDEX     // 只有 101/102/103 ⇒ 999 查不到（= 排在 pageSize=30 之后）
  modalQueue = []
  const p = inst._doSubmit()
  await tick(4)
  const row = inst.data.confirmLowRows[0]
  ck('未填项 id = 999', row.id, 999)
  ck('前置：999 不在当前列表索引里（正是生产上的现场）', inst._hasRow(999), false)
  pageScrolls.length = 0
  requests.length = 0
  toasts.length = 0
  inst.jumpToLow({ currentTarget: { dataset: { id: row.id, name: row.name } } })
  await sleep(150)
  const searches = requests.filter(r => String(r.url).indexOf('fill-search') >= 0)
  ck('发起了「清单内搜索」（1 次）', searches.length, 1)
  ck('搜索词 = 该商品的完整名字',
    searches.length ? decodeURIComponent((searches[0].url.match(/[?&]q=([^&]*)/) || [])[1] || '') : '',
    '没填的目标品')
  ck('搜索把目标拉进了首屏（products 里出现 999）',
    inst.data.products.map(x => x.id).indexOf(999) >= 0, true)
  await sleep(300)
  ck('搜索成功后照样定位（pageScrollTo 1 次）', pageScrolls.length, 1)
  ck('高亮落在目标商品上', inst.data.flashId, 999)
  ck('🔴 没有出现「请在列表里找这一项」（钉死 v420 的假实现）',
    toasts.filter(t => String(t.title).indexOf('列表里找') >= 0).length, 0)
  ck('🔴 一次到位、零提示（toasts 为空）', toasts.length, 0)

  /* 判别力自证：把目标从「本期清单」里摘掉（= 真的搜不到）⇒ **必须**给出一个
     能行动的提示，且**仍然不许**是 v420 那句甩锅文案。
     若这段不 FAIL 也别通过 —— 它证明的是"断言真的在看提示内容"。 */
  reset()
  const inst2 = makePage({
    data: BASE(),
    _avgMap: { '999': { product_name: '没填的目标品', unit: '件', flags: {}, avg_per_unit: { '件': 10 } } },
    _avgMapPid: 19,
  })
  inst2._prodIndex = PROD_INDEX
  modalQueue = []
  const p2 = inst2._doSubmit()
  await tick(4)
  const row2 = inst2.data.confirmLowRows[0]
  CATALOG.splice(CATALOG.findIndex(x => x.id === 999), 1)   // 确保搜不到
  toasts.length = 0
  inst2.jumpToLow({ currentTarget: { dataset: { id: row2.id, name: row2.name } } })
  await sleep(300)
  ck('真搜不到时给出**能行动**的提示（指向搜索框）',
    toasts.map(t => String(t.title)).join('|').indexOf('搜索框') >= 0, true)
  ck('真搜不到时也**不许**写「请在列表里找」（文案纪律）',
    toasts.filter(t => String(t.title).indexOf('列表里找') >= 0).length, 0)
  CATALOG.push({ id: 999, name: '没填的目标品', unit: '件' })   // 复原，别影响别的场景
}

/* ---------------- 跑 ---------------- */
async function s10() {
  console.log('\n=== S10 v433 常驻「一键清空」：确认后清掉全部已填数量，取消则不动 ===')
  // (a) 确认 ⇒ 清空
  reset()
  const inst = makePage({ data: BASE() })
  inst.cartMap = JSON.parse(JSON.stringify(CART))
  modalQueue = [true]                 // showModal 回 confirm=true
  inst.onClearAll()
  ck('弹了确认框（title 含「清空」）', modalCalls.some(m => String(m.title).indexOf('清空') >= 0), true)
  ck('确认后 cartCount 归零', inst.data.cartCount, 0)
  ck('确认后 cartQty 归零', inst.data.cartQty, 0)
  ck('确认后购物车数组清空', inst.data.cart.length, 0)
  ck('确认后所有行内 qty 归零', inst.data.products.every(p => p.qty === 0), true)
  ck('确认后 cartMap 清空', Object.keys(inst.cartMap).length, 0)

  // (b) 取消 ⇒ 不动
  reset()
  const inst2 = makePage({ data: BASE() })
  inst2.cartMap = JSON.parse(JSON.stringify(CART))
  modalQueue = [false]                // 用户点取消
  inst2.onClearAll()
  ck('也弹了确认框', modalCalls.some(m => String(m.title).indexOf('清空') >= 0), true)
  ck('取消后 cartCount 不变', inst2.data.cartCount, 3)
  ck('取消后 cartQty 不变', inst2.data.cartQty, 33)
  ck('取消后行内数量不变（第 3 行 = 25）', inst2.data.products[2].qty, 25)
  ck('取消后 cartMap 不变', Object.keys(inst2.cartMap).length, 3)

  // (c) 没填数量时不弹（按钮本就 wx:if 不显示，方法自身也防护）
  reset()
  const inst3 = makePage({ data: BASE() })
  inst3.data.cartCount = 0
  modalQueue = []
  inst3.onClearAll()
  ck('cartCount=0 时不弹确认框（自防护）', modalCalls.length, 0)
}
async function s11() {
  console.log('\n=== S11 v434 「我的提交」复制某期 → 带入当前填报（同店/异店/越界/未就绪）===')
  // (a) 同门店：直接带入；BASE 已有 3 项 ⇒ 触发覆盖确认，确认后带入源单
  reset()
  const inst = makePage({ data: Object.assign(BASE(), {
    stores: [{ id: 5, kind: 'store', name: '永诺旗舰店' }],
    store: { id: 5, kind: 'store', name: '永诺旗舰店' },
    total: 3,
  }) })
  inst._prodIndex = PROD_INDEX
  inst._pendingCopy = {
    store_id: 5, store_kind: 'store', store_name: '永诺旗舰店', period_id: 9,
    name: '2026-09-19 · 永诺旗舰店',
    items: [{ product_id: 101, product_name: '蒙牛纯甄原味', unit: '件', quantity: 4 }],
  }
  modalQueue = [true]                        // 覆盖确认 → 是
  inst._maybeApplyPendingCopy()
  ck('同门店：带入前弹「覆盖当前已填内容?」确认', modalCalls.some(m => String(m.title).indexOf('覆盖') >= 0), true)
  ck('同门店：带入后购物车只剩源单的 1 项', inst.data.cartCount, 1)
  ck('同门店：带入后 cartQty = 源数量 4', inst.data.cartQty, 4)
  ck('同门店：行内数量回填（101→4，其余归 0）', inst.data.products.map(p => p.qty), [4, 0, 0])
  ck('同门店：样单说明条已出（_applySample 生效）', !!inst.data.sampleInfo, true)
  ck('同门店：pendingCopy 消费后清空（只带入一次）', inst._pendingCopy, null)

  // (b) 异门店且目标在列表 ⇒ 先切店（id=5）再带入
  reset()
  const inst2 = makePage({ data: Object.assign(BASE(), {
    stores: [{ id: 7, kind: 'store', name: 'B店' }, { id: 5, kind: 'store', name: '永诺旗舰店' }],
    store: { id: 7, kind: 'store', name: 'B店' }, storeIdx: 0, total: 3,
  }) })
  inst2._prodIndex = PROD_INDEX
  inst2._pendingCopy = {
    store_id: 5, store_kind: 'store', store_name: '永诺旗舰店', period_id: 9, name: 'x',
    items: [{ product_id: 102, product_name: '蒙牛特仑苏', unit: '件', quantity: 7 }],
  }
  modalQueue = [true]
  inst2._maybeApplyPendingCopy()
  ck('异门店：先切到源单门店（id=5）', inst2.data.store.id, 5)
  ck('异门店：带入生效（cartQty = 7）', inst2.data.cartQty, 7)

  // (c) 目标门店不在列表 ⇒ 明确拒绝、不带入、不切店、不动当前内容
  reset()
  const inst3 = makePage({ data: Object.assign(BASE(), {
    stores: [{ id: 6, kind: 'store', name: 'C店' }],
    store: { id: 6, kind: 'store', name: 'C店' }, total: 3,
  }) })
  inst3._prodIndex = PROD_INDEX
  inst3._pendingCopy = {
    store_id: 99, store_kind: 'store', store_name: '已停用店', period_id: 9, name: 'x',
    items: [{ product_id: 101, unit: '件', quantity: 4 }],
  }
  modalQueue = []
  inst3._maybeApplyPendingCopy()
  ck('越界：弹「无法带入」而非硬塞', modalCalls.some(m => String(m.title).indexOf('无法带入') >= 0), true)
  ck('越界：不带入（cartCount 不变 = 3）', inst3.data.cartCount, 3)
  ck('越界：不切店（仍是 id=6）', inst3.data.store.id, 6)

  // (d) 门店/商品都未就绪 ⇒ 有界重试到顶后明确提示、清 pending（不无限重试、不静默）
  reset()
  const inst4 = makePage({ data: Object.assign(BASE(), { stores: [] }) })
  inst4.data.products = []
  inst4._pendingCopy = { store_id: 5, store_kind: 'store', name: 'x', items: [{ product_id: 101, unit: '件', quantity: 1 }] }
  inst4._maybeApplyPendingCopy(16)           // 直接推到重试上限
  ck('未就绪超时：明确提示（不静默吞掉）', toasts.some(t => String(t.title).indexOf('加载') >= 0 || String(t.title).indexOf('重试') >= 0), true)
  ck('未就绪超时：清掉 pending（避免无限重试）', inst4._pendingCopy, null)
}

await s1(); await s2(); await s3(); await s4(); await s5(); s6(); await s8(); await s9(); await s10(); await s11()
reset()
{
  const inst = makePage({ data: BASE() })
  inst._prodIndex = PROD_INDEX
  const p = inst._doSubmit()
  await tick(4)
  await s7(inst.data.confirmRows.length)
  inst.cancelConfirm()
  await p
}

console.log(`\n结果: ${PASS} 通过 / ${FAIL} 失败`)
process.exit(FAIL ? 1 : 0)
