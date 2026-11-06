/* ㊿·c　采购单「是否录生产日期」由用户自由选择（v789）
   ────────────────────────────────────────────────────────────────────────
   背景（老张 2026-11-06 拍板）：每个客户使用习惯不一样，不能写死「必须录生产日期」。
   同时阶段 1 演示数据演练实测：前端录了生产日期、purchase_order_items 也存了，
   但 purchase_order_confirm → batch_in 不接收该字段 ⇒ inventory.production_date 永远空，
   「录了」等于白录（后端修复见 .workbuddy/stage1/patches/production-date-chain.patch）。

   本契约只钉前端这一半：
     ① 租户级开关（复用 useColSettings 的页面级 extra 偏好，零后端改动）；
     ② 默认不录、关着连输入框都不显示；开了也**仍是选填**，绝不强制必录；
     ③ 开关关着时提交载荷不带生产日期，避免编辑旧单误带残留值；
     ④ 列显隐既有行为一个不少（防「删功能冒充修复」）。

   🔴 护栏要点：三态 + 抽真实函数体注入 vm 实跑 + 坏样本自证 + 静态判据一律剥注释
      （剥块注释、行注释与 Vue 模板注释；注释里逐字抄旧代码会自撞假红，v785 踩过）。
   🔴 必须显式注册进 tests/run-all.mjs（runner 不自动扫描 *.contract.mjs）。 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const poPath = path.join(ROOT, 'src/pages/inventory/new/PurchaseOrderForm.vue')
const csPath = path.join(ROOT, 'src/composables/useColSettings.js')
const po = fs.readFileSync(poPath, 'utf8')
const cs = fs.readFileSync(csPath, 'utf8')

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

// 抽真实函数体（按花括号配平，不用「下一个 function」截 —— 会把别的函数截进来，v785 踩过）
function fnBody (src, name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src)
  if (!m) return null
  let i = m.index + m[0].length, depth = 1
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
    i++
  }
  return src.slice(m.index, i)
}

let pass = 0, fail = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.log('  ❌ ' + msg) }
}

// ── 判据集合（对「当前源码」与「坏样本源码」都能跑，用于自证）──────────
function checks (poSrc, csSrc) {
  const p = stripComments(poSrc)
  const c = stripComments(csSrc)
  const r = []
  const t = (cond, name) => r.push([name, !!cond])

  // A. 三态：旧无条件提交消失 / 新开关出现 / 既有能力没被删
  t(!/production_date:\s*r\.production_date\s*\|\|\s*''/.test(p),
    'A1 旧的无条件 `production_date: r.production_date || ""` 已消失')
  t(/isExtra,\s*setExtra\s*\}\s*=\s*useColSettings\('purchase-new'/.test(p),
    'A2 采购页从 useColSettings 取到 isExtra / setExtra（租户级偏好）')
  t(/<input[^>]*type="checkbox"[^>]*>:checked="isExtra\('recordProdDate',\s*false\)"/s.test(p)
    || /:checked="isExtra\('recordProdDate',\s*false\)"/.test(p),
    'A3 开关默认关：:checked 绑定 isExtra(recordProdDate, false)')
  t(/@change="setExtra\('recordProdDate',\s*\$event\.target\.checked\)"/.test(p),
    'A4 开关变化写回租户级偏好 setExtra')
  t(/<label[^>]*v-if="isExtra\('recordProdDate',\s*false\)"[^>]*>[\s\S]{0,200}生产日期/s.test(p),
    'A5 生产日期输入行受开关控制（关着不显示）')
  t(/production_date:\s*isExtra\('recordProdDate',\s*false\)\s*\?\s*\(r\.production_date\s*\|\|\s*''\)\s*:\s*''/.test(p),
    'A6 提交载荷：开关关着不带生产日期，开着仍选填')
  // 强制必录的形态一律不允许
  t(!/required[^>]*production_date/.test(p) && !/production_date[^>]*required/.test(p),
    'A7 生产日期输入框没有 required（不写死必须录）')
  t(/if\s*\(r\.production_date\s*&&\s*!DATE_RE\.test\(r\.production_date\)\)/.test(p),
    'A8 校验仍是「填了才查格式」，空值放行')
  // 既有能力一个不少（防删功能冒充修复）
  t(/production_date:\s*''/.test(p), 'A9 明细行初始化仍保留 production_date 字段')
  t(/r\.production_date\s*=\s*it\.production_date\s*\|\|\s*''/.test(p),
    'A10 编辑旧单仍能回显已录的生产日期')
  t(/<span class="ipn-bp-lb">批次号<\/span>/.test(p) && /<span class="ipn-bp-lb">到期日<\/span>/.test(p),
    'A11 批次号 / 到期日两行没被删')
  t(/选填/.test(p), 'A12 面板提示仍明确「选填」')

  // B. useColSettings：extra 与列显隐分开、默认零影响、云端可读回
  t(/return\s*\{[^}]*isExtra,\s*setExtra[^}]*\}/s.test(c),
    'B1 useColSettings 对外暴露 isExtra / setExtra')
  t(/const\s+extra\s*=\s*ref\(\{\}\)/.test(c), 'B2 extra 是独立 ref，不混进 colVis')
  t(/function\s+isExtra\s*\(key,\s*def\s*=\s*false\)/.test(c), 'B3 isExtra 默认 false')
  t(/function\s+setExtra\s*\(key,\s*value\)/.test(c), 'B4 setExtra 存在')
  t(/cfg\.extra\s*&&\s*typeof\s+cfg\.extra\s*===\s*'object'/.test(c),
    'B5 apply 会读云端 cfg.extra（换设备不丢设置）')
  t(/extra\.value\s*=\s*\{\s*\.\.\.cfg\.extra\s*\}/.test(c), 'B6 apply 把云端 extra 覆盖到本地')
  t(/Object\.keys\(extra\.value\)\.length\s*\?\s*\{\s*vis:\s*colVis\.value,\s*extra:\s*extra\.value\s*\}\s*:\s*\{\s*vis:\s*colVis\.value\s*\}/.test(c),
    'B7 没设过 extra 的页面，snapshot 与改动前逐字一致（全站 27 页零影响）')
  const resetBody = fnBody(c, 'resetCols') || ''
  t(!/extra/.test(resetBody), 'B8 resetCols 不重置 extra（重置列 ≠ 重置字段偏好）')
  return r
}

console.log('A + B. 静态判据（剥注释）')
for (const [name, good] of checks(po, cs)) ok(good, name)

// ── C. 抽真实函数体注入 vm 实跑 ────────────────────────────────────
console.log('\nC. 动态实跑（真实 isExtra / setExtra / resetCols / _snapshot 函数体）')
const c = stripComments(cs)
const names = ['defaultVis', 'isVisible', 'toggleCol', 'resetCols', 'isExtra', 'setExtra', '_snapshot']
const bodies = names.map(n => fnBody(c, n))
ok(bodies.every(Boolean), 'C1 七个真实函数体都能完整抽出（花括号配平）')
if (bodies.every(Boolean)) {
  const cols = [
    { key: 'prod', core: true }, { key: 'code', core: false },
    { key: 'batch', core: false }, { key: 'op', core: true },
  ]
  let pushes = 0
  const sb = {
    cols,
    colVis: { value: { code: true, batch: true } },
    extra: { value: {} },
    persistCols: () => { pushes++ },
    console,
  }
  vm.createContext(sb)
  vm.runInContext(bodies.join('\n') + '\nthis.__api = { defaultVis, isVisible, toggleCol, resetCols, isExtra, setExtra, _snapshot }', sb)
  const a = sb.__api
  ok(a.isExtra('recordProdDate', false) === false, 'C2 默认不录：isExtra 返回 false')
  ok(JSON.stringify(a._snapshot()) === JSON.stringify({ vis: { code: true, batch: true } }),
    'C3 未设过开关 → snapshot 不带 extra 键（其它页面零影响）')
  a.setExtra('recordProdDate', true)
  ok(a.isExtra('recordProdDate', false) === true, 'C4 用户打开后 isExtra 返回 true')
  ok(pushes === 1, 'C5 setExtra 触发一次云端持久化（换设备不丢）')
  ok(a._snapshot().extra && a._snapshot().extra.recordProdDate === true,
    'C6 snapshot 带上 extra（cfg 是任意 dict，后端零改动）')
  a.toggleCol('code')
  ok(a.isExtra('recordProdDate', false) === true, 'C7 切换列显隐不影响字段开关（两条轴独立）')
  a.resetCols()
  ok(a.isExtra('recordProdDate', false) === true, 'C8 重置列设置不重置字段开关')
  a.setExtra('recordProdDate', false)
  ok(a.isExtra('recordProdDate', false) === false, 'C9 用户可随时关回去（自由选择，不是单向）')
}

// ── D. 坏样本自证：撤销修复即红 ────────────────────────────────────
console.log('\nD. 坏样本自证（每处单点回退都必须判红）')
function expectRed (name, mutate, target = 'po') {
  const p = target === 'po' ? mutate(po) : po
  const s = target === 'cs' ? mutate(cs) : cs
  const r = checks(p, s)
  const red = r.filter(([, good]) => !good).length
  ok(red > 0, 'D ' + name + ' → 判红 ' + red + ' 条')
}
expectRed('去掉生产日期行的 v-if（又变成常显必见）',
  s => s.replace(`v-if="isExtra('recordProdDate', false)" class="ipn-bp-row"`, `class="ipn-bp-row"`))
expectRed('提交载荷改回无条件带值（开关形同虚设）',
  s => s.replace(/production_date:\s*isExtra\('recordProdDate',\s*false\)\s*\?\s*\(r\.production_date\s*\|\|\s*''\)\s*:\s*''/,
    `production_date: r.production_date || ''`))
expectRed('把开关默认改成开（写死要录）',
  s => s.replace(`:checked="isExtra('recordProdDate', false)"`, `:checked="isExtra('recordProdDate', true)"`))
expectRed('删掉 isExtra 调用（开关失联）',
  s => s.replace(/isExtra,\s*setExtra\s*\}\s*=\s*useColSettings\('purchase-new'/, `} = useColSettings('purchase-new'`))
expectRed('apply 不再读云端 extra（换设备丢设置）',
  s => s.replace(/if\s*\(cfg\s*&&\s*cfg\.extra\s*&&\s*typeof\s*cfg\.extra\s*===\s*'object'\)\s*\{\s*extra\.value\s*=\s*\{\s*\.\.\.cfg\.extra\s*\}\s*\}/, ''), 'cs')
expectRed('snapshot 恒带 extra（全站其它页配置被改写）',
  s => s.replace(/return\s+Object\.keys\(extra\.value\)\.length\s*\?\s*\{\s*vis:\s*colVis\.value,\s*extra:\s*extra\.value\s*\}\s*:\s*\{\s*vis:\s*colVis\.value\s*\}/,
    'return { vis: colVis.value, extra: extra.value }'), 'cs')
expectRed('resetCols 顺手把 extra 也清掉（重置列会误关开关）',
  s => s.replace('function resetCols () {\n    colVis.value = defaultVis()',
    'function resetCols () {\n    extra.value = {}\n    colVis.value = defaultVis()'), 'cs')

console.log('\n' + '='.repeat(66))
console.log(`㊿·c 采购单生产日期可选（v789）：${pass} 通过 / ${fail} 失败`)
console.log('='.repeat(66))
process.exit(fail ? 1 : 0)
