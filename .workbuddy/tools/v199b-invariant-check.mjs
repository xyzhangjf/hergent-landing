/* v199b 前端不变量校验
 *
 * 背景：v199 给 `cross` 加字段 `hiddenUnits` 时，只补了 5 处整体赋值里的 **1 处**，
 * 上线当天用户点「删除列」就整页「页面出错了」（ErrorBoundary 兜住 TypeError）。
 * 而 SFC 编译校验**通过**了 —— 编译期根本发现不了「运行期字段缺失」。
 *
 * 本脚本把这类缺陷变成**可静态断言的不变量**：
 *   I1  `cross.value` 的整数字面量赋值必须含 `units`（形状只有一个来源，别再手写）
 *   I2  不得裸读 `cross.value.units.length`（unitCount() 自身实现除外）
 *   I3  `cross.value.hiddenUnits` 只允许出现在 accessor 与显式初始化里
 *   I4  关键锚点存在
 *   I5  不得存在「自递归 accessor」—— 兜底分支绝不能回落自身
 *       （v199b 首版把 unitCount 的兜底写成 `? unitCount() : 0`：一进预报页就
 *        `RangeError: Maximum call stack size exceeded`。它语法合法 / 编译通过 /
 *        构建通过，只有页面真跑起来才炸 ⇒ 必须专门断言这个形状）
 *   I6  构建产物：① 无自递归 ② 产物 mtime ≥ 源码 mtime
 *       （2026-09-19 第三次翻车的直接原因就是**源码改对了、dist 没重建**，
 *        rsync 上去的仍是修复前的旧 chunk ⇒「源码正确」≠「线上正确」）
 * 用法：node .workbuddy/tools/v199b-invariant-check.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/@vue/compiler-sfc/dist/compiler-sfc.cjs.js'

const FILE = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const src = readFileSync(FILE, 'utf8')
/* 注释剥离：把注释**逐字符换成空格**（保留换行）⇒ 行号与偏移量与 src 完全对齐，
   既避免「注释里提到 hiddenUnits」被误判为越权引用，又不影响错误定位。
   ⚠️ 必须先剥注释再跑 I1/I2/I3：第一版没剥，结果 5 条 FAIL 全是自己写的注释续行
      （以 `⇒` / `②` / `⚠️` 开头，不匹配 `^\s*(\*|//)`）。 */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  // 行注释：`//` 前若紧跟 `:` 或 `/` 视为 URL（http://…）不动，避免误吃同一行后面的代码
  .replace(/(^|[^:/])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
const code = strip(src)
let pass = 0, fail = 0
const ok = (name, extra = '') => { console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`); pass++ }
const no = (name, extra = '') => { console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`); fail++ }
const head = (t) => console.log('\n== ' + t + ' ==')

head('0. SFC 编译')
try {
  const { descriptor, errors } = parse(src, { filename: 'Forecast.vue' })
  if (errors && errors.length) { no('parse', errors.map(e => e.message).join('; ')) }
  else {
    compileScript(descriptor, { id: 'v199b' })
    const t = compileTemplate({ source: descriptor.template.content, filename: 'Forecast.vue', id: 'v199b' })
    if (t.errors && t.errors.length) no('compileTemplate', String(t.errors[0]))
    else ok('parse + compileScript + compileTemplate')
  }
} catch (e) { no('编译抛异常', e.message) }

head('I1  cross.value 的字面量赋值必须含 units')
const litRe = /cross\.value\s*=\s*\{/g
let m, lits = 0, bad = 0
while ((m = litRe.exec(code))) {
  lits++
  const seg = code.slice(m.index, m.index + 700)
  const end = seg.indexOf('\n    }')
  const body = end > 0 ? seg.slice(0, end) : seg
  if (!/\bunits\b/.test(body)) { bad++; const ln = code.slice(0, m.index).split('\n').length; no(`行 ${ln} 的 cross.value = { } 缺 units`) }
}
if (lits && !bad) ok(`${lits} 处字面量赋值全含 units`)
if (!lits) no('一处字面量赋值都没扫到（正则失效？）')

head('I2  不得裸读 cross.value.units.length（unitCount() 自身实现除外）')
/* 判据修正（2026-09-19）：修好后的 unitCount 实现体里**必须**有这一处裸读 —— 它就是全站唯一的
   读点；若连它都改成 `unitCount()`，那正是 I5 要拦的自递归。⇒ 裸读只允许落在 accessor 内部。 */
const ucStart = code.indexOf('function unitCount()')
const ucEnd = ucStart >= 0 ? code.indexOf('}', code.indexOf('{', ucStart)) : -1
const bareLocs = []
{
  const bareRe = /cross\.value\.units\.length/g
  let bm
  while ((bm = bareRe.exec(code))) bareLocs.push(bm.index)
}
const inAccessor = (i) => ucStart >= 0 && i >= ucStart && i <= ucEnd
const illegal = bareLocs.filter(i => !inAccessor(i))
illegal.length === 0
  ? ok(`裸读 ${bareLocs.length} 处，全部落在 unitCount() 实现体内（合规）`)
  : illegal.forEach(i => no(`行 ${code.slice(0, i).split('\n').length} 越权裸读`))

head('I3  hiddenUnits 只能出现在 accessor / 显式初始化')
const accStart = src.indexOf('function hiddenUnits()')
const accEnd = src.indexOf('function unitCount()')
const huLines = code.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('hiddenUnits'))
const outside = huLines.filter(([ln, l]) => {
  const inAcc = ln >= code.slice(0, accStart).split('\n').length && ln <= code.slice(0, accEnd).split('\n').length
  if (inAcc) return false
  if (/^\s*(\/\*|\*|\/\/)/.test(l)) return false              // 注释
  if (/hiddenUnits:\s*\[\]/.test(l)) return false              // 显式初始化
  if (/=\s*hiddenUnits\(\)/.test(l)) return false               // const hu = hiddenUnits()
  if (/hidden_customers:\s*hiddenUnits\(\)/.test(l)) return false
  if (/cross\.value\.hiddenUnits\s*=/.test(l) && /Array\.isArray/.test(l)) return false
  return true
})
outside.length === 0 ? ok(`${huLines.length} 处引用全部合规`) : outside.forEach(([ln, l]) => no(`行 ${ln} 越权引用`, l.trim().slice(0, 70)))

head('I4  关键锚点')
const anchors = [
  ['blankCross 工厂定义', /function blankCross\(\)\s*\{/],
  ['cross 由工厂初始化', /const cross = ref\(blankCross\(\)\)/],
  ['hiddenUnits accessor', /function hiddenUnits\(\)\s*\{[\s\S]{0,160}Array\.isArray\(cross\.value\.hiddenUnits\)/],
  ['unitCount accessor', /function unitCount\(\)\s*\{[\s\S]{0,120}Array\.isArray\(cross\.value\.units\)/],
  ['草稿分支已带 hiddenUnits', /reportedUnits: units\.length,\n\s*\/\* v199b[\s\S]{0,400}hiddenUnits: \[\]/],
  ['删期次走工厂', /cross\.value = blankCross\(\)/],
  ['delCol 用 unitCount', /function delCol\(ui\) \{\n\s*\/\* v199b[\s\S]{0,200}ui >= unitCount\(\)/],
  ['delCol 写集合走 accessor', /const hu = hiddenUnits\(\)\n\s*if \(u\.name && !hu\.includes/],
  ['saveEdits 提交走 accessor', /hidden_customers: hiddenUnits\(\)/],
]
for (const [name, re] of anchors) re.test(src) ? ok(name) : no(name)

head('I5  源码无「自递归 accessor」（兜底分支绝不能回落自身）')
/* 为什么单列一条（2026-09-19 第三次翻车）：
   v199b 的首版把 unitCount 的兜底写成了 `Array.isArray(...) ? unitCount() : 0` —— 没有出口，
   一进预报页就 `RangeError: Maximum call stack size exceeded`，又被 ErrorBoundary 兜成整页
   「页面出错了」。它**语法合法 / 编译通过 / 构建通过 / 静态『这函数存在吗』也通过**，
   只有页面真跑起来才炸 ⇒ 必须有一条专门盯这个形状的断言。 */
function scanSelfRecursion(text, { requireUnits = false } = {}) {
  const hits = []
  const c = text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:/])\/\/[^\n]*/g, (mm, p1) => p1 + ' '.repeat(mm.length - p1.length))
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g
  let mm
  while ((mm = re.exec(c))) {
    const name = mm[1]
    const open = c.indexOf('{', mm.index)
    if (open < 0) continue
    let depth = 0, close = -1
    for (let i = open; i < c.length; i++) {
      if (c[i] === '{') depth++
      else if (c[i] === '}') { depth--; if (!depth) { close = i; break } }
    }
    if (close < 0) continue
    const body = c.slice(open + 1, close)
    if (requireUnits && !/\.units|hiddenUnits/.test(body)) continue   // 产物里只查业务相关函数
    const selfRe = new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`)
    const at = body.search(selfRe)
    if (at >= 0) {
      const ln = c.slice(0, open + 1 + at).split('\n').length
      hits.push({ name, ln, line: (text.split('\n')[ln - 1] || '').trim() })
    }
  }
  return hits
}
const srcSelf = scanSelfRecursion(src)
srcSelf.length === 0
  ? ok('源码自递归 = 0')
  : srcSelf.forEach(h => no(`行 ${h.ln} function ${h.name}() 自调用（疑似无出口）`, h.line.slice(0, 84)))

head('I6  构建产物：无自递归 + 新鲜度（产物必须 ≥ 源码）')
/* 为什么查产物而不只查源码（2026-09-19 的直接教训）：
   那次源码**已经改对了**，但 dist/ 仍是「修复前」的旧构建，rsync 上去的就是旧的 ⇒
   用户看到的依旧是栈溢出。⇒「源码正确」不等于「线上正确」，必须验**产物**本身，
   并且要求产物 mtime ≥ 源码 mtime，否则说明改完忘了重新构建。 */
const DIST = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/dist/assets'
let prodFiles = []
try { prodFiles = readdirSync(DIST).filter(f => /^Forecast-.*\.js$/.test(f)) } catch { /* 未构建 */ }
if (!prodFiles.length) {
  no('未找到 dist/assets/Forecast-*.js', '需先 `npm run build`')
} else {
  let badProd = 0
  for (const f of prodFiles) {
    const p = DIST + '/' + f
    const txt = readFileSync(p, 'utf8')
    const hits = scanSelfRecursion(txt, { requireUnits: true })
    if (hits.length) { badProd++; hits.forEach(h => no(`${f} 产物自递归`, `function ${h.name}() 行 ${h.ln}`)) }
    const mt = statSync(p).mtimeMs, st = statSync(FILE).mtimeMs
    if (mt + 1500 < st) no(`${f} 比源码旧（改完忘重建）`, `产物 ${new Date(mt).toLocaleString()} < 源码 ${new Date(st).toLocaleString()}`)
    else ok(`${f} 产物新鲜（mtime ≥ 源码）`)
  }
  if (!badProd) ok(`产物自递归 = 0（扫了 ${prodFiles.length} 个 chunk）`)
}

head('结果')
console.log(`   PASS=${pass}  FAIL=${fail}`)
process.exit(fail ? 1 : 0)
