/* v362 通知条（toast）逻辑验证 —— 直接跑**真实 store 模块**（不是复刻）。
   用法： node /tmp/v362-toast-logic.mjs <store模块绝对路径> <正/反例标签> */
import { registerHooks } from 'node:module'
/* 源码里的相对 import 是 Vite 风格（无扩展名，如 '../api/client'），Node ESM 不认 ⇒
   挂一个解析钩子补 '.js'。这样跑的是**真实源文件**，不是复制粘贴的复刻件。 */
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[cm]?js$/.test(spec)) {
      try { return next(spec + '.js', ctx) } catch (e) { /* 落到原样解析 */ }
    }
    return next(spec, ctx)
  },
})
const storePath = process.argv[2]
const label = process.argv[3] || 'unknown'

/* ---- 浏览器环境最小替身（store 依赖 localStorage / document / window） ---- */
const LS = new Map()
globalThis.localStorage = {
  getItem: k => (LS.has(k) ? LS.get(k) : null),
  setItem: (k, v) => LS.set(k, String(v)),
  removeItem: k => LS.delete(k),
  clear: () => LS.clear(),
  key: i => [...LS.keys()][i],
  get length() { return LS.size },
}
/* Vue 的 runtime-dom 在 **import 期**就要 document.createElement('template') ⇒ 必须给足替身 */
function fakeEl() {
  const el = {
    style: {}, content: { firstChild: null }, firstChild: null,
    setAttribute() {}, getAttribute() { return null }, removeAttribute() {},
    appendChild() {}, removeChild() {}, insertBefore() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    innerHTML: '', textContent: '', sheet: null, cloneNode() { return fakeEl() },
  }
  return el
}
globalThis.document = {
  createElement: fakeEl, createTextNode: fakeEl, createComment: fakeEl,
  documentElement: Object.assign(fakeEl(), { style: {} }),
  body: fakeEl(), head: fakeEl(),
  addEventListener() {}, removeEventListener() {},
  querySelector() { return null }, querySelectorAll() { return [] },
  getElementById() { return null },
  visibilityState: 'visible', cookie: '',
}
globalThis.window = globalThis
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
/* Node 22 的 globalThis.navigator 是只读 getter ⇒ 用 defineProperty 覆盖，失败就不动它 */
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node-probe' }, configurable: true, writable: true,
  })
} catch (e) { /* 已存在且不可覆盖：Node 自带的够用 */ }
globalThis.location = { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:' }
globalThis.fetch = async () => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => ({}), text: async () => '', blob: async () => null,
})

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const mod = await import(storePath)
const store = mod.store
const ui = store.ui

console.log('\n================ [' + label + '] ' + storePath + ' ================')
console.log('ui 里的通知槽位：', Object.keys(ui).filter(k => k.startsWith('toast')).join(', ') || '(无)')

const hasStack = Array.isArray(ui.toasts)
console.log('① 槽位形态：' + (hasStack ? '数组（栈）' : '单值（旧实现）'))

if (!hasStack) {
  /* ---------- 旧实现：单槽位 + 固定 3s ---------- */
  const src = await import('node:fs').then(fs => fs.readFileSync(storePath, 'utf8'))
  const flat = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  ok('C1 旧实现里存在 `toast: null` 单槽位', /toast:\s*null/.test(flat))
  ok('C2 旧实现里是固定 3000ms 自动关闭', /setTimeout\([^)]*3000\)/.test(flat.replace(/\s+/g, '')) ||
     /ui\.toast\s*=\s*null\s*\},\s*3000\)/.test(flat.replace(/\s+/g, '')))
  ok('C3 旧实现没有 dismissToast（没有手关出口）', !/function dismissToast/.test(flat))
  ok('C4 旧实现用 Date.now() 当 id ⇒ 同毫秒会撞 key',
     /id:\s*Date\.now\(\)/.test(flat))
  ok('C5 旧实现**没有**「长文案不自动关闭」的概念', !/sticky/.test(flat))
  console.log('\n  ⚠️  反例（旧实现）本就不该通过正例断言 —— 只用于自证断言不空转。')
} else {
  /* ---------- 新实现 ---------- */
  ui.toasts.length = 0

  console.log('\n【A】短文案：自动关闭（3 秒档）')
  const idShort = store.toast('已保存', 'ok')
  ok('A1 入栈 1 条', ui.toasts.length === 1, ui.toasts.length)
  ok('A2 短文案不算 sticky', ui.toasts.find(t => t.id === idShort).sticky === false)
  ok('A3 返回了 id', typeof idShort === 'number' && idShort > 0, idShort)
  await sleep(3200)
  ok('A4 3.2 秒后短文案已自动消失', ui.toasts.length === 0, ui.toasts.map(t => t.msg))

  console.log('\n【B】长文案（说明型）：不自动关闭 ← 本次报障的核心')
  const LONG = '原因：本期没有可导出的调拨订单。舟谱模板的语义是「把已导入的下单表转成舟谱格式」，'
    + '销售或老板在网页/小程序直接报的单天然不参与；请先确认下单表已导入，并检查报单配置里该门店的归属。'
    + '（本段特意超过阈值，用于验证「内容较多时不会自己消失」。）'
  console.log('  长文案字数 =', LONG.length)
  const idLong = store.toast(LONG, 'err')
  const t = ui.toasts.find(x => x.id === idLong)
  ok('B1 长文案入栈', !!t)
  ok('B2 判定为 sticky', t && t.sticky === true)
  await sleep(3200)
  ok('B3 **3.2 秒后仍在**（旧实现此时已被清掉）', ui.toasts.some(x => x.id === idLong), ui.toasts.map(x => x.msg.length))
  await sleep(4000)
  ok('B4 **7.2 秒后仍在**（不自动关闭）', ui.toasts.some(x => x.id === idLong))

  console.log('\n【C】关闭出口')
  store.dismissToast(idLong)
  ok('C1 dismissToast 能单独关掉某条', !ui.toasts.some(x => x.id === idLong), ui.toasts.length)

  console.log('\n【D】多条不再互相顶掉 + id 唯一')
  const a = store.toast('第一条：已下载调拨订单导入文件（2 行）', 'ok')
  const b = store.toast('提示：有 3 个报单对象没有「导出配置」，已从模板中拦住', 'warn')
  ok('D1 两条同时存在（旧实现单槽位只剩后一条）', ui.toasts.length >= 2, ui.toasts.length)
  ok('D2 同一次 tick 内两条 id 不同（旧实现 Date.now() 会撞）', a !== b, [a, b])
  ok('D3 第一条没被顶掉', ui.toasts.some(x => x.id === a))
  ui.toasts.length = 0

  console.log('\n【E】阈值与栈上限')
  const s59 = store.toast('x'.repeat(59))
  ok('E1 59 字 → 非 sticky', ui.toasts.find(x => x.id === s59).sticky === false)
  ui.toasts.length = 0
  const s60 = store.toast('x'.repeat(60))
  ok('E2 60 字 → sticky（阈值边界）', ui.toasts.find(x => x.id === s60).sticky === true)
  ui.toasts.length = 0
  const force = store.toast('x'.repeat(200), 'info', { sticky: false })
  ok('E3 显式 {sticky:false} 可强制长文案仍自动关', ui.toasts.find(x => x.id === force).sticky === false)
  ui.toasts.length = 0
  for (let i = 0; i < 5; i++) store.toast('第 ' + (i + 1) + ' 条', 'ok')
  ok('E4 栈上限 3 条（超出丢最旧）', ui.toasts.length === 3, ui.toasts.map(x => x.msg))
  ok('E5 保留的是最新 3 条', ui.toasts.map(x => x.msg).join('|') === '第 3 条|第 4 条|第 5 条',
     ui.toasts.map(x => x.msg))
}

console.log('\n---- [' + label + '] 通过 ' + pass + ' / 失败 ' + fail + ' ----')
console.log('RESULT ' + label + ' pass=' + pass + ' fail=' + fail)
process.exit(0)
