#!/usr/bin/env node
/* v393 判据台：小程序「提交前明细核对层」
   （pages/fill/fill.js + fill.wxml + fill.wxss）

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
}
const requireMock = (p) => {
  if (/utils\/api$/.test(p)) {
    return {
      request: async (url, method, body) => {
        requests.push({ url, method, body })
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
  console.log('\n=== S3 改单（本期已报过）⇒ 仍打开明细层（本轮修的洞）===')
  reset()
  const inst = makePage({ data: BASE() })
  inst._prodIndex = PROD_INDEX
  storage['fs_sub_5_19'] = { sid: 'FS2026OLD', count: 2, qty: 9, at: '2026-10-07 09:00' }
  modalQueue = [true]
  const p = inst._doSubmit()
  await tick(4)
  ck('弹了 1 个原生弹窗', modalCalls.length, 1)
  ck('弹窗标题（D1 验收锚点，一字未改）', modalCalls[0].title, '本期已报过，将更新这一单')
  ck('改单路径也打开了明细层', inst.data.confirmOpen, true)
  ck('层内带改单提示（单号不变）', (inst.data.confirmDup || {}).sid, 'FS2026OLD')
  inst.cancelConfirm()
  await p
  ck('点「返回修改」⇒ 不落库', requests.length, 0)
}

async function s4() {
  console.log('\n=== S4 改单弹窗点「去查看」⇒ 不进明细层、不落库 ===')
  reset()
  const inst = makePage({ data: BASE() })
  inst._prodIndex = PROD_INDEX
  storage['fs_sub_5_19'] = { sid: 'FS2026OLD', count: 2, qty: 9, at: '2026-10-07 09:00' }
  modalQueue = [false]
  const p = inst._doSubmit()
  await tick(4)
  ck('未打开明细层', inst.data.confirmOpen, false)
  await p
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
  modalQueue = [true]
  const p = inst._doSubmit()
  await tick(4)
  ck('先弹未达标提醒（D21/D25 锚点：只有「低于」时保持原文案）',
    /低于均单目标/.test(modalCalls[0] ? modalCalls[0].title : ''), true)
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
  ck('js 仍保留「本期已报过，将更新这一单」（D1 锚点）', js.includes('本期已报过，将更新这一单'), true)
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

/* ---------------- 跑 ---------------- */
await s1(); await s2(); await s3(); await s4(); await s5(); s6()
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
