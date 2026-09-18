/* v189 本地断言：「合计(箱) = 合计(小单位) ÷ 规格」这条口径真的成立吗？
 *
 * 🔴 关键纪律（两条）：
 *   ① perCase / rowBoxes / pricePerCase / rowSum / factoryPrice 一律**从 Forecast.vue 源码里
 *      按行抽出、原样执行**，不在本文件另写一份 —— 另写一份就是「第二份拷贝 = 静默漂移」，
 *      源码改了断言照样绿，等于没验。
 *   ② 「旧口径」也不靠回忆复现 —— 直接从 `git show HEAD:<file>` 里抽**上一版的 rowBoxes**
 *      来跑，做真正的前后对比。（曾把 parseFloat(spec) 误写成「先剥非数字再取首数」，
 *      两者结果完全不同：'250g*24瓶' 是 250 vs 25024。）
 *
 * 用法：
 *   node forecast-boxes-caliber-check.js                        # 纯离线自证
 *   node forecast-boxes-caliber-check.js /tmp/prod-specs.json    # 追加「真实档案」盘查
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const REL = 'hergent-cn-v2/src/pages/Forecast.vue'
const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, REL)
const src = fs.readFileSync(SRC, 'utf8')
const srcCode = stripComments(src)

/** 去掉整行注释与 HTML 注释行 —— 断言要匹配「代码的意图」，不能把说明文字本身判成违例。 */
function stripComments(s) {
  return s.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l))
    .map(l => l.replace(/\s+\/\/.*$/, ''))
    .join('\n')
}

let pass = 0, fail = 0
const failures = []
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  ❌ ' + label + (detail ? '  [' + detail + ']' : '')) }
}
function eq(a, b, label) { ok(Object.is(a, b), label, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)) }

/* ---------- 按「顶格 } 收尾」的行范围，从任意文本里抽函数 ---------- */
function extractFn(text, name) {
  const ls = text.split('\n')
  const head = 'function ' + name + '('
  const i = ls.findIndex(l => l.startsWith(head))
  if (i < 0) return null
  let j = i + 1
  while (j < ls.length && ls[j] !== '}') j++
  if (j >= ls.length) throw new Error('找不到 ' + name + ' 的收尾行')
  return ls.slice(i, j + 1).join('\n')
}
function buildFns(text, names) {
  const parts = names.map(n => {
    const f = extractFn(text, n)
    if (!f) throw new Error('源码里找不到 function ' + n + '（改名了？断言必须跟着改）')
    return f
  })
  const sb = {}
  // eslint-disable-next-line no-new-func
  new Function('S', parts.join('\n\n') + '\n' +
    names.map(n => `S.${n}=${n};`).join('') )(sb)
  return sb
}

const NEW_NAMES = ['factoryPrice', 'rowSum', 'perCase', 'rowBoxes', 'pricePerCase']
const { perCase, rowBoxes, pricePerCase, rowSum } = buildFns(src, NEW_NAMES)

/* ---------- 1. perCase 金标准用例（规格串全部取自生产档案原文） ---------- */
console.log('\n[1] perCase：规格 → 每箱小单位数（用例取自生产档案原文）')
const CASES = [
  ['200g*12', '件', 12, '末位=装箱数（旧口径 parseFloat 误取 200 克）'],
  ['1500ML*6桶', '桶', 6, '旧口径误取 1500 ⇒ 箱数缩小 250 倍'],
  ['250g*24瓶', '瓶', 24, '末位=瓶数'],
  ['135g*24杯', '杯', 24, '末位单位与报单单位一致'],
  ['90g*8杯*12组', '组', 12, '末位=组数（1 箱 = 12 组）'],
  ['100g*8杯*12组', '杯', 96, '报单单位更细 ⇒ 层级相乘 8×12'],
  ['110g*3杯12组', '杯', 36, '生产实测存在：报单单位=杯 而末位=组'],
  ['210g*10瓶*6提手提装', '瓶', 60, '尾段带说明字「提手提装」'],
  ['90g×8杯×12组', '杯', 96, '全角 × 分隔也要切对'],
  ['185ml×24瓶', '瓶', 24, '全角 × 且无报单单位匹配'],
  ['10g*5杯*8条', '杯', 40, '生产实测：1 箱 = 8 条 = 40 杯'],
  ['12', '件', 12, '纯数字规格即其本身'],
  ['8*10', '件', 10, '末位=装箱数'],
  ['', '件', 0, '空规格 ⇒ 0（不换算、不静默当 1）'],
  ['散装', '件', 0, '无任何数字 ⇒ 0'],
  [null, '件', 0, 'null ⇒ 0'],
  ['100g*8杯*12组', '', 12, '报单单位缺失 ⇒ 退化为末位数'],
  ['100g*8杯*12组', '件', 12, '报单单位不在规格里 ⇒ 退化为末位数'],
]
for (const [spec, unit, want, why] of CASES) {
  const got = perCase(spec, unit)
  ok(got === want, `perCase(${JSON.stringify(spec)}, ${JSON.stringify(unit)}) = ${want}`, got !== want ? `got=${got} · ${why}` : why)
}

/* ---------- 2. 「逐行除再相加」vs「先合计再除」——证明后者在异构规格下无定义 ---------- */
console.log('\n[2] 合计(箱)：必须逐行除再相加；「先合计再除」在异构规格下无定义')
const mk = (spec, unit, ...qtys) => ({ spec, unit, qtyByUnit: Object.fromEntries(qtys.map((q, i) => ['c' + i, q])) })
const ROWS = [
  mk('200g*12', '件', 24),        // 24 件 → 2 箱
  mk('1500ML*6桶', '桶', 6),      // 6 桶  → 1 箱
  mk('250g*24瓶', '瓶', 50),      // 50 瓶 → 2 箱
]
const totalSmall = ROWS.reduce((s, r) => s + rowSum(r), 0)
const boxesThusFar = ROWS.reduce((s, r) => s + rowBoxes(r), 0)
eq(totalSmall, 80, '合计(小单位) = 80')
eq(boxesThusFar, 5, '合计(箱) = Σ round(行小单位 ÷ 行规格) = 5')
const cands = [perCase('200g*12', '件'), perCase('1500ML*6桶', '桶'), perCase('250g*24瓶', '瓶')]
const bogus = cands.map(c => Math.round(80 / c))
ok(new Set(bogus).size > 1, '「先合计再除」会随「除哪个规格」给出不同答案 ⇒ 该式无定义', 'candidates=' + JSON.stringify(bogus))
ok(bogus.every(b => b !== 5), '且三个候选答案都不等于正确的 5 箱', 'candidates=' + JSON.stringify(bogus))
eq(rowBoxes({ spec: '', unit: '件', total: 100 }), 0, '缺规格 ⇒ 合计(箱) 记 0（界面走「缺规格」分支）')
eq(pricePerCase({ factory_price: 10, spec: '', unit: '件' }), null, '缺规格 ⇒ 单价(厂价/箱) 返回 null（不瞎算）')
eq(pricePerCase({ factory_price: 10, spec: '200g*12', unit: '件' }), 120, '单价(厂价/箱) = 10 元/件 × 12 件/箱 = 120')

/* ---------- 3. 源码静态断言（只看代码、不看注释） ---------- */
console.log('\n[3] 静态断言（源码层，注释已剔除）')
const cnt = re => (srcCode.match(re) || []).length
ok(!/parseFloat\((?:r|pd)\.spec\)/.test(srcCode), '无残留 parseFloat(<row>.spec)（净含量误当规格的旧写法）')
eq(cnt(/function perCase\(/g), 1, 'perCase 只有一个定义（唯一实现）')
eq(cnt(/perCase\(/g), 5, 'perCase 引用 = 5（4 个计算点 + 1 个定义头）')
eq(cnt(/function rowBoxes\(/g), 1, 'rowBoxes 只有一个定义')
eq(cnt(/function pricePerCase\(/g), 1, 'pricePerCase 只有一个定义')
ok(!/parseFloat/.test(extractFn(src, 'rowBoxes')), 'rowBoxes 内部不再出现 parseFloat')
ok(!/parseFloat/.test(extractFn(src, 'pricePerCase')), 'pricePerCase 内部不再出现 parseFloat')
eq(cnt(/cross\.value\.rows\.filter\(r => !r\._deleted\)/g), 1, '「活跃行」filter 只出现 1 处（仅 liveRows 内）')
eq(cnt(/const liveRows = computed\(/g), 1, 'liveRows 只有一处定义（活跃行唯一判据）')
eq(cnt(/liveRows\.value/g), 8, 'liveRows 被 8 个消费点引用（recomputeTotals / editTotalQty / editTotalAmount / editTotalBoxes / foot / 推送正文 / 下单说明 / 保存行集）—— 实测过一次是 7，后来又抓出保存路径那处第二拷贝')
eq(cnt(/cross\.rows\.reduce/g), 0, '模板/脚本里已无 cross.rows.reduce 直求和')
eq(cnt(/const editTotalBoxes = computed\(/g), 1, 'editTotalBoxes（合计(箱) 唯一实现）存在')
ok(!/总箱/.test(srcCode), '代码里已无「总箱」错标（旧写法把合计(小单位) 标成箱）')
ok(/合计\(箱\) \$\{editTotalBoxes\.value\}/.test(srcCode), '推送正文用箱口径 editTotalBoxes')

/* ---------- 4. 与 HEAD 上一版做前后对比（旧口径从 git 抽，不靠回忆） ---------- */
console.log('\n[4] 前/后对比：旧 rowBoxes 直接从 HEAD 抽取执行')
let headOld = null
try {
  headOld = execSync('git show HEAD:' + REL, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
} catch (e) { console.log('  ⚠ 取 HEAD 版本失败（' + e.message.split('\n')[0] + '）⇒ 跳过前/后对比') }
if (headOld) {
  const oldFns = buildFns(headOld, ['factoryPrice', 'rowSum', 'rowBoxes'])
  const oldBoxes = oldFns.rowBoxes
  const demoRow = (spec, unit, total) => ({
    spec, unit, total,
    qtyByUnit: { c: total },
  })
  const D = [
    ['200g*12', '件', 24, 2],
    ['1500ML*6桶', '桶', 6, 1],
    ['250g*24瓶', '瓶', 48, 2],
  ]
  for (const [spec, unit, total, want] of D) {
    const o = oldBoxes(demoRow(spec, unit, total))
    const n = rowBoxes(demoRow(spec, unit, total))
    ok(n === want, `${total} 个小单位 · 规格 ${spec} ⇒ ${want} 箱（旧实现 ${o} 箱）`)
  }
  ok(D.some(([s, u, t]) => oldBoxes(demoRow(s, u, t)) !== rowBoxes(demoRow(s, u, t))), '确实存在旧≠新的行（本次修的是真 bug，不是空改）')
}

/* ---------- 5. 真实档案盘查 ---------- */
const specFile = process.argv[2]
if (specFile && fs.existsSync(specFile)) {
  const dump = JSON.parse(fs.readFileSync(specFile, 'utf8'))
  const prods = dump.products || []
  console.log(`\n[5] 真实档案盘查（生产只读导出 ${prods.length} 个商品）`)
  const oldPer = s => { const n = parseFloat(String(s == null ? '' : s)); return isNaN(n) ? 0 : n }  // = 旧 parseFloat(spec)
  let zero = 0, changed = 0, same = 0, grew = 0, shrank = 0
  const samples = []
  for (const p of prods) {
    const nw = perCase(p.spec, p.unit)
    const od = oldPer(p.spec)
    if (nw === 0) { zero++; continue }
    if (nw === od) same++
    else {
      changed++
      if (od > 0 && nw > od) grew++
      if (od > 0 && nw < od) shrank++
      if (samples.length < 10) samples.push(`      ${String(p.spec).padEnd(22)} unit=${String(p.unit).padEnd(4)} 旧每箱=${od} → 新每箱=${nw}`)
    }
  }
  console.log(`    解析为 0（无数字规格，不参与换算，与旧行为一致）: ${zero} 个`)
  console.log(`    新旧一致                                    : ${same} 个`)
  console.log(`    新旧不同（= 本次修正的实际影响面）           : ${changed} 个`)
  console.log(`      新 > 旧（旧把每箱数算小 ⇒ 箱数虚高）       : ${grew} 个`)
  console.log(`      新 < 旧（旧把每箱数算大 ⇒ 箱数被压成 0）   : ${shrank} 个`)
  if (samples.length) console.log('    样例：\n' + samples.join('\n'))
  ok(zero + same + changed === prods.length, '四类互斥且覆盖全部档案（无遗漏）', `${zero}+${same}+${changed} vs ${prods.length}`)
  ok(zero < prods.length * 0.25, `无数字规格占比 < 25%（实测 ${(zero / prods.length * 100).toFixed(1)}%）—— 这些商品本就算不出箱，与旧实现同为零，不是本次引入`)
} else {
  console.log('\n[5] 跳过真实档案盘查（未提供 specs.json）')
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(64))
console.log(`本地断言：通过 ${pass} / 失败 ${fail}`)
if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  · ' + f)); process.exit(1) }
console.log('结论：perCase 唯一实现生效；合计(箱) 逐行除再相加与行级/表级同源；旧 parseFloat 口径已清零。')
