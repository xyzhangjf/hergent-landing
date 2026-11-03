/* v741 契约：改单保存后数量必须「真的生效」，不能被小程序报单叠加回原值。
 *
 * 报障原话：「易胜玲的报单数量也不能改，我点击改单，然后改易胜玲的报单数量，
 *   再点击保存，数量又回到改单前。」
 *
 * 根因：编辑格显示的是「跨角色合计」—— 电脑录入('导入') + 小程序('distributor') 等，
 *   但 save-matrix 只覆盖 '导入' 行。小程序报的那部分永远删不掉、刷新后又加回来，
 *   用户改完的合计被抵消/叠加 ⇒ 数字"回到改单前"。
 *   实证：易胜玲 导入=237、小程序=95、合计显示=332；用户改成某值保存后，刷新仍回到 332。
 *
 * 修复（用户已拍板「保留并让改动生效」）：保存时把合计按「非导入」量拆掉，只把差额写进
 *   '导入' 行 ⇒ 刷新后合计 = 差额 + 非导入 = 用户改的值。不删小程序数据（非破坏性）。
 *
 * 护栏钉三件事，每条都带坏样本自证（只打印 ✅ 的护栏等于没有护栏）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PAGE = path.join(ROOT, 'src/pages/Forecast.vue')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

const src = fs.readFileSync(PAGE, 'utf8')
/** 剥注释：本文件注释里就写着旧写法，不剥必假阳性。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = strip(src)

console.log('① 编辑网格必须把「非导入」来源量单独归集')
{
  ok(/const nonImportByPid = \{\}/.test(code), 'loadEditGrid 声明 nonImportByPid（归集小程序等非导入来源）')
  ok(/nonImportQtyByUnit/.test(code), '行对象携带 nonImportQtyByUnit（按客户名拆差用）')
  // 坏样本自证：把归集逻辑整段删掉 ⇒ 判据必须报错（不是恒真）
  const badCode = code.replace(/nonImportByPid/g, 'X').replace(/nonImportQtyByUnit/g, 'Y')
  ok(!/nonImportByPid/.test(badCode) && !/nonImportQtyByUnit/.test(badCode),
    '坏样本：未归集非导入量时判据报错')
}

console.log('② 保存载荷必须把合计拆掉非导入量，只发差额（v741 核心）')
{
  const payStart = code.indexOf('rows: usable.map')
  const payEnd = code.indexOf('base_rev')
  const pay = code.slice(payStart, payEnd > payStart ? payEnd : payStart + 4000)
  ok(/nonImportQtyByUnit/.test(pay), 'payload 引用 nonImportQtyByUnit（拆差来源）')
  ok(/Number\(q\[k\]\)/.test(pay) && /Number\(ni\[k\]\)/.test(pay),
    'payload 做「合计 − 非导入」并按 Number 计算')
  /* 🔴 v741 二次拍板（用户原话「不设下限，主管有减单的权利」）：
     差额**不许钳 0**。钳 0 ⇒ 合计最低只能压到门店自报量，主管减不了单。
     负差额由后端落成 `role='主管调整'` 明细（见 routers/forecast_submissions.py::save_matrix）。 */
  ok(!/Math\.max\(\s*0/.test(pay), '差额不钳 0（允许负数 ⇒ 主管可把合计压到低于门店自报量）')
  // 坏样本自证：把差额钳 0 回来 ⇒ 判据必须报错
  const badPay = pay.replace('out[k] = (Number(q[k]) || 0) - (Number(ni[k]) || 0)',
    'out[k] = Math.max(0, (Number(q[k]) || 0) - (Number(ni[k]) || 0))')
  ok(/Math\.max\(\s*0/.test(badPay) && badPay !== pay, '坏样本：钳 0 重现时判据报错（不是恒真）')
  // 坏样本自证：直接把合计 r.qtyByUnit 发过去（v741 修复前的旧写法）
  const badPay2 = pay.replace(/qty_by_unit:[\s\S]*?\}\)\(\),/, 'qty_by_unit: r.qtyByUnit || {},\n')
  ok(!/nonImportQtyByUnit/.test(badPay2), '坏样本：直接发 r.qtyByUnit 时「拆差」判据会报错')
}

console.log('③ 「非导入」归集必须排除 `主管调整` 自身（否则自我抵消循环）')
{
  /* 🔴 这是本机制最容易埋的雷：`主管调整` 是**自己的产物**。
     若把它算进 nonImport：
       合计 X − (门店自报 N + 调整 X−N) = 0 ⇒ 下次保存不再写任何行
       ⇒ scope 把调整行一并清掉 ⇒ 合计跳回 N（用户看到"又回去了"）。
     判据：过滤那行的条件必须同时排除 '导入' 与 '主管调整'。 */
  const niLine = (code.match(/const curNI = [^\n]*/) || [''])[0]
  ok(/!==\s*'主管调整'/.test(niLine), 'nonImport 过滤排除 主管调整', niLine ? `（${niLine.trim().slice(0, 80)}…）` : '')
  ok(/!==\s*'导入'/.test(niLine), 'nonImport 过滤排除 导入')
  // 坏样本自证：只排除 '导入'（漏掉主管调整）⇒ 判据报错
  const badLine = niLine.replace(/\s*&&\s*s\.role\s*!==\s*'主管调整'/, '')
  ok(!/主管调整/.test(badLine) && badLine !== niLine, '坏样本：漏排主管调整时判据报错（不是恒真）')
}

console.log('④ 不得再出现「直接把合计发进导入行」的旧写法')
{
  ok(!/qty_by_unit:\s*r\.qtyByUnit/.test(code),
    '全源码无 qty_by_unit: r.qtyByUnit 直接赋值（那是 v741 的病根）')
  // 坏样本：如果有人在别处又写回直接赋值，判据必须抓出
  const badCode = code + '\n        qty_by_unit: r.qtyByUnit || {},\n'
  ok(/qty_by_unit:\s*r\.qtyByUnit/.test(badCode), '坏样本：直接赋值重现时判据报错')
}

console.log('\n' + (failed ? `❌ ${failed} 条未通过` : '✅ 全部通过'))
process.exit(failed ? 1 : 0)
