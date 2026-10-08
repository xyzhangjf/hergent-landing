/* v298（2026-09-27）小程序「商品目标/均单目标」提交前校验 —— 判别力判据台
 *
 * 为什么有这个文件：用户报「填了但未达标 → 提示；完全没填 → 不提示」。
 * 修完后必须证明三件事，缺一条都不算验过：
 *   ① 两种成因现在**都提示**，且走同一条弹窗（行为一致）；
 *   ② 修复**真的改变了行为**（拿旧实现跑同一场景 ⇒ 旧=少/无，新=有）；
 *   ③ 没弄坏原来对的东西（达标不打扰、等于目标不弹、接口挂了不挡报单、期次校验仍生效）。
 *
 * 🔴 三条纪律（本项目的血泪）：
 *   · **绝不手抄函数**：整份 pages/fill/fill.js 丢进 vm，捕获 Page() 参数 = 真实 Page 对象。
 *   · **输入是真响应**：/tmp/v298/avg-target.json + fill-search.json 由提审账号打**生产**接口
 *     原样 dump（见 /tmp/v298_dump_real.py）。
 *   · **mock 的 request 按 limit/offset/q/brand 真实分页过滤** —— 这样"只滚到首屏 30 行"、
 *     "搜索后列表变子集"都是**跑出来的**，不是把 products 手填出来。
 *
 * ⚠️ 两处从真机行为里学到的硬约束，写判据台时踩过、记在这里：
 *   ① `setQty(id)` 对**未加载的行是 no-op**（`_prodIndex` 里没有就直接 return）⇒ 想填
 *      1556（列表第 52 位）/ 1596（第 94 位）就必须先真的翻页加载出来。
 *   ② `_doSubmit()` 开头有 `if (!cart.length) { … return }` ⇒ **购物车全空时根本走不到**
 *      均单校验。所以"完全未填"在真机上必然是**「填了一部分、另一些留空」**这个形态。
 *
 * 运行：node .workbuddy/tools/v298-miniprogram-target-validation.mjs
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

const ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product'
const MP = path.join(ROOT, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const FILE = path.join(MP, 'pages/fill/fill.js')
const FIX = '/tmp/v298'

const AVG = JSON.parse(fs.readFileSync(path.join(FIX, 'avg-target.json'), 'utf8'))
const FILL = JSON.parse(fs.readFileSync(path.join(FIX, 'fill-search.json'), 'utf8'))
const ALL = FILL.items || []

const PERIOD = 19

/* ─────────────── 断言器 ─────────────── */
let PASS = 0, FAIL = 0
const FAILS = []
function ok(cond, label, detail) {
  if (cond) { PASS++; console.log('  [OK] ' + label + (detail ? '  -> ' + detail : '')) }
  else { FAIL++; FAILS.push(label); console.log('  [NG] ' + label + (detail ? '  -> ' + detail : '')) }
  return !!cond
}
function head(t) { console.log('\n=== ' + t + ' ===') }

/* ─────────────── §4 可观测性前置 ─────────────── */
head('§4 先在真实数据上确认「这条判据可不可观测」')
const itemsAll = AVG.items || {}
const withTarget = Object.keys(itemsAll).filter(k => !(itemsAll[k].flags || {}).no_target)
ok(Object.keys(itemsAll).length === ALL.length, 'avg-target 的 154 项 与 fill-search 的 154 行 同源同量',
  Object.keys(itemsAll).length + ' vs ' + ALL.length)
ok(withTarget.length === 3, '本期真正「有目标」的商品恰好 3 个（= 判据的观测窗口）', withTarget.join(','))
const noTargetCnt = Object.keys(itemsAll).filter(k => (itemsAll[k].flags || {}).no_target).length
ok(noTargetCnt === 151, '其余 151 个全是 no_target ⇒ 必须一个都不提示（R8：不拿 0 冒充）', 'no_target=' + noTargetCnt)
const idxOf = {}
ALL.forEach((p, i) => { idxOf[String(p.id)] = i })
ok(idxOf['1556'] >= 30 && idxOf['1596'] >= 30,
  '⚠️ 判别力来源：1556/1596 在列表第 52/94 位（**首屏 30 行之外**，不翻页看不见）',
  'idx 1494=' + idxOf['1494'] + ' 1556=' + idxOf['1556'] + ' 1596=' + idxOf['1596'])

/* ─────────────── vm 装载真实 fill.js ─────────────── */
let OPTS = null
const CALLS = []
let AVG_MODE = 'ok'          // ok | fail
function request(p, method, body) {
  CALLS.push({ p, method: (method || 'GET').toUpperCase() })
  if (p.indexOf('/api/product-targets/avg-target') === 0) {
    return AVG_MODE === 'fail' ? Promise.reject(new Error('HTTP 500')) : Promise.resolve(AVG)
  }
  if (p.indexOf('/api/products/fill-search') === 0) {
    // 🔴 按 limit/offset/q/brand **真实分页过滤**（与后端同语义），不手造 products
    const u = new URL('http://x' + p)
    const limit = Number(u.searchParams.get('limit') || 30)
    const offset = Number(u.searchParams.get('offset') || 0)
    const q = (u.searchParams.get('q') || '').trim()
    let list = ALL
    if (q) list = list.filter(x => (x.name || '').indexOf(q) >= 0 || String(x.barcode || '').indexOf(q) >= 0)
    return Promise.resolve({
      ok: true, items: list.slice(offset, offset + limit),
      total: list.length, scope: 'period', period_id: PERIOD
    })
  }
  if (p.indexOf('/api/forecast-submissions') === 0) {
    return Promise.resolve({ id: 'FS-V298-TEST', total_qty: 42, created: true })
  }
  return Promise.resolve({ items: [], total: 0 })
}

let STORE = {}
const MODALS = []
let ANSWER = () => true
const wxTarget = {
  getStorageSync: (k) => (k in STORE ? STORE[k] : ''),
  setStorageSync: (k, v) => { STORE[k] = v },
  removeStorageSync: (k) => { delete STORE[k] },
  showModal: (o) => {
    MODALS.push({ title: o.title, content: o.content, confirmText: o.confirmText, cancelText: o.cancelText })
    const yes = ANSWER(o)
    setTimeout(() => { o.success && o.success({ confirm: !!yes, cancel: !yes }) }, 0)
  },
  showToast: () => {},
  getNetworkType: (o) => { o && o.success && o.success({ networkType: 'wifi' }) }
}
const wx = new Proxy(wxTarget, { get: (t, k) => (k in t ? t[k] : (() => {})) })

const ctx = {
  getApp: () => ({ globalData: { apiBase: '', token: 'T', user: { role: 'supervisor' }, tenantId: '1' } }),
  require: (p) => p.indexOf('utils/api') >= 0 ? { request }
    : p.indexOf('utils/track') >= 0 ? { track: () => {}, EVENTS: new Proxy({}, { get: () => 'EV' }) }
      : p.indexOf('utils/perm') >= 0 ? { peekPerms: () => ({ known: true, canReport: true, role: 'supervisor' }) }
        : {},
  Page: (o) => { OPTS = o },
  wx,
  console, setTimeout, clearTimeout, setImmediate, Promise, Date, JSON, Math, Object,
  Array, String, Number, Boolean, Set, Map, RegExp, isNaN, parseInt, parseFloat,
  encodeURIComponent, decodeURIComponent, Error, URL
}
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(FILE, 'utf8'), ctx)
if (!OPTS) { console.error('装载失败：没抓到 Page() 参数'); process.exit(2) }
const REAL_METHODS = Object.keys(OPTS).filter(k => typeof OPTS[k] === 'function')
ok(['_lowList', '_doSubmit', 'loadProducts', '_avgTargets', '_avgNum'].every(m => REAL_METHODS.includes(m)),
  '装载的是**真实 Page 对象**（含 _lowList / _doSubmit / loadProducts / _avgTargets / _avgNum）',
  '方法数=' + REAL_METHODS.length)
ok(REAL_METHODS.includes('_avgNums') === false, '`_avgNums` 已从实现里彻底消失（不再有第二份基准）')

function setPath(obj, p, val) {
  const keys = String(p).replace(/\[(\d+)\]/g, '.$1').split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (cur[k] === undefined || cur[k] === null) cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {}
    cur = cur[k]
  }
  cur[keys[keys.length - 1]] = val
}
function mk(over) {
  const inst = Object.assign({}, OPTS)
  inst.data = JSON.parse(JSON.stringify(OPTS.data))
  Object.assign(inst.data, over || {})
  inst.setData = function (p) {
    if (!p) return
    Object.keys(p).forEach(k => {
      if (/[[\].]/.test(k)) setPath(inst.data, k, p[k]); else inst.data[k] = p[k]
    })
  }
  /* 🔴 Page 字面量上的实例属性是**共享引用**（Object.assign 只拷引用）⇒ 必须逐个重置，
     否则场景之间互相污染，跑出来的绿是假的。 */
  inst.cartMap = {}
  inst._qtyMap = {}; inst._prodIndex = {}
  inst._avgMap = {}; inst._avgPid = ''; inst._avgMapPid = ''
  inst._seq = 0; inst._loadedPeriodId = ''
  inst._submitLock = false
  return inst
}
const tick = () => new Promise(r => setImmediate(r))

async function boot(opts) {
  opts = opts || {}
  STORE = {}                                  // 每个场景一份干净 Storage（否则 _subKey 会串到"已报过"分支）
  const inst = mk({
    store: { id: 3, name: '测试门店' },
    period: { id: PERIOD, name: '2026-09-27 报单期次' },
    pageSize: 30
  })
  AVG_MODE = opts.avgFail ? 'fail' : 'ok'     // 🔴 全程保持（loadProducts 内部会再拉一次，提前复位会把它救活）
  await inst.loadAvgTargets(PERIOD)
  if (opts.all) {
    await inst.loadProducts('', false)
    while (inst.data.hasMore && inst.data.products.length < ALL.length) await inst.loadProducts('', true)
  } else if (opts.search) {
    await inst.loadProducts(opts.search, false)
  } else {
    await inst.loadProducts('', false)         // 只滚首屏（真实 pageSize=30）
  }
  if (opts.fill) Object.keys(opts.fill).forEach(k => inst.setQty(Number(k), opts.fill[k]))
  if (opts.thenSearch) await inst.loadProducts(opts.thenSearch, false)
  AVG_MODE = 'ok'
  return inst
}

/* 旧实现对照（**仅用于判别力自证**）：严格复刻修前的两步判据 ——
   ① 基准来自「已渲染的行」(this.data.products)；② 只遍历 cart 且要求 q>0。
   `_avgNum` 未被本次改动碰过，所以复刻是忠实的。 */
function oldLowList(inst) {
  const m = inst._avgMap || {}
  const nums = {}
  inst.data.products.forEach(p => {
    const av = inst._avgNum(m[String(p.id)], p.unit)
    if (av > 0) nums[String(p.id)] = av
  })
  const out = []
  inst.data.cart.forEach(c => {
    const t = nums[String(c.id)]
    const q = Number(c.qty) || 0
    if (t > 0 && q > 0 && q < t) out.push({ name: c.name, unit: c.unit, qty: q, target: t })
  })
  return out
}
const brief = (L) => L.length + ' 条' + (L.length ? ' [' + L.map(x => x.name.slice(0, 8) + (x.empty ? ':未填' : ':' + x.qty) + '/' + x.target).join(', ') + ']' : '')
const byId = (L) => { const o = {}; L.forEach(x => { o[x.id] = x }); return o }

/* ═══════════ S1 判据层：完全未填（购物车全空）═══════════ */
head('S1 完全未填（购物车全空）—— 判据层')
{
  const inst = await boot({})
  const L = inst._lowList()
  ok(inst.data.products.length === 30, '前置：products 确实只有首屏 30 行（真实分页）', 'len=' + inst.data.products.length)
  ok(inst.data.cart.length === 0, '前置：购物车为空')
  ok(L.length === 3, '**新**：3 个有目标的商品全部被提示（修前是 0 条）', brief(L))
  ok(L.every(x => x.empty === true), '3 条的 empty 全是 true（成因 = 未填，供文案分叉）')
  ok(oldLowList(inst).length === 0, '**判别力自证**：同一场景跑旧实现 = 0 条 ⇒ 不是"本来就不显示"')
  const b = byId(L)
  ok(b[1494] && b[1494].target === 900 && b[1494].unit === '瓶', '1494 目标 900 瓶（真响应 avg_per_unit[瓶]）')
  ok(b[1556] && b[1556].target === 600 && b[1556].unit === '包', '1556 目标 600 包')
  ok(b[1596] && b[1596].target === 262.5 && b[1596].unit === '组', '1596 目标 262.5 组（小数不四舍五入）')
  ok(b[1556].name === '0蔗糖5连包 +3到货' && b[1596].name.indexOf('现代牧场') === 0,
    '未加载的行：名字/单位走 avg-target 的 product_name + item.unit（回退分支生效）')
  ok(inst._rowOf('1556') === null && inst._unitOf('1556', inst._avgMap['1556']) === '包',
    '前置：1556 确实没有已渲染的行，单位来自 `it.unit` 回退')
  ok(L[0].empty === true && L[L.length - 1].empty === true, '未填的排前面')
}

/* ═══════════ S2 结论不许随「滚到哪」变化 ═══════════ */
head('S2 首屏 30 行 vs 全量 154 行 —— 结论必须逐项一致')
{
  const i30 = await boot({})
  const iall = await boot({ all: true })
  ok(iall.data.products.length === 154, '前置：全部 154 行已加载', 'len=' + iall.data.products.length)
  const key = (L) => L.map(x => x.id + ':' + x.target).sort().join('|')
  const a = i30._lowList(), b2 = iall._lowList()
  ok(key(a) === key(b2), '两者提醒清单**逐项一致**', key(b2))
  ok(b2.length === 3, '全量下仍是 3 条（不因多滚出 124 个 no_target 行而变多）', brief(b2))
}

/* ═══════════ S3 填了未达标 + 另两个留空（用户报的真实形态）═══════════ */
head('S3 填了 1494=100（未达标）＋ 1556/1596 留空 —— 用户报的那个形态')
{
  const inst = await boot({ all: true, fill: { 1494: 100 } })
  const L = inst._lowList()
  const b = byId(L)
  ok(L.length === 3, '3 条：1 条「填了但不够」＋ 2 条「完全没填」', brief(L))
  ok(b[1494] && b[1494].qty === 100 && b[1494].target === 900 && b[1494].empty === false,
    '1494 填 100 / 均单 900 瓶，empty=false（成因 = 报少了）')
  ok(b[1556] && b[1556].qty === 0 && b[1556].empty === true, '1556 未填 ⇒ empty=true（修前它在结构上进不了清单）')
  ok(b[1596] && b[1596].empty === true, '1596 未填 ⇒ empty=true')
  ok(L[0].empty === true && L[2].empty === false, '排序：未填的在前，填了不够的在后')
  const oldL = oldLowList(inst)
  ok(oldL.length === 1 && oldL[0].id === undefined,
    '**判别力自证**：旧实现只报 1 条（1494）⇒ 两个未填的目标**一个字都不说**', brief(oldL))
  ok(inst.data.products.every(p => p.qty === 0 || String(p.id) === '1494'), '前置：只有 1494 被填过')
}

/* ═══════════ S4 达标不打扰 + 小数边界（D22 回归）═══════════ */
head('S4 全达标 ⇒ 0 条；等于目标不弹、差一点才弹（D22 回归）')
{
  const full = await boot({ all: true, fill: { 1494: 900, 1556: 600, 1596: 263 } })
  ok(full._lowList().length === 0, '三者都达标 ⇒ 0 条（一个都不多弹）', brief(full._lowList()))

  const eq = await boot({ all: true, fill: { 1494: 900, 1556: 600, 1596: 262.5 } })
  ok(eq._lowList().length === 0, '1596 正好 262.5 组（= 目标）⇒ 不算未达标')

  const just = await boot({ all: true, fill: { 1494: 900, 1556: 600, 1596: 262 } })
  const Lj = just._lowList()
  ok(Lj.length === 1 && Lj[0].id === 1596 && Lj[0].empty === false,
    '1596 填 262（差 0.5 组）⇒ **只有它**弹，且 empty=false', brief(Lj))

  const one = await boot({ all: true, fill: { 1494: 899, 1556: 600, 1596: 263 } })
  const Lo = one._lowList()
  ok(Lo.length === 1 && Lo[0].id === 1494, '1494 填 899（差 1 瓶）⇒ 弹它一个', brief(Lo))
}

/* ═══════════ S5 筛选/搜索生效时提交：旧实现会**漏** ═══════════ */
head('S5 先填 1494，再搜索「简爱」（列表被换成子集）')
{
  const inst = await boot({ all: true, fill: { 1494: 100 }, thenSearch: '简爱' })
  ok(inst.data.products.length > 0 && inst.data.products.every(p => (p.name || '').indexOf('简爱') >= 0),
    '前置：products 已被搜索换成子集', 'len=' + inst.data.products.length)
  ok(!inst.data.products.some(p => String(p.id) === '1494'), '前置：1494 已不在 products 里（没有"渲染出来的行"）')
  const L = inst._lowList()
  ok(L.length === 3, '**新**：仍报 3 条（基准是整期全量，与滚到哪/筛没筛无关）', brief(L))
  const b = byId(L)
  ok(b[1494] && b[1494].qty === 100 && b[1494].unit === '瓶',
    '1494 仍在清单里，且单位仍对（`it.unit` 回退，不是空单位）')
  ok(oldLowList(inst).length === 0,
    '**判别力自证**：旧实现在这里**整条漏掉**（基准只看已渲染的行）⇒ 静默不提醒')
}

/* ═══════════ S6 守卫反例：期次对不上 ⇒ 一律不算 ═══════════ */
head('S6 守卫反例：_avgMap 属于别的期次')
{
  const inst = await boot({ all: true, fill: { 1494: 100 } })
  ok(inst._lowList().length === 3, '前置：正常期次下命中 3 条')
  const bad = await boot({ all: true, fill: { 1494: 100 } })
  bad._avgMapPid = String(PERIOD + 1)          // 伪造守卫要拦的那个变量
  ok(bad._lowList().length === 0, '篡改 _avgMapPid ⇒ **立刻变 0 条** ⇒ 守卫真在拦，不是"没数据"')
  ok(bad._avgTargets() === null, '_avgTargets() 返回 null')
  const bad2 = await boot({ all: true, fill: { 1494: 100 } })
  bad2.data.period = { id: PERIOD + 1 }
  ok(bad2._lowList().length === 0, '期次切了但目标还没回来 ⇒ 0 条（宁可不说，也不错报）')
  ok(bad2._avgTargets() === null, '_avgTargets() 显式返回 null（与"本期根本没目标"＝{} 区分开）')
}

/* ═══════════ S7 反例：拿掉关键数据 ⇒ 该条消失 ═══════════ */
head('S7 反例对照：从 per_unit 里删掉那个键 ⇒ 对应提示整条消失')
{
  const inst = await boot({})
  ok(inst._lowList().length === 3, '前置：3 条')
  const saved = AVG.items['1494'].avg_per_unit['瓶']
  delete AVG.items['1494'].avg_per_unit['瓶']
  const L2 = (await boot({}))._lowList()
  ok(L2.length === 2 && !L2.some(x => x.id === 1494), '删掉 1494 的「瓶」键 ⇒ 1494 从清单消失（3→2）', brief(L2))
  AVG.items['1494'].avg_per_unit['瓶'] = saved
  ok((await boot({}))._lowList().length === 3, '把键放回 ⇒ 恢复 3 条')
}

/* ═══════════ S8 反例：只带某一个 flag 的合成项（归因干净）═══════════ */
head('S8 反例对照：只带 no_convert / no_window / done / no_target 的合成项一律不计')
{
  const inst = await boot({})
  ok(inst._lowList().length === 3, '前置：3 条')
  const base = { product_id: 999001, product_name: '合成项', unit: '包', avg_per_unit: { '包': 500 }, flags: {} }
  const withFlag = (f) => inst._avgNum(Object.assign({}, base, { flags: f }), '包')
  ok(withFlag({ no_convert: true }) === 0, '只带 no_convert ⇒ 不计（真实样本常与 no_target 重叠，故必须用合成项归因）')
  ok(withFlag({ no_window: true }) === 0, '只带 no_window ⇒ 不计')
  ok(withFlag({ done: true }) === 0, '只带 done（本期已达标）⇒ 不计 ⇒ 已达成目标的商品不会来烦人')
  ok(withFlag({ no_target: true }) === 0, '只带 no_target ⇒ 不计（R8：不拿 0 冒充）')
  ok(withFlag({}) === 500, '不带任何 flag ⇒ 500（证明上面四条是 flag 拦的，不是键取不到）')
}

/* ═══════════ S9 接口挂了不影响报单（D24 回归）═══════════ */
head('S9 目标接口失败 ⇒ 只是没有提示，报单照常（D24 回归）')
{
  ANSWER = () => true
  MODALS.length = 0; CALLS.length = 0
  const inst = await boot({ avgFail: true, all: true, fill: { 1494: 100 } })
  ok(inst._avgTargets() === null, '目标一直拉不到 ⇒ _avgTargets() = null')
  ok(inst._lowList().length === 0, '⇒ 0 条，不弹均单框')
  await inst._doSubmit()
  const posts = CALLS.filter(c => c.method === 'POST' && c.p.indexOf('/api/forecast-submissions') === 0)
  ok(posts.length === 1, '**仍然完成了提交**（POST 打到 /api/forecast-submissions）', 'POST=' + posts.length)
  ok(!inst.data.submitError, '提交无错误')
}

/* ═══════════ S10 _doSubmit 全链：文案分叉 + 只提醒不阻拦 ═══════════ */
head('S10 提交前弹窗（走 _doSubmit 真实链路）')
{
  // (a) 填了一部分、有目标的那两个留空 ⇒ 弹「还没填」
  ANSWER = () => true
  MODALS.length = 0; CALLS.length = 0
  let inst = await boot({ all: true, fill: { 1494: 900 } })
  ok(inst._lowList().length === 2, '前置：1494 已达标，剩 1556/1596 未填 ⇒ 2 条', brief(inst._lowList()))
  await inst._doSubmit()
  const m1 = MODALS[0] || {}
  ok(MODALS.length >= 2, '弹了「未达标」+「确认提交」两个框', 'modals=' + MODALS.length)
  ok(/有 2 个有目标的商品还没填/.test(m1.title || ''), '标题 = 有 2 个有目标的商品还没填', m1.title)
  ok(/未填 \/ 均单 600 包/.test(m1.content || ''), '明细行写出「未填 / 均单 N 单位」', (m1.content || '').split('\n')[0])
  ok(/没填的商品按 0 计算（共 2 个）/.test(m1.content || ''), '正文说明了口径（没填按 0 计）')
  ok(m1.confirmText === '继续提交' && m1.cancelText === '返回修改', '按钮沿用原文案（只提醒不阻拦）')
  ok(CALLS.filter(c => c.method === 'POST').length === 1, '点「继续提交」⇒ 提交真的发生')

  // (b) 点「返回修改」⇒ 零 POST、数量一项不动
  MODALS.length = 0; CALLS.length = 0
  const inst2 = await boot({ all: true, fill: { 1494: 900 } })
  const cartBefore = JSON.stringify(inst2.data.cart)
  ANSWER = (o) => !/未达标|还没填|低于均单/.test(o.title || '')
  await inst2._doSubmit()
  ANSWER = () => true
  ok(CALLS.filter(c => c.method === 'POST').length === 0, '点「返回修改」⇒ **零 POST**')
  ok(JSON.stringify(inst2.data.cart) === cartBefore, '购物车一项没动')
  ok(!inst2.data.submitting, '没有卡在 submitting')

  // (c) 只有「填了未达标」⇒ 标题保持原文案（D21 验收串）
  MODALS.length = 0
  const inst3 = await boot({ all: true, fill: { 1494: 900, 1556: 600, 1596: 100 } })
  await inst3._doSubmit()
  const m3 = MODALS[0] || {}
  ok(m3.title === '有 1 个商品低于均单目标', '标题保持原文案不变（D21 的验收串依赖它）', m3.title)
  ok(!/没填的商品按 0 计算/.test(m3.content || ''), '只有「低于」时不出现"没填"那句（不引入无关噪音）')
  ok(/现代牧场/.test(m3.content || '') && /100 \/ 均单 262\.5 组/.test(m3.content || ''),
    '明细 = 现代牧场… 100 / 均单 262.5 组', (m3.content || '').split('\n')[0])

  // (d) 两类同现 ⇒ 标题/明细分叉
  MODALS.length = 0
  const inst4 = await boot({ all: true, fill: { 1494: 100 } })
  await inst4._doSubmit()
  const m4 = MODALS[0] || {}
  ok(m4.title === '有 3 个有目标的商品未达标', '两类同现 ⇒ 标题用合并说法', m4.title)
  const lines = (m4.content || '').split('\n')
  ok(lines[0].indexOf('未填') >= 0, '明细首行是「未填」那条（未填排前面）', lines[0])
  ok(lines.some(l => /100 \/ 均单 900 瓶/.test(l)), '明细里同时有「填了但不够」那条')
  ok(!/…等/.test(m4.content || ''), '3 条以内不出现「…等 N 个」（不啰嗦）')
}

/* ═══════════ S11 超过 3 条：明细截断但给出总数 ═══════════ */
head('S11 目标多于 3 条时：明细只列 3 行 + 给总数（不把弹窗撑爆）')
{
  const extra = {}
  ;[9001, 9002, 9003].forEach((id, i) => {
    extra[String(id)] = {
      product_id: id, product_name: '合成-验证用-' + (i + 1), unit: '包',
      avg_per_unit: { '包': 300 }, flags: {}
    }
  })
  Object.assign(AVG.items, extra)
  MODALS.length = 0
  const inst = await boot({ all: true, fill: { 1494: 100, 1556: 600, 1596: 263 } })
  const L = inst._lowList()
  ok(L.length === 4, '前置：4 条（1494 未达标 + 3 个合成项未填）', brief(L))
  await inst._doSubmit()
  const m = MODALS[0] || {}
  const lines = (m.content || '').split('\n').filter(x => x.indexOf('/ 均单') >= 0 || x.indexOf('未填') >= 0)
  ok(m.title === '有 4 个有目标的商品未达标', '标题给出总数 4', m.title)
  ok(lines.length === 3, '明细只列 3 行', '明细行数=' + lines.length)
  ok(/…等 4 个/.test(m.content || ''), '第 4 行位置写「…等 4 个」')
  ;[9001, 9002, 9003].forEach(id => { delete AVG.items[String(id)] })
  ok((await boot({}))._lowList().length === 3, '清掉合成项 ⇒ 恢复 3 条（场景不串味）')
}

/* ═══════════ 静态契约扫描（技能 §5b-②）═══════════ */
head('静态契约：商品顺序仍归后端，前端只对"提醒清单"排序')
{
  const src = fs.readFileSync(FILE, 'utf8')
  const sortCalls = (src.match(/\.sort\(/g) || []).length
  ok(sortCalls === 1, '全页只有 1 处 .sort(（v298 新增，作用在提醒清单这个派生数组上）', 'sort 数=' + sortCalls)
  const from = src.indexOf('_lowList() {')
  const body = src.slice(from, from + 1400)
  ok(body.indexOf('out.sort(') >= 0, '该 .sort 只作用于 out（_lowList 的局部结果）')
  ok(body.indexOf('products.sort') < 0 && body.indexOf('this.data.products =') < 0,
    '**没有**对 this.data.products 做任何重排/替换')
  const wxml = fs.readFileSync(path.join(MP, 'pages/fill/fill.wxml'), 'utf8')
  ok(wxml.indexOf('bindtap="onQtyPlus"') >= 0 && typeof OPTS.onQtyPlus === 'function',
    'wxml 的 handler 在 js 里存在（抽样 onQtyPlus）')
  const wxmlBinds = [...wxml.matchAll(/bind(?:tap|input|confirm|change|longpress)="([A-Za-z0-9_]+)"/g)].map(m => m[1])
  const missing = [...new Set(wxmlBinds)].filter(n => typeof OPTS[n] !== 'function' && n !== 'noop')
  ok(missing.length === 0, 'wxml 里**全部** ' + new Set(wxmlBinds).size + ' 个 handler 都在 js 里存在', missing.join(',') || '-')
}

/* ─────────────── 汇总 ─────────────── */
console.log('\n=== 结果 PASS=' + PASS + ' FAIL=' + FAIL + ' ===')
if (FAIL) { console.log('失败项：'); FAILS.forEach(f => console.log('  - ' + f)); process.exitCode = 1 }
else console.log('全部通过。')
